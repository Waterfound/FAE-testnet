'use strict';
const {spawn}=require('node:child_process');
const {mkdir}=require('node:fs/promises');
const path=require('node:path');
const {EventEmitter,once}=require('node:events');
const {randomInt}=require('node:crypto');
const {NETWORK,validateRead}=require('./bridge-contract.cjs');
const {isManagedChildAlive:alive,assertManagedNodeReady,probeLoopbackPort,verifyManagedReadiness}=require('./managed-node-gate.cjs');

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
async function fetchRead(url,kind='status',address){
  const response=await fetch(url,{method:'GET',redirect:'error',headers:{accept:'application/json'},
    signal:AbortSignal.timeout(4000)});
  if(!response.ok)throw Error('FAE local read HTTP '+response.status);
  return validateRead(await response.json(),{kind,address});
}
class ProcessController extends EventEmitter{
  constructor({repoRoot,dataDir,port=randomInt(32768,61000),nodeExecutable=process.execPath,
    spawnFn=spawn,portProbe=probeLoopbackPort,readinessProbe}={}){
    super();
    this.repoRoot=path.resolve(repoRoot);
    this.dataDir=path.resolve(dataDir);
    if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid managed node port');
    this.port=port;
    this.endpoint='http://127.0.0.1:'+port;
    this.nodeExecutable=nodeExecutable;
    this.spawnFn=spawnFn;this.portProbe=portProbe;
    this.readinessProbe=readinessProbe||(()=>fetchRead(new URL('/status',this.endpoint)));
    this.node=null;this.miner=null;this.nodeStarting=false;
    this.telemetry={state:'STOPPED',hashrate_hs:null,total_hashes:null,accepted:null,rejected:null};
  }
  snapshot(){return {network:NETWORK,node:this.nodeStarting?'starting':alive(this.node)?'running':'stopped',
    miner:alive(this.miner)?'running':'stopped',telemetry:{...this.telemetry}}}
  spawnScript(script,args,extra={}){
    const env=makeEnv(extra);
    const child=this.spawnFn(this.nodeExecutable,[script,...args],{
      cwd:this.repoRoot,env,stdio:['ignore',script.endsWith('fae-miner.mjs')?'pipe':'ignore','ignore'],
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
    if(this.nodeStarting)throw Error('Node startup pending');
    if(alive(this.node))return this.snapshot();
    this.nodeStarting=true;
    try{
      await this.portProbe(this.port);
      const dir=path.join(this.dataDir,'node');
      await mkdir(dir,{recursive:true,mode:0o700});
      this.node=this.spawnScript(path.join(this.repoRoot,'sovereign-forge','node','fae-node.mjs'),[],{
        FAE_HOST:'127.0.0.1',FAE_PORT:String(this.port),FAE_DATA_FILE:path.join(dir,'state.json'),
        FAE_SYNC:'0',FAE_UPSTREAM_API:'',FAE_PEERS:'',FAE_BOOTSTRAP_FEEDS:''
      });
      await verifyManagedReadiness({child:this.node,readStatus:this.readinessProbe});
      this.nodeStarting=false;this.emit('state',this.snapshot());
      return this.snapshot();
    }catch(e){
      const old=this.node;this.node=null;this.nodeStarting=false;
      await this.stop(old).catch(()=>{});
      this.emit('state',this.snapshot());throw e;
    }
  }
  async stopMiner(){
    await this.stop(this.miner);this.miner=null;
    this.telemetry={...this.telemetry,state:'STOPPED',hashrate_hs:null};
    this.emit('state',this.snapshot());return this.snapshot();
  }
  async stopNode(){
    await this.stopMiner();await this.stop(this.node);this.node=null;
    this.emit('state',this.snapshot());return this.snapshot();
  }
  assertNode(){assertManagedNodeReady(this.node,this.nodeStarting)}
  async readStatus(){this.assertNode();return fetchRead(new URL('/status',this.endpoint))}
  async readBalance(address){
    this.assertNode();const requested=addressValid(address);
    await fetchRead(new URL('/status',this.endpoint));
    return fetchRead(new URL('/balance?address='+encodeURIComponent(requested),this.endpoint),'balance',requested);
  }
  async readExplorer(route,params){
    this.assertNode();
    await fetchRead(new URL('/status',this.endpoint));
    const observed=await fetchRead(explorerUrl(route,params,this.endpoint),'explorer');
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
    if(alive(this.miner))throw Error('Miner already running');
    await fetchRead(new URL('/status',this.endpoint));
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
    this.emit('state',this.snapshot());return this.snapshot();
  }
  async dispose(){await this.stopNode()}
}
module.exports={ProcessController,makeEnv,explorerUrl,addressValid,fetchRead,HOST,NETWORK};
