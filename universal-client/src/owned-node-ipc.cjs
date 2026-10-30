'use strict';
// Candidate native parent-half of a process-bound FAE node IPC protocol.
// The unmodified original node does not implement this protocol. NEVER
// fall back to HTTP for an IPC failure or interpret it as authenticated.
const {randomBytes}=require('node:crypto');
const NETWORK='fairyelf-public-testnet-v4';
const IPC_ENV_FLAG='FAE_TRIUM_IPC';
const REQUEST='TRIUM_FAE_NODE_IPC_REQUEST_V1';
const REPLY='TRIUM_FAE_NODE_IPC_REPLY_V1';
const ALLOWED_READS=new Set(['status','balance','spendable','transaction-lookup']);
const BLOCK_MUTATION='submit-mined-block';
const DIGEST=/^[0-9a-f]{64}$/;
const MAX_BLOCK_PACKET_BYTES=65536;
// Parent-side boundary only. No source-owner node currently admits this opcode.
function boundedOriginalBlockEnvelope(submission){
  if(!submission||typeof submission!=='object'||Array.isArray(submission)||
     Object.keys(submission).sort().join(',')!=='hash,header,nonce,txids')
    throw Error('Invalid original mined-block proposal envelope');
  const {header,nonce,hash,txids}=submission;
  if(!header||typeof header!=='object'||Array.isArray(header)||
     header.network!==NETWORK||!Number.isSafeInteger(header.height)||header.height<1||
     !DIGEST.test(String(header.previous_hash))||
     !Number.isSafeInteger(nonce)||nonce<0||!DIGEST.test(String(hash))||
     !Array.isArray(txids)||txids.length>20||new Set(txids).size!==txids.length||
     txids.some(txid=>typeof txid!=='string'||!DIGEST.test(txid))||
     header.tx_count!==txids.length)
    throw Error('Invalid original mined-block proposal envelope');
  let size;
  try{size=Buffer.byteLength(JSON.stringify({type:REQUEST,network:NETWORK,
    session:'0'.repeat(64),request_id:1,op:BLOCK_MUTATION,
    params:{submission}}),'utf8')}catch{
    throw Error('Invalid original mined-block proposal encoding');
  }
  if(size>MAX_BLOCK_PACKET_BYTES)
    throw Error('Original mined-block proposal exceeds IPC limit');
  return submission;
}
function alive(child){
  return child&&child.connected===true&&Number.isSafeInteger(child.pid)&&child.pid>0&&
    child.exitCode===null&&!child.killed&&!child._tsFailed;
}
class OwnedNodeIpc {
  constructor(child,{timeoutMs=2500,maxResponseBytes=1048576,allowBlockMutation=false}={}){
    if(!alive(child)||typeof child.send!=='function'||
       typeof child.on!=='function'||typeof child.off!=='function')
      throw Error('OS-owned connected child IPC channel required');
    if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000||
       !Number.isSafeInteger(maxResponseBytes)||maxResponseBytes<128||
       maxResponseBytes>2097152||typeof allowBlockMutation!=='boolean')
      throw Error('Invalid IPC security limits');
    this.child=child;this.timeoutMs=timeoutMs;
    this.maxResponseBytes=maxResponseBytes;
    // Always false in the ordinary product; setting true additionally requires
    // an original-node source owner to admit the matching opcode separately.
    this.allowBlockMutation=allowBlockMutation;
    this.session=randomBytes(32).toString('hex');
    this.counter=0;this.pending=null;this.revoked=false;
    this.onMessage=this.onMessage.bind(this);
    this.onDead=()=>this.revoke('Managed node IPC process exited or disconnected');
    for(const event of ['message','exit','error','disconnect'])
      child.on(event,event==='message'?this.onMessage:this.onDead);
  }
  revoke(reason='Managed node IPC session revoked'){
    if(this.revoked)return;
    this.revoked=true;
    const old=this.pending;this.pending=null;
    if(old){clearTimeout(old.timer);old.reject(Error(reason))}
    for(const event of ['message','exit','error','disconnect'])
      this.child.off(event,event==='message'?this.onMessage:this.onDead);
  }
  onMessage(message){
    if(this.revoked)return;
    let length;
    try{length=Buffer.byteLength(JSON.stringify(message),'utf8')}
    catch{this.revoke('Malformed node IPC response');return}
    if(!message||typeof message!=='object'||Array.isArray(message)||
       length>this.maxResponseBytes||message.type!==REPLY||
       message.session!==this.session||message.network!==NETWORK||
       !Number.isSafeInteger(message.request_id)||message.request_id<1||
       message.ok!==true){
      this.revoke('Unauthenticated or invalid node IPC response');return;
    }
    const pending=this.pending;
    if(!pending||pending.id!==message.request_id){
      this.revoke('Stale or replayed node IPC response');return;
    }
    if(!alive(this.child)){
      this.revoke('Node IPC response after process loss');return;
    }
    clearTimeout(pending.timer);this.pending=null;
    pending.resolve(message.result);
  }
  read(op,params={}){
    if(this.revoked||!alive(this.child))
      return Promise.reject(Error('Managed node IPC channel unavailable'));
    if(!ALLOWED_READS.has(op)||!params||typeof params!=='object'||
       Array.isArray(params)||!(op==='status'?
         Object.keys(params).length===0:
         op==='transaction-lookup'?
           Object.keys(params).length===1&&
           typeof params.txid==='string'&&/^[0-9a-f]{64}$/.test(params.txid):
           Object.keys(params).length===1&&
           typeof params.address==='string'&&params.address.length<=90))
      return Promise.reject(Error('Unsupported native IPC read'));
    return this.#dispatch(op,params);
  }
  // Original-miner callback transport candidate. NOT a renderer API. This is
  // disabled in all existing Product/ProcessController construction paths.
  // The ORIGINAL source-owner node must implement/authorize the opcode; no
  // fallback to legacy HTTP or implicit retry exists here.
  async submitMinedBlock(submission){
    if(!this.allowBlockMutation)
      throw Error('Original-node authenticated block mutation not owner-admitted');
    if(this.revoked||!alive(this.child))
      throw Error('Managed node IPC channel unavailable');
    const proposal=boundedOriginalBlockEnvelope(submission);
    const result=await this.#dispatch(BLOCK_MUTATION,{submission:proposal});
    if(!result||typeof result!=='object'||Array.isArray(result)||
       result.ok!==true||result.network!==NETWORK||
       result.durable!==true||result.height!==proposal.header.height||
       result.hash!==proposal.hash||result.tx_count!==proposal.txids.length){
      this.revoke('Original-node mined-block receipt not durable or mismatched');
      throw Error('Original-node mined-block receipt not durable or mismatched');
    }
    return Object.freeze({ok:true,network:NETWORK,durable:true,
      height:result.height,hash:result.hash,tx_count:result.tx_count});
  }
  #dispatch(op,params){
    if(this.revoked||!alive(this.child))
      return Promise.reject(Error('Managed node IPC channel unavailable'));
    if(this.pending)return Promise.reject(Error('Native node IPC request already pending'));
    const id=++this.counter;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{
        this.revoke('Managed node IPC timeout; request outcome unknown');
      },this.timeoutMs);
      this.pending={id,resolve,reject,timer};
      // Node's inherited OS IPC channel, never a TCP/HTTP listener or renderer.
      try{
        this.child.send({type:REQUEST,session:this.session,network:NETWORK,
          request_id:id,op,params},error=>{
          if(error)this.revoke('Managed node IPC send failed');
        });
      }catch{this.revoke('Managed node IPC send failed')}
    });
  }
}
module.exports={OwnedNodeIpc,NETWORK,REQUEST,REPLY,IPC_ENV_FLAG};
