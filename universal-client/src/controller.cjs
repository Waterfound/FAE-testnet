'use strict';
const {spawn}=require('node:child_process');
const {mkdir}=require('node:fs/promises');
const path=require('node:path');
const {EventEmitter,once}=require('node:events');
const {randomInt}=require('node:crypto');
const {assertRecoverableLocalNodeState}=require('./node-storage-preflight.cjs');
const {NETWORK,validateRead}=require('./bridge-contract.cjs');
const {isManagedChildAlive:alive,assertManagedNodeReady,probeLoopbackPort,verifyManagedReadiness,waitForManagedListenEvidence}=require('./managed-node-gate.cjs');

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
const MAX_READ_BYTES=2*1024*1024;
async function fetchRead(url,kind='status',address){
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
  return validateRead(payload,{kind,address});
}
class ProcessController extends EventEmitter{
  constructor({repoRoot,dataDir,port=randomInt(32768,61000),nodeExecutable=process.execPath,
    spawnFn=spawn,portProbe=probeLoopbackPort,readinessProbe,listenEvidence=waitForManagedListenEvidence}={}){
    super();
    this.repoRoot=path.resolve(repoRoot);
    this.dataDir=path.resolve(dataDir);
    if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid managed node port');
    this.port=port;
    this.endpoint='http://127.0.0.1:'+port;
    this.nodeExecutable=nodeExecutable;
    this.spawnFn=spawnFn;this.portProbe=portProbe;this.listenEvidence=listenEvidence;
    this.readinessProbe=readinessProbe||(()=>fetchRead(new URL('/status',this.endpoint)));
    this.node=null;this.miner=null;this.nodeStarting=false;
    this.nodeStopping=false;this.nodeStopPromise=null;
    this.minerStarting=false;this.minerStopPending=false;
    this.minerStopPromise=null;this.minerGeneration=0;
    this.telemetry={state:'STOPPED',hashrate_hs:null,total_hashes:null,accepted:null,rejected:null};
  }
  snapshot(){return {network:NETWORK,node:this.nodeStarting?'starting':alive(this.node)?'running':'stopped',
    miner:this.minerStopPending?'stopping':this.minerStarting?'starting':alive(this.miner)?'running':'stopped',
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
    const invalidateDependentMiner=()=>{
      // A managed node crash revokes the miner's permission to continue against its old port.
      // In particular, a newly bound (unowned) local process must never inherit mining.
      if(child===this.node&&alive(this.miner)){
        void this.stopMiner().catch(()=>this.emit('state',this.snapshot()));
      }
    };
    child.on('error',()=>{
      child._tsFailed=true;invalidateMiner();invalidateDependentMiner();
      this.emit('state',this.snapshot());
    });
    child.on('exit',()=>{
      invalidateMiner();invalidateDependentMiner();
      this.emit('state',this.snapshot());
    });
    return child;
  }
  async stop(child){
    if(!child||child.exitCode!==null)return;
    if(!child.killed)child.kill('SIGTERM');
    if(child.exitCode!==null)return;
    let timer;
    try{await Promise.race([once(child,'exit').catch(()=>{}),
      new Promise(resolve=>{timer=setTimeout(()=>{if(child.exitCode===null)child.kill('SIGKILL');resolve()},3000)})])}
    finally{clearTimeout(timer)}
  }
  async startNode(){
    if(this.nodeStopping)throw Error('Node shutdown pending');
    if(this.nodeStarting)throw Error('Node startup pending');
    if(alive(this.node))return this.snapshot();
    this.nodeStarting=true;
    try{
      await this.portProbe(this.port);
      const dir=path.join(this.dataDir,'node');
      await mkdir(dir,{recursive:true,mode:0o700});
      await assertRecoverableLocalNodeState(path.join(dir,'state.json'));
      this.node=this.spawnScript(path.join(this.repoRoot,'sovereign-forge','node','fae-node.mjs'),[],{
        FAE_HOST:'127.0.0.1',FAE_PORT:String(this.port),FAE_DATA_FILE:path.join(dir,'state.json'),
        FAE_SYNC:'0',FAE_UPSTREAM_API:'',FAE_PEERS:'',FAE_BOOTSTRAP_FEEDS:''
      });
      // The child must itself report successful listen before any HTTP status
      // could be considered. This closes the basic prebind spoof admission gap.
      await this.listenEvidence({child:this.node,host:'127.0.0.1',port:this.port});
      await verifyManagedReadiness({child:this.node,readStatus:this.readinessProbe});
      this.nodeStarting=false;this.emit('state',this.snapshot());
      return this.snapshot();
    }catch(e){
      const old=this.node;this.node=null;this.nodeStarting=false;
      await this.stop(old).catch(()=>{});
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
    // Synchronously revoke read and miner-launch authority before any await.
    this.nodeStopping=true;
    this.nodeStopPromise=(async()=>{
      try{
        await this.stopMiner();
        await this.stop(this.node);
        this.node=null;
        this.emit('state',this.snapshot());
        return this.snapshot();
      }finally{
        this.nodeStopping=false;
        this.nodeStopPromise=null;
      }
    })();
    return this.nodeStopPromise;
  }
  assertNode(){assertManagedNodeReady(this.node,this.nodeStarting||this.nodeStopping)}
  async readStatus(){
    this.assertNode();const owned=this.node;
    const observed=await fetchRead(new URL('/status',this.endpoint));
    // The loopback response could arrive AFTER managed-child death/replacement.
    // This does not authenticate the endpoint, but revokes late observations.
    this.assertNode();
    if(this.node!==owned)throw Error('Managed node changed during status observation');
    return observed;
  }
  async observedReadAtStableTip(read){
    this.assertNode();
    const ownedChild=this.node;
    const before=await fetchRead(new URL('/status',this.endpoint));
    this.assertNode();
    if(this.node!==ownedChild)throw Error('Managed FAE node changed during observation');
    const result=await read();
    this.assertNode();
    if(this.node!==ownedChild)throw Error('Managed FAE node changed during observation');
    const after=await fetchRead(new URL('/status',this.endpoint));
    this.assertNode();
    if(this.node!==ownedChild||before.height!==after.height||before.tip_hash!==after.tip_hash)
      throw Error('FAE chain tip changed during observation');
    if(result?.observed_tip_height!==undefined&&
       (result.observed_tip_height!==before.height||result.observed_tip_hash!==before.tip_hash))
      throw Error('Explorer observation does not match stable chain tip');
    return result;
  }
  async readBalance(address){
    const requested=addressValid(address);
    return this.observedReadAtStableTip(()=>
      fetchRead(new URL('/balance?address='+encodeURIComponent(requested),this.endpoint),'balance',requested));
  }
  async readExplorer(route,params){
    const url=explorerUrl(route,params,this.endpoint);
    const observed=await this.observedReadAtStableTip(()=>
      fetchRead(url,'explorer'));
    if(route==='/explorer/address'){
      // An incompatible or mismatched selected-node response is never wallet activity.
      if(observed.address!==params?.address||!Array.isArray(observed.events)||
        observed.events.length>100||!Number.isSafeInteger(observed.total_events)||
        observed.total_events<observed.events.length||
        !/^\d+$/.test(String(observed.balance_atoms??'')))
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
    if(alive(this.miner))throw Error('Miner already running');
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
        let end;while((end=buffer.indexOf('\\n'))>=0){this.ingestMiner(buffer.slice(0,end));buffer=buffer.slice(end+1)}
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
module.exports={ProcessController,makeEnv,explorerUrl,addressValid,fetchRead,HOST,NETWORK};
