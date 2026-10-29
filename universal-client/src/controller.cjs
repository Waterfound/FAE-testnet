'use strict';
const {spawn}=require('node:child_process');
const {mkdir}=require('node:fs/promises');
const path=require('node:path');
const {EventEmitter}=require('node:events');
const {randomInt}=require('node:crypto');
const {assertRecoverableLocalNodeState}=require('./node-storage-preflight.cjs');
const {NETWORK,validateRead}=require('./bridge-contract.cjs');
const {OwnedNodeIpc,IPC_ENV_FLAG}=require('./owned-node-ipc.cjs');
const {isManagedChildAlive:alive,assertManagedNodeReady,probeLoopbackPort,allocateOsAssignedLoopbackPort,verifyManagedReadiness,waitForManagedListenEvidence}=require('./managed-node-gate.cjs');

const HOST='http://127.0.0.1:8787';
const ADDRESS=/^faet1[023456789acdefghjklmnpqrstuvwxyz]{25,85}$/;
const HASH=/^[0-9a-f]{64}$/;
const ROUTES=new Set(['/explorer/status','/explorer/blocks','/explorer/block','/explorer/transaction','/explorer/address','/explorer/search']);
const EVENTS=new Set(['CONNECTING','TEMPLATE_READY','MINING','WORK_ACCEPTED','WORK_REJECTED','NODE_UNAVAILABLE','RECONNECTING','STOPPED']);
function addressValid(a){if(typeof a!=='string'||!ADDRESS.test(a))throw Error('Invalid public FAE address');return a}
function makeEnv(extra={}){
  const out={};
  for(const key of ['PATH','SystemRoot','WINDIR','HOME','USERPROFILE','TMP','TEMP','TMPDIR','LANG','LC_ALL'])if(process.env[key])out[key]=process.env[key];
  return {...out,...extra};
}
function explorerUrl(route,params={},endpoint=HOST){
  if(!ROUTES.has(route)||!params||typeof params!=='object'||Array.isArray(params))throw Error('Forbidden Explorer request');
  const url=new URL(route,endpoint);
  for(const [key,value] of Object.entries(params)){
    if(!['q','limit','before_height','height','hash','txid','address','cursor'].includes(key))throw Error('Forbidden Explorer parameter');
    if(typeof value!=='string'&&typeof value!=='number')throw Error('Invalid selector');
    const v=String(value);
    if(v.length>120||/[\u0000-\u001f]/.test(v))throw Error('Invalid selector');
    if(key==='address')addressValid(v);
    if(['hash','txid'].includes(key)&&!HASH.test(v))throw Error('Invalid digest');
    if(['limit','height','before_height'].includes(key)&&!/^\d+$/.test(v))throw Error('Invalid numeric selector');
    url.searchParams.set(key,v);
  }
  return url;
}
const ATOMIC=/^(?:0|[1-9][0-9]*)$/;
const OUTPOINT=/^[0-9a-f]{64}:(?:0|[1-9][0-9]*)$/;
const DIGEST=/^[0-9a-f]{64}$/;
const FORBIDDEN_NODE_AUTHORITY_CLAIMS=new Set([
  'process_authenticated','process_identity','ownership_verified',
  'maturity_verified','eligible_for_signing','funding_authorization',
  'signer','submission_authorized'
]);
function hasForbiddenNodeAuthorityClaim(value){
  return value&&typeof value==='object'&&
    Object.keys(value).some(key=>FORBIDDEN_NODE_AUTHORITY_CLAIMS.has(key));
}
// Read-only original FAE v4 /spendable claim. It contains confirmed outputs
// and unconfirmed mempool descendants, NOT a cryptographic spendability proof.
// In particular, coinbase maturity and key ownership are NOT attested here.
function validateFundingCandidatePayload(payload,{address}={}){
  if(!payload||typeof payload!=='object'||Array.isArray(payload)||
     hasForbiddenNodeAuthorityClaim(payload)||
     payload.ok!==true||payload.address!==address||
     (payload.network!==undefined&&payload.network!==NETWORK)||
     typeof payload.spendable_atoms!=='string'||
     payload.spendable_atoms.length>80||!ATOMIC.test(payload.spendable_atoms)||
     !Array.isArray(payload.utxos)||payload.utxos.length>500)
    throw Error('Invalid selected-node funding candidate observation');
  const outpoints=new Set();
  let summed=0n,confirmed=0n,pending=0n;
  const rows=[];
  for(const row of payload.utxos){
    if(!row||typeof row!=='object'||Array.isArray(row)||
       hasForbiddenNodeAuthorityClaim(row)||
       typeof row.outpoint!=='string'||!OUTPOINT.test(row.outpoint)||
       outpoints.has(row.outpoint)||typeof row.amount_atoms!=='string'||
       row.amount_atoms.length>80||!ATOMIC.test(row.amount_atoms)||
       BigInt(row.amount_atoms)===0n||
       !['confirmed','pending'].includes(row.source))
      throw Error('Invalid selected-node funding candidate entry');
    if(row.source==='confirmed'&&
       (!Number.isSafeInteger(row.created_height)||row.created_height<1))
      throw Error('Invalid confirmed candidate height');
    if(row.source==='pending'&&
       (typeof row.parent_txid!=='string'||!DIGEST.test(row.parent_txid)||
        row.created_height!==undefined))
      throw Error('Invalid pending candidate provenance');
    outpoints.add(row.outpoint);
    const amount=BigInt(row.amount_atoms);
    summed+=amount;
    if(row.source==='confirmed')confirmed+=amount;else pending+=amount;
    const exclusionReasons=[
      'PROCESS_IDENTITY_UNAUTHENTICATED',
      'KEY_OWNERSHIP_UNVERIFIED',
      'SOURCE_PROVENANCE_UNVERIFIED',
      ...(row.source==='confirmed'?['MATURITY_POLICY_UNVERIFIED']:['UNCONFIRMED_PARENT'])
    ];
    rows.push(Object.freeze({outpoint:row.outpoint,amount_atoms:row.amount_atoms,
      source:row.source,
      ...(row.source==='confirmed'?{created_height:row.created_height}:
        {parent_txid:row.parent_txid}),
      spend_eligibility:'UNVERIFIED',
      exclusion_reasons:Object.freeze(exclusionReasons)}));
  }
  if(summed!==BigInt(payload.spendable_atoms))
    throw Error('Selected-node funding candidate total mismatch');
  return Object.freeze({ok:true,address,network:NETWORK,
    candidate_atoms:summed.toString(),confirmed_candidate_atoms:confirmed.toString(),
    pending_candidate_atoms:pending.toString(),candidate_count:rows.length,
    eligible_candidate_atoms:'0',eligible_candidate_count:0,
    funding_authorization:'DENIED_UNVERIFIED',
    outputs:Object.freeze(rows),
    authority:'SELECTED_NODE_UNTRUSTED_UTXO_CLAIM',
    maturity:'NOT_VERIFIED',ownership:'NOT_VERIFIED',
    signer:'UNAVAILABLE',submission:'NOT_PERFORMED'});
}
const MAX_READ_BYTES=2*1024*1024;
async function fetchRead(url,kind='status',address,validator=validateRead){
  const response=await fetch(url,{method:'GET',redirect:'error',headers:{accept:'application/json'},
    signal:AbortSignal.timeout(4000)});
  if(!response.ok)throw Error('FAE local read HTTP '+response.status);
  const size=Number(response.headers.get('content-length'));
  if(Number.isFinite(size)&&size>MAX_READ_BYTES){
    await response.body?.cancel().catch(()=>{});
    throw Error('FAE local read exceeded response limit');
  }
  let total=0;const chunks=[];
  try{
    for await(const chunk of response.body){
      total+=chunk.length;
      if(total>MAX_READ_BYTES)throw Error('FAE local read exceeded response limit');
      chunks.push(chunk);
    }
  }catch(error){
    await response.body?.cancel().catch(()=>{});
    throw error;
  }
  let payload;
  try{payload=JSON.parse(Buffer.concat(chunks,total).toString('utf8'))}
  catch{throw Error('FAE local read is not JSON')}
  return validator(payload,{kind,address});
}
class ProcessController extends EventEmitter{
  constructor({repoRoot,dataDir,port,nodeExecutable=process.execPath,
    spawnFn=spawn,portProbe=probeLoopbackPort,readinessProbe,listenEvidence=waitForManagedListenEvidence,
    nativeIpcCandidate=false}={}){
    super();
    this.repoRoot=path.resolve(repoRoot);
    this.dataDir=path.resolve(dataDir);
    const selectedPort=port===undefined?randomInt(32768,61000):port;
    if(!Number.isInteger(selectedPort)||selectedPort<1024||selectedPort>65535)
      throw Error('Invalid managed node port');
    this.port=selectedPort;
    this.endpoint='http://127.0.0.1:'+selectedPort;
    // With the real default probe, the first start asks the OS for an allowed
    // local port; explicit-port/test-probe callers retain their exact port.
    // A selected port is pinned through this controller's stop/restart cycle.
    this.osAssignedPortPending=port===undefined&&portProbe===probeLoopbackPort;
    this.nodeExecutable=nodeExecutable;
    this.spawnFn=spawnFn;this.portProbe=portProbe;this.listenEvidence=listenEvidence;
    // Inactive by default: protected node PR #354 is not yet admitted.
    // Candidate sessions must use the actual child-owned OS message port.
    // Never downgrade an attempted IPC read to localhost HTTP.
    if(typeof nativeIpcCandidate!=='boolean')throw Error('Invalid native IPC candidate mode');
    this.nativeIpcCandidate=nativeIpcCandidate;
    this.nodeIpc=null;
    this.readinessProbe=readinessProbe||(()=>fetchRead(new URL('/status',this.endpoint)));
    this.node=null;this.miner=null;this.nodeStarting=false;
    this.nodeStopping=false;this.nodeStopPromise=null;this.nodeGeneration=0;this.nodeStartGeneration=0;
    this.minerStarting=false;this.minerStopPending=false;
    this.minerStopPromise=null;this.minerGeneration=0;
    this.recoveryIssue=null;
    this.telemetry={state:'STOPPED',hashrate_hs:null,total_hashes:null,accepted:null,rejected:null};
  }
  snapshot(){return {network:NETWORK,node:this.nodeStopping||(this.nodeStarting&&this.nodeStartGeneration!==this.nodeGeneration)||this.node&&this.node.killed&&!this.node._tsExited&&this.node.exitCode===null?'stopping':this.nodeStarting?'starting':alive(this.node)?'running':'stopped',
    miner:this.minerStopPending||this.miner&&this.miner.killed&&!this.miner._tsExited&&this.miner.exitCode===null?'stopping':this.minerStarting?'starting':alive(this.miner)?'running':'stopped',
    node_recovery:this.recoveryIssue,telemetry:{...this.telemetry}}}
  spawnScript(script,args,extra={}){
    const env=makeEnv(extra);
    const child=this.spawnFn(this.nodeExecutable,[script,...args],{
      cwd:this.repoRoot,env,stdio:['ignore','pipe','ignore'],
      windowsHide:true
    });
    const invalidateMiner=()=>{
      // A stopped miner's previous hashrate is historical, never live.
      if(child===this.miner){
        this.telemetry={...this.telemetry,state:'STOPPED',hashrate_hs:null};
      }
    };
    const invalidateDependentMiner=()=>{
      // A managed node crash revokes the miner's permission to continue against its old port.
      // In particular, a newly bound (unowned) local process must never inherit mining.
      if(child===this.node&&alive(this.miner)){
        void this.stopMiner().catch(()=>this.emit('state',this.snapshot()));
      }
    };
    child.on('error',()=>{
      if(child===this.node)this.revokeNodeIpc();
      child._tsFailed=true;invalidateMiner();invalidateDependentMiner();
      this.emit('state',this.snapshot());
    });
    child.on('exit',()=>{
      if(child===this.node)this.revokeNodeIpc();
      child._tsExited=true;
      invalidateMiner();invalidateDependentMiner();
      this.emit('state',this.snapshot());
    });
    return child;
  }
  async stop(child,{graceMs=3000,killMs=1500}={}){
    if(!child||child._tsExited||child.exitCode!==null)return;
    // A successful kill() call or child.killed only confirms a signal attempt.
    // Never drop the owner reference before an actual exit event or exitCode.
    const waitForExit=(signal,timeoutMs)=>new Promise(resolve=>{
      let settled=false;
      const finish=observed=>{
        if(settled)return;
        settled=true;clearTimeout(timer);
        child.off('exit',onExit);
        resolve(observed);
      };
      const onExit=()=>{child._tsExited=true;finish(true)};
      child.on('exit',onExit);
      const timer=setTimeout(()=>finish(false),timeoutMs);
      if(child._tsExited||child.exitCode!==null)return finish(true);
      try{if(signal)child.kill(signal)}catch{finish(false);return}
      if(child._tsExited||child.exitCode!==null)finish(true);
    });
    if(await waitForExit(child.killed?null:'SIGTERM',graceMs))return;
    if(await waitForExit('SIGKILL',killMs))return;
    throw Error('Managed process termination not confirmed');
  }
  revokeNodeIpc(){
    if(this.nodeIpc)this.nodeIpc.revoke();
    this.nodeIpc=null;
  }
  async nativeRead(kind,params={}){
    this.assertNode();
    const child=this.node,channel=this.nodeIpc;
    if(!this.nativeIpcCandidate||!channel||channel.child!==child)
      throw Error('Native managed-node IPC channel unavailable');
    const observed=await channel.read(kind,params);
    this.assertNode();
    if(this.node!==child||this.nodeIpc!==channel)
      throw Error('Managed FAE IPC process changed during read');
    return observed;
  }
  async startNode(){
    if(this.nodeStopping)throw Error('Node shutdown pending');
    if(this.nodeStarting)throw Error('Node startup pending');
    if(this.node&&this.node.exitCode===null&&!this.node._tsExited){
      if(this.node.killed||this.node._tsFailed)throw Error('Managed node termination not confirmed');
      return this.snapshot();
    }
    this.nodeStarting=true;
    this.revokeNodeIpc();
    const generation=this.nodeGeneration;
    this.nodeStartGeneration=generation;
    const assertNotCanceled=()=>{
      if(this.nodeStopping||generation!==this.nodeGeneration)
        throw Error('Managed node startup canceled by Stop Node');
    };
    this.emit('state',this.snapshot());
    try{
      if(this.osAssignedPortPending){
        const allowed=await allocateOsAssignedLoopbackPort();
        assertNotCanceled();
        this.port=allowed;
        this.endpoint='http://127.0.0.1:'+allowed;
        this.osAssignedPortPending=false;
      }
      await this.portProbe(this.port);
      assertNotCanceled();
      const dir=path.join(this.dataDir,'node');
      await mkdir(dir,{recursive:true,mode:0o700});
      assertNotCanceled();
      try{
        await assertRecoverableLocalNodeState(path.join(dir,'state.json'));
        this.recoveryIssue=null;
      }catch(error){
        const message=String(error?.message||'');
        if(message.startsWith('Unresolved FAE node temporary state'))
          this.recoveryIssue='INTERRUPTED_STATE_WRITE';
        else if(message.startsWith('FAE node persisted state')||
          message.startsWith('FAE node state changed during preflight'))
          this.recoveryIssue='UNSAFE_PERSISTED_STATE';
        // No raw filesystem details are returned to the renderer.
        throw error;
      }
      // The shutdown may have completed while asynchronous preflight ran.
      // A stale startup can never launch a new process after Stop Node.
      assertNotCanceled();
      this.node=this.spawnScript(path.join(this.repoRoot,'sovereign-forge','node','fae-node.mjs'),[],{
        FAE_HOST:'127.0.0.1',FAE_PORT:String(this.port),FAE_DATA_FILE:path.join(dir,'state.json'),
        FAE_SYNC:'0',FAE_UPSTREAM_API:'',FAE_PEERS:'',FAE_BOOTSTRAP_FEEDS:'',
        ...(this.nativeIpcCandidate?{[IPC_ENV_FLAG]:'1'}:{})
      });
      // The child must itself report successful listen before any HTTP status
      // could be considered. This closes the basic prebind spoof admission gap.
      await this.listenEvidence({child:this.node,host:'127.0.0.1',port:this.port});
      assertNotCanceled();
      if(this.nativeIpcCandidate)this.nodeIpc=new OwnedNodeIpc(this.node,{timeoutMs:3500});
      await verifyManagedReadiness({child:this.node,
        readStatus:this.nativeIpcCandidate?()=>this.nodeIpc.read('status'):this.readinessProbe});
      assertNotCanceled();
      this.nodeStarting=false;this.emit('state',this.snapshot());
      return this.snapshot();
    }catch(e){
      this.revokeNodeIpc();
      const old=this.node;this.nodeStarting=false;
      try{await this.stop(old)}catch(shutdownError){
        this.emit('state',this.snapshot());
        throw Error('Managed node startup failed; '+shutdownError.message);
      }
      if(this.node===old)this.node=null;
      this.emit('state',this.snapshot());throw e;
    }
  }
  stopMiner(){
    if(this.minerStopPromise)return this.minerStopPromise;
    // Revoke pending launch authority before the first asynchronous boundary.
    // Otherwise Stop Mining can return before an in-flight /status check starts a miner.
    this.minerGeneration++;
    this.minerStopPending=true;
    this.minerStopPromise=(async()=>{
      try{
        await this.stop(this.miner);
        this.miner=null;
        this.telemetry={...this.telemetry,state:'STOPPED',hashrate_hs:null};
      }finally{
        this.minerStopPending=false;
        this.minerStopPromise=null;
        this.emit('state',this.snapshot());
      }
      return this.snapshot();
    })();
    this.emit('state',this.snapshot());
    return this.minerStopPromise;
  }
  async stopNode(){
    if(this.nodeStopPromise)return this.nodeStopPromise;
    // Revoke all in-flight startup continuations before the first await.
    // The generation is not reset when shutdown finishes.
    this.nodeGeneration++;
    this.revokeNodeIpc();
    this.nodeStopping=true;
    this.emit('state',this.snapshot());
    this.nodeStopPromise=(async()=>{
      try{
        await this.stopMiner();
        await this.stop(this.node);
        this.node=null;
      }finally{
        this.nodeStopping=false;
        this.nodeStopPromise=null;
        this.emit('state',this.snapshot());
      }
      return this.snapshot();
    })();
    return this.nodeStopPromise;
  }
  assertNode(){assertManagedNodeReady(this.node,this.nodeStarting||this.nodeStopping)}
  async readStatus(){
    if(this.nativeIpcCandidate)
      return validateRead(await this.nativeRead('status'),{kind:'status'});
    this.assertNode();const owned=this.node;
    const observed=await fetchRead(new URL('/status',this.endpoint));
    // The loopback response could arrive AFTER managed-child death/replacement.
    // This does not authenticate the endpoint, but revokes late observations.
    this.assertNode();
    if(this.node!==owned)throw Error('Managed node changed during status observation');
    return observed;
  }
  async observedReadAtStableTip(read,{includeTip=false}={}){
    this.assertNode();
    const ownedChild=this.node;
    const before=this.nativeIpcCandidate?
      validateRead(await this.nativeRead('status'),{kind:'status'}):
      await fetchRead(new URL('/status',this.endpoint));
    this.assertNode();
    if(this.node!==ownedChild)throw Error('Managed FAE node changed during observation');
    const result=await read();
    this.assertNode();
    if(this.node!==ownedChild)throw Error('Managed FAE node changed during observation');
    const after=this.nativeIpcCandidate?
      validateRead(await this.nativeRead('status'),{kind:'status'}):
      await fetchRead(new URL('/status',this.endpoint));
    this.assertNode();
    if(this.node!==ownedChild||before.height!==after.height||before.tip_hash!==after.tip_hash)
      throw Error('FAE chain tip changed during observation');
    if(result?.observed_tip_height!==undefined&&
       (result.observed_tip_height!==before.height||result.observed_tip_hash!==before.tip_hash))
      throw Error('Explorer observation does not match stable chain tip');
    return includeTip?{...result,observed_tip_height:before.height,observed_tip_hash:before.tip_hash}:result;
  }
  async readBalance(address){
    const requested=addressValid(address);
    return this.observedReadAtStableTip(()=>
      this.nativeIpcCandidate?
        this.nativeRead('balance',{address:requested}).then(p=>validateRead(p,{kind:'balance',address:requested})):
        fetchRead(new URL('/balance?address='+encodeURIComponent(requested),this.endpoint),'balance',requested),{includeTip:true});
  }
  async readFundingCandidates(address){
    const requested=addressValid(address);
    const observed=await this.observedReadAtStableTip(()=>
      this.nativeIpcCandidate?
        this.nativeRead('spendable',{address:requested}).then(p=>validateFundingCandidatePayload(p,{address:requested})):
        fetchRead(new URL('/spendable?address='+encodeURIComponent(requested),this.endpoint),
          'funding',requested,validateFundingCandidatePayload),{includeTip:true});
    if(observed.outputs.some(row=>row.source==='confirmed'&&row.created_height>observed.observed_tip_height))
      throw Error('Selected-node funding candidate exceeds observed chain tip');
    return observed;
  }
  async readExplorer(route,params){
    const url=explorerUrl(route,params,this.endpoint);
    const observed=await this.observedReadAtStableTip(()=>
      fetchRead(url,'explorer'));
    if(route==='/explorer/address'){
      // An incompatible or mismatched selected-node response is never wallet activity.
      const cursor=params?.cursor;
      const match=cursor===undefined?null:/^([0-9a-f]{64}):(0|[1-9][0-9]*)$/.exec(String(cursor));
      const start=match?Number(match[2]):0;
      if(cursor!==undefined&&(!match||match[1]!==observed.observed_tip_hash||
          !Number.isSafeInteger(start)))throw Error('Unverified wallet activity cursor');
      const next=observed.next_cursor;
      const expected=start+(Array.isArray(observed.events)?observed.events.length:0);
      const nextMatches=typeof next==='string'&&
        next===observed.observed_tip_hash+':'+expected;
      if(observed.address!==params?.address||!Array.isArray(observed.events)||
        observed.events.length>100||!Number.isSafeInteger(observed.total_events)||
        observed.total_events<expected||
        !/^\d+$/.test(String(observed.balance_atoms??''))||
        new Set(observed.events.map(e=>e?.id)).size!==observed.events.length||
        observed.events.some(e=>typeof e?.id!=='string'||e.id.length>130)||
        (next!==null&&!(nextMatches&&expected<observed.total_events))||
        (next===null&&expected<observed.total_events))
        throw Error('Unverified selected-node wallet activity response');
    }
    return observed;
  }
  ingestMiner(line){
    if(typeof line!=='string'||line.length>8192)return;
    let event;try{event=JSON.parse(line)}catch{return}
    if(!event||!EVENTS.has(event.state))return;
    const t={...this.telemetry,state:event.state};
    for(const k of ['hashrate_hs','total_hashes','accepted','rejected'])
      if(event[k]!==undefined&&Number.isSafeInteger(event[k])&&event[k]>=0)t[k]=event[k];
    this.telemetry=t;this.emit('state',this.snapshot());
  }
  async startMiner(address){
    addressValid(address);this.assertNode();
    // The pending bit is acquired synchronously, before status I/O. Two
    // renderer requests must never create a second, untracked miner process.
    if(this.minerStarting)throw Error('Miner startup pending');
    if(this.minerStopPending)throw Error('Miner shutdown pending');
    if(this.miner&&this.miner.exitCode===null&&!this.miner._tsExited){
      if(this.miner.killed||this.miner._tsFailed)throw Error('Miner termination not confirmed');
      throw Error('Miner already running');
    }
    this.minerStarting=true;
    const owned=this.node,launchGeneration=this.minerGeneration;
    this.emit('state',this.snapshot());
    try{
      // Includes the existing managed-child before/after lifecycle checks.
      await this.readStatus();
      this.assertNode();
      if(this.minerStopPending||launchGeneration!==this.minerGeneration)
        throw Error('Miner launch canceled by Stop Mining');
      if(this.node!==owned)throw Error('Managed node changed before miner launch');
      if(alive(this.miner))throw Error('Miner already running');
      this.telemetry={state:'CONNECTING',hashrate_hs:null,total_hashes:null,accepted:null,rejected:null};
      this.miner=this.spawnScript(path.join(this.repoRoot,'standalone','fae-miner.mjs'),
        ['--node',this.endpoint,'--address',address,'--json','--yield-ms','20']);
      let buffer='';
      this.miner.stdout?.setEncoding?.('utf8');
      this.miner.stdout?.on?.('data',data=>{
        buffer+=data;
        if(buffer.length>16384){buffer='';return}
        let end;while((end=buffer.indexOf('\n'))>=0){this.ingestMiner(buffer.slice(0,end));buffer=buffer.slice(end+1)}
      });
      this.minerStarting=false;
      this.emit('state',this.snapshot());return this.snapshot();
    }catch(error){
      if(!alive(this.miner))this.telemetry={...this.telemetry,state:'STOPPED',hashrate_hs:null};
      this.minerStarting=false;
      this.emit('state',this.snapshot());
      throw error;
    }
  }
  async dispose(){await this.stopNode()}
}
module.exports={ProcessController,makeEnv,explorerUrl,addressValid,fetchRead,validateFundingCandidatePayload,HOST,NETWORK};
