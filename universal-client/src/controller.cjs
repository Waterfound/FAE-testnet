'use strict';
const {spawn,fork}=require('node:child_process');
const {mkdir,readFile,writeFile}=require('node:fs/promises');
const path=require('node:path');
const {EventEmitter}=require('node:events');
const {randomInt,randomBytes,createHash}=require('node:crypto');
const {assertRecoverableLocalNodeState}=require('./node-storage-preflight.cjs');
const {NETWORK,validateRead}=require('./bridge-contract.cjs');
const {OwnedNodeIpc,IPC_ENV_FLAG}=require('./owned-node-ipc.cjs');
const {OwnedOriginalMinerBridge}=require('./owned-original-miner-bridge.cjs');
const {validateNativeNodeSourcePins,assertPinnedOriginalNodeSources,
  assertPinnedOriginalMinerSources,assertPinnedDisposableWalletSignerSource,
  assertPinnedIsolatedVaultSigner,ISOLATED_VAULT_SIGNER_SHA256,
  ISOLATED_VAULT_SIGNER_FILE}=require('./pinned-node-source.cjs');
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
    // The original node derives every pending outpoint from its real parent TXID.
    // A different claimed parent is contradictory even for untrusted public reads.
    if(row.source==='pending'&&
       (typeof row.parent_txid!=='string'||!DIGEST.test(row.parent_txid)||
        row.outpoint.slice(0,64)!==row.parent_txid||
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
    nativeIpcCandidate=false,nativeNodeSourcePins=null}={}){
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
    this.nativeNodeSourcePins=nativeIpcCandidate?
      validateNativeNodeSourcePins(nativeNodeSourcePins):null;
    this.nodeIpc=null;
    this.readinessProbe=readinessProbe||(()=>fetchRead(new URL('/status',this.endpoint)));
    this.node=null;this.miner=null;this.nodeStarting=false;
    this.nodeStopping=false;this.nodeStopPromise=null;this.nodeGeneration=0;this.nodeStartGeneration=0;
    this.nativeMinerBridge=null;
    // V54: isolated disposable Wallet OS-child candidate. No GUI or production
    // signer admission; the bridge is intentionally absent from installers.
    this.signer=null;this.signerStarting=false;this.signerStopPending=false;
    this.signerStopPromise=null;this.signerGeneration=0;
    this.minerStarting=false;this.minerStopPending=false;
    this.minerStopPromise=null;this.minerGeneration=0;
    this.recoveryIssue=null;
    this.telemetry={state:'STOPPED',hashrate_hs:null,total_hashes:null,accepted:null,rejected:null};
  }
  snapshot(){return {network:NETWORK,node:this.nodeStopping||(this.nodeStarting&&this.nodeStartGeneration!==this.nodeGeneration)||this.node&&this.node.killed&&!this.node._tsExited&&this.node.exitCode===null?'stopping':this.nodeStarting?'starting':alive(this.node)?'running':'stopped',
    miner:this.minerStopPending||this.miner&&this.miner.killed&&!this.miner._tsExited&&this.miner.exitCode===null?'stopping':this.minerStarting?'starting':alive(this.miner)?'running':'stopped',
    node_recovery:this.recoveryIssue,
    // Legacy HTTP mining is explicitly not authenticated original-node
    // mutation. Native IPC mining remains disabled pending source-owner
    // admission of submit-mined-block; never show either as trusted.
    mining_submission:this.nativeIpcCandidate?'NATIVE_BLOCK_SUBMISSION_NOT_ADMITTED':'LEGACY_HTTP_UNAUTHENTICATED',
    telemetry:{...this.telemetry}}}
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
    const invalidateDependentSigner=()=>{
      if(child===this.node&&(alive(this.signer)||this.signerStarting))
        void this.stopIsolatedSigner().catch(()=>this.emit('state',this.snapshot()));
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
      child._tsFailed=true;invalidateMiner();invalidateDependentMiner();invalidateDependentSigner();
      this.emit('state',this.snapshot());
    });
    child.on('exit',()=>{
      if(child===this.node)this.revokeNodeIpc();
      child._tsExited=true;
      invalidateMiner();invalidateDependentMiner();invalidateDependentSigner();
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
      // Refuse a substituted original node or missing IPC module before spawn.
      // The protected owner must admit the pinned bytes separately.
      if(this.nativeIpcCandidate)
        await assertPinnedOriginalNodeSources(this.repoRoot,this.nativeNodeSourcePins);
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
      // Catch commonplace post-preflight file replacement before admitting
      // the child as RUNNING. This does not eliminate kernel-level TOCTOU.
      if(this.nativeIpcCandidate)
        await assertPinnedOriginalNodeSources(this.repoRoot,this.nativeNodeSourcePins);
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
    this.nativeMinerBridge?.stop();
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
    this.signerGeneration++;
    this.nodeStopping=true;
    this.emit('state',this.snapshot());
    this.nodeStopPromise=(async()=>{
      try{
        await this.stopMiner();
        await this.stopIsolatedSigner();
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
  async readTransactionByTxid(txid){
    // Read-only deterministic reconciliation: never submit/retry from lookup.
    // This is candidate-only; the default product has no native owner admission.
    if(typeof txid!=='string'||!/^[0-9a-f]{64}$/.test(txid))
      throw Error('Canonical transaction ID required for native lookup');
    if(!this.nativeIpcCandidate)
      throw Error('Authenticated original-node transaction lookup unavailable');
    // An IPC transaction reply reflects one original-node chain snapshot.
    // Bracket it with authenticated node status reads, just as with public
    // balance/funding reads, so a reorg cannot silently promote a stale
    // pending/confirmed answer into an apparently current observation.
    const result=await this.observedReadAtStableTip(()=>
      this.nativeRead('transaction-lookup',{txid}),{includeTip:true});
    if(!result||typeof result!=='object'||Array.isArray(result)||
      result.ok!==true||result.network!==NETWORK||result.txid!==txid||
      typeof result.found!=='boolean'||
      !Number.isSafeInteger(result.tip_height)||result.tip_height<0||
      typeof result.tip_hash!=='string'||!/^[0-9a-f]{64}$/.test(result.tip_hash)||
      (result.found?
        result.status==='pending'?result.confirmed_height!==null:
        result.status==='confirmed'?
          !Number.isSafeInteger(result.confirmed_height)||
          result.confirmed_height<1||result.confirmed_height>result.tip_height:
        true:
        result.status!==null||result.confirmed_height!==null))
      throw Error('Invalid native original-node transaction evidence');
    if(result.tip_height!==result.observed_tip_height||
       result.tip_hash!==result.observed_tip_hash)
      throw Error('Native transaction lookup chain tip mismatch');
    return Object.freeze({
      txid,result_known:result.found,status:result.status,
      confirmed_height:result.confirmed_height,
      observed_tip_height:result.tip_height,observed_tip_hash:result.tip_hash,
      confirmation_finality:'NOT_PROVEN'
    });
  }
  async readExplorer(route,params){
    // Original node owner #354 presently exposes native status/balance/spendable
    // only. HTTP Explorer cannot inherit the native channel's provenance.
    // Refuse to upgrade an unauthenticated listener observation to IPC trust.
    if(this.nativeIpcCandidate)
      throw Error('Authenticated Explorer IPC unavailable; HTTP fallback forbidden');
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
  // V51 owner-compatible original Miner OS-worker lifecycle integrated into
  // the actual ProcessController. No renderer IPC handler calls this method.
  // Current product always constructs nodeIpc with allowBlockMutation=false;
  // until original-source admission, this operation is strictly unavailable.
  // The trusted caller must source-pin the original Miner worker before forking
  // it, as the V50/V51 exact-owner OS-child integration test does.
  async runAdmittedOriginalMinerWorkerOnce({minerChild,address,onTelemetry,minerSourcePins}={}){
    addressValid(address);
    this.assertNode();
    const node=this.node,ipc=this.nodeIpc;
    if(!this.nativeIpcCandidate||!ipc||ipc.child!==node||
       !ipc.allowBlockMutation||ipc.revoked)
      throw Error('Original-node native block mutation not owner-admitted');
    if(this.minerStarting||this.minerStopPending||alive(this.miner))
      throw Error('Original Miner already running or lifecycle pending');
    const ownerNode=node,ownerIpc=ipc,previousGeneration=this.minerGeneration;
    // Source-owner supplied SHA-256 pins, not hashes copied from the running
    // worker. This is a candidate integrity check, not owner admission.
    await assertPinnedOriginalMinerSources(this.repoRoot,minerSourcePins);
    this.assertNode();
    if(this.node!==ownerNode||this.nodeIpc!==ownerIpc||
       ipc.revoked||!ipc.allowBlockMutation||
       this.minerGeneration!==previousGeneration||this.minerStopPending||
       this.minerStarting||alive(this.miner))
      throw Error('Original Miner owner changed during source preflight');
    const expected=path.join(this.repoRoot,'universal-client','src',
      'v34-original-miner-owned-worker.mjs');
    if(!minerChild||!Array.isArray(minerChild.spawnargs)||
       !minerChild.spawnargs.includes(expected))
      throw Error('Original Miner owner worker source identity required');
    const generation=this.minerGeneration;
    const bridge=new OwnedOriginalMinerBridge({minerChild,nodeIpc:ipc,
      nodeEndpoint:this.endpoint,address,onTelemetry:event=>{
        // Original worker reports public progress only. Reuse the existing
        // controller's state telemetry rather than adding an unrelated UI path.
        if(this.miner===minerChild)this.ingestMiner(JSON.stringify(event));
        if(onTelemetry)onTelemetry(event);
      }});
    this.miner=minerChild;this.nativeMinerBridge=bridge;
    this.minerStarting=false;this.emit('state',this.snapshot());
    try{
      const result=await bridge.run();
      // Accepted count is based on the actual original-node durable receipt,
      // never an untrusted worker-side 'WORK_ACCEPTED' string.
      this.telemetry={...this.telemetry,accepted:result.block_count};
      this.emit('state',this.snapshot());
      this.assertNode();
      if(this.node!==node||this.nodeIpc!==ipc||
         this.minerGeneration!==generation||this.miner!==minerChild)
        throw Error('Original Miner owner process changed before completion');
      return result;
    }finally{
      if(this.nativeMinerBridge===bridge)this.nativeMinerBridge=null;
      if(this.miner===minerChild)this.miner=null;
      this.telemetry={...this.telemetry,state:'STOPPED',hashrate_hs:null};
      this.emit('state',this.snapshot());
    }
  }

  // V54 CANDIDATE-ONLY: runs the existing V52 disposable original Wallet
  // signer under actual ProcessController lifecycle, never from renderer IPC.
  // The bridge is NOT packaged, no real encrypted vault may be unlocked, and
  // the normal app constructs nativeIpcCandidate=false.
  async runIsolatedOriginalWalletSignerCandidateOnce({
    signerSourceSha256,from,to,outpoint
  }={}){
    if(process.env.TS_V54_ISOLATED_SIGNER_OWNER_PROOF!=='1')
      throw Error('Original Wallet signer product admission not granted');
    if(this.signerStarting||this.signerStopPending||alive(this.signer))
      throw Error('Disposable Wallet signer session already active');
    this.assertNode();
    const node=this.node,channel=this.nodeIpc,generation=this.signerGeneration;
    if(!this.nativeIpcCandidate||!channel||channel.child!==node||
       !channel.allowSignedTxMutation||channel.revoked||this.nodeStopping)
      throw Error('Original Wallet signed mutation not source-owner admitted');
    if(typeof from!=='string'||typeof to!=='string'||from===to||
       !ADDRESS.test(from)||!ADDRESS.test(to)||!OUTPOINT.test(outpoint))
      throw Error('Disposable Wallet signing intent rejected');
    // Acquire synchronously before source attestation; Stop Node invalidates
    // this generation even when it interrupts the asynchronous preflight.
    this.signerStarting=true;
    let signerChild=null;
    try{
      await assertPinnedDisposableWalletSignerSource(this.repoRoot,signerSourceSha256);
      if(this.node!==node||this.nodeIpc!==channel||
         channel.revoked||this.signerGeneration!==generation||
         this.signerStopPending||this.nodeStopping||!alive(node))
        throw Error('Disposable Wallet signer source owner changed before launch');
      const signerScript=path.join(this.repoRoot,'universal-client','src',
        'v52-disposable-original-wallet-signer.mjs');
      // Real ProcessController owns actual creation, termination and recovery.
      // Only controlled disposable identities: no vault, passwords or mnemonic.
      signerChild=fork(signerScript,[],{cwd:this.repoRoot,execArgv:[],
        env:makeEnv({TS_V52_DISPOSABLE_SIGNER_PROOF:'isolated-owner-fixture'}),
        windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});
      const {OwnedDisposableWalletSignerBridge}=require(
        './owned-disposable-wallet-signer-bridge.cjs');
      const bridge=new OwnedDisposableWalletSignerBridge({
        signerChild,signerScript,nodeIpc:channel,from,to});
      this.signer=signerChild;
      this.signerStarting=false;
      const receipt=await bridge.signAndSubmitOnce(outpoint);
      if(this.node!==node||this.nodeIpc!==channel||
         channel.revoked||this.signerGeneration!==generation||
         this.signerStopPending||this.signer!==signerChild)
        throw Error('Signer or original node changed during transaction; outcome unknown');
      return receipt;
    }finally{
      this.signerStarting=false;
      // No abandoned OS child, even on mismatch, shutdown or unknown ACK.
      await this.stop(signerChild);
      if(this.signer===signerChild)this.signer=null;
    }
  }

  // V55 TEST-ONLY real encrypted original Wallet #342 custody proof.
  // Original source closure is independently pinned and SNAPSHOTTED before
  // launch. Worker holds all secret material privately, and the ordinary app
  // exposes NO renderer action. Source-owner admission remains UNGRANTED.
  async runIsolatedOriginalVaultCandidateOnce({to,prepareFunding}={}){
    if(process.env.TS_V55_ISOLATED_VAULT_OWNER_PROOF!=='1')
      throw Error('Protected original Wallet user-signing admission not granted');
    if(this.signerStarting||this.signerStopPending||alive(this.signer))
      throw Error('Native Wallet signer session already owned');
    addressValid(to);
    if(typeof prepareFunding!=='function')
      throw Error('Isolated original Wallet fixture funding callback required');
    this.assertNode();
    const node=this.node,channel=this.nodeIpc,generation=this.signerGeneration;
    if(!this.nativeIpcCandidate||!channel||channel.child!==node||
       !channel.allowSignedTxMutation||channel.revoked||this.nodeStopping)
      throw Error('Original Wallet native submission source-owner gate closed');
    this.signerStarting=true; // single-flight acquired synchronously
    let child=null,stage=null;
    const validOwner=()=>this.node===node&&this.nodeIpc===channel&&
      this.signerGeneration===generation&&!this.nodeStopping&&
      !this.signerStopPending&&!channel.revoked&&alive(node);
    const MODE='TS_V55_ISOLATED_ORIGINAL_VAULT_ONLY';
    const SESSION=randomBytes(32).toString('hex');
    const exchange=(packet,requestId,timeoutMs=12000)=>new Promise((resolve,reject)=>{
      let complete=false;
      const finish=(error,response)=>{
        if(complete)return;complete=true;clearTimeout(timer);
        child.off('message',onMessage);child.off('exit',onExit);
        child.off('disconnect',onExit);child.off('error',onExit);
        error?reject(error):resolve(response);
      };
      const onExit=()=>finish(Error('Isolated original Wallet OS signer outcome unknown'));
      const onMessage=response=>{
        let size;
        try{size=Buffer.byteLength(JSON.stringify(response),'utf8')}
        catch{return onExit()}
        if(!response||typeof response!=='object'||Array.isArray(response)||
           size>65536||response.mode!==MODE||response.network!==NETWORK||
           response.session!==SESSION||response.request_id!==requestId)
          return onExit();
        finish(null,response);
      };
      const timer=setTimeout(onExit,timeoutMs);
      child.on('message',onMessage);child.on('exit',onExit);
      child.on('disconnect',onExit);child.on('error',onExit);
      if(!child.connected)return onExit();
      child.send(packet,error=>{if(error)onExit()});
    });
    try{
      // Trusted source-owner original Wallet import closure and immutable
      // snapshot already exist: do not recreate key/vault crypto.
      const {prepareAttestedWalletSource}=require('./native-wallet-terminal-handoff.cjs');
      await assertPinnedIsolatedVaultSigner(this.repoRoot);
      stage=await prepareAttestedWalletSource(path.join(this.repoRoot,
        'standalone','wallet','fae-wallet.mjs'));
      if(!validOwner())throw Error('Original node owner changed during Wallet attestation');
      const original=path.join(this.repoRoot,...ISOLATED_VAULT_SIGNER_FILE.split('/'));
      const script=path.join(stage.root,...ISOLATED_VAULT_SIGNER_FILE.split('/'));
      const bytes=await readFile(original);
      if(createHash('sha256').update(bytes).digest('hex')!==ISOLATED_VAULT_SIGNER_SHA256)
        throw Error('Original Wallet signer source drift before immutable staging');
      await mkdir(path.dirname(script),{recursive:true,mode:0o700});
      await writeFile(script,bytes,{flag:'wx',mode:0o400});
      if(!validOwner())throw Error('Original node owner changed before Wallet spawn');
      await mkdir(this.dataDir,{recursive:true,mode:0o700});
      // This proof is intentionally disposable: its random vault password
      // remains only in this worker's memory, never in args/env/IPC.
      child=fork(script,[],{cwd:this.dataDir,execArgv:[],
        env:makeEnv({TS_V55_ISOLATED_VAULT_OWNER_PROOF:'isolated-only'}),
        windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});
      this.signer=child;this.signerStarting=false;
      const init=await exchange({mode:MODE,network:NETWORK,session:SESSION,
        request_id:1},1,30000);
      if(Object.keys(init).sort().join(',')!=='from,mode,network,request_id,session,status'||
         init.status!=='ORIGINAL_ENCRYPTED_VAULT_READY'||
         typeof init.from!=='string'||!ADDRESS.test(init.from)||init.from===to)
        throw Error('Original encrypted vault worker identity reply invalid');
      if(!validOwner()||this.signer!==child)
        throw Error('Original node owner replaced during Vault initialization');
      // Only this trusted test callback can fund the new, random disposable
      // vault address; it cannot grant user Wallet authority.
      const funding=await prepareFunding(init.from);
      if(!validOwner()||this.signer!==child)
        throw Error('Original node replaced while funding disposable Wallet');
      if(!funding||typeof funding!=='object'||Array.isArray(funding)||
         Object.keys(funding).sort().join(',')!==
          'outpoint,source_atoms,tip_hash,tip_height'||
         !OUTPOINT.test(funding.outpoint)||funding.source_atoms!=='1000000000'||
         !Number.isSafeInteger(funding.tip_height)||funding.tip_height!==1||
         !DIGEST.test(funding.tip_hash))
        throw Error('Invalid original source-authorized disposable funding');
      const observed=await channel.read('status');
      if(!validOwner()||observed.height!==funding.tip_height||
         observed.tip_hash!==funding.tip_hash)
        throw Error('Original node tip changed before isolated Wallet approval');
      const intent=Object.freeze({
        from:init.from,to,outpoint:funding.outpoint,
        source_atoms:funding.source_atoms,amount_atoms:'100000000',
        fee_atoms:'1',tip_height:funding.tip_height,tip_hash:funding.tip_hash,
        node:this.endpoint,authorization_id:randomBytes(32).toString('hex'),
        disposable_test_authorized:true
      });
      const signed=await exchange({mode:MODE,network:NETWORK,
        session:SESSION,request_id:2,intent},2,30000);
      if(!validOwner()||this.signer!==child)
        throw Error('Original Wallet/node owner changed after durable outbox; outcome unknown');
      if(Object.keys(signed).sort().join(',')!==
          'authorization_id,from,mode,network,request_id,session,status,to,tx,txid'||
         signed.status!=='ORIGINAL_VAULT_SIGNED_OUTBOX_DURABLE'||
         signed.from!==init.from||signed.to!==to||
         signed.authorization_id!==intent.authorization_id||
         typeof signed.txid!=='string'||!DIGEST.test(signed.txid)||
         !signed.tx||signed.tx.network!==NETWORK||signed.tx.version!==2||
         !Array.isArray(signed.tx.inputs)||signed.tx.inputs.length!==1||
         signed.tx.inputs[0]!==intent.outpoint||
         !Array.isArray(signed.tx.outputs)||signed.tx.outputs.length!==2||
         signed.tx.outputs[0]?.address!==to||
         signed.tx.outputs[0]?.amount_atoms!=='100000000'||
         signed.tx.outputs[1]?.address!==init.from||
         signed.tx.outputs[1]?.amount_atoms!=='899999999')
        throw Error('Original Wallet encrypted outbox signed receipt invalid');
      // The original trusted node performs crypto validation and persistence.
      // Single submit, no retry on timeout/unknown outcome.
      const receipt=await channel.submitSignedTx(signed.tx,signed.txid);
      if(!validOwner()||this.signer!==child)
        throw Error('Native Wallet/node changed after submit; outcome unknown');
      return Object.freeze({from:init.from,to,txid:signed.txid,receipt,
        vault_path:path.join(this.dataDir,'v55-isolated-original.vault.json'),
        outbox_path:path.join(this.dataDir,'v55-isolated-original.vault.json.outbox.json'),
        authority:'ISOLATED_DISPOSABLE_ORIGINAL_VAULT_ONLY',
        user_authorization:'TEST_FIXTURE_NOT_REAL_USER'});
    }finally{
      this.signerStarting=false;
      await this.stop(child);
      if(this.signer===child)this.signer=null;
      await stage?.release();
    }
  }
  stopIsolatedSigner(){
    this.signerGeneration++;
    const signer=this.signer;
    if(this.signerStopPromise)return this.signerStopPromise;
    this.signerStopPending=true;
    const promise=(async()=>{
      try{await this.stop(signer)}
      finally{
        if(this.signer===signer)this.signer=null;
        this.signerStopPending=false;
        this.signerStopPromise=null;
      }
    })();
    this.signerStopPromise=promise;
    return promise;
  }
  async startMiner(address){
    addressValid(address);this.assertNode();
    if(this.nativeIpcCandidate)throw Error('Native original-node block submission not admitted');
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
      const ownedMiner=this.miner;
      ownedMiner.stdout?.setEncoding?.('utf8');
      ownedMiner.stdout?.on?.('data',data=>{
        if(this.miner!==ownedMiner||!alive(ownedMiner)||this.minerStopPending){
          buffer='';
          return;
        }
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
