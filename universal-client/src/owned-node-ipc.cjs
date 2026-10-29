'use strict';
// Candidate native parent-half of a process-bound FAE node IPC protocol.
// The unmodified original node does not implement this protocol. NEVER
// fall back to HTTP for an IPC failure or interpret it as authenticated.
const {randomBytes}=require('node:crypto');
const NETWORK='fairyelf-public-testnet-v4';
const IPC_ENV_FLAG='FAE_TRIUM_IPC';
const REQUEST='TRIUM_FAE_NODE_IPC_REQUEST_V1';
const REPLY='TRIUM_FAE_NODE_IPC_REPLY_V1';
const ALLOWED_READS=new Set(['status','balance','spendable']);
function alive(child){
  return child&&child.connected===true&&Number.isSafeInteger(child.pid)&&child.pid>0&&
    child.exitCode===null&&!child.killed&&!child._tsFailed;
}
class OwnedNodeIpc {
  constructor(child,{timeoutMs=2500,maxResponseBytes=1048576}={}){
    if(!alive(child)||typeof child.send!=='function'||
       typeof child.on!=='function'||typeof child.off!=='function')
      throw Error('OS-owned connected child IPC channel required');
    if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000||
       !Number.isSafeInteger(maxResponseBytes)||maxResponseBytes<128||
       maxResponseBytes>2097152)throw Error('Invalid IPC security limits');
    this.child=child;this.timeoutMs=timeoutMs;
    this.maxResponseBytes=maxResponseBytes;
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
       Array.isArray(params)||Object.keys(params).some(k=>k!=='address')||
       (op==='status'&&Object.keys(params).length!==0)||
       (op!=='status'&&(typeof params.address!=='string'||params.address.length>90)))
      return Promise.reject(Error('Unsupported native IPC read'));
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
