'use strict';
// V51 original Miner OS-worker bridge for the trusted Universal Client parent.
// The authentic Miner is the separately pinned worker from original PR #362.
// This module does not implement mining, proof verification, consensus or
// spending, and cannot grant original-node submit-mined-block admission.
const {randomBytes}=require('node:crypto');
const {NETWORK}=require('./owned-node-ipc.cjs');
const HEX=/^[0-9a-f]{64}$/;
const ADDRESS=/^faet1[023456789acdefghjklmnpqrstuvwxyz]{25,85}$/;
const MAX_MESSAGE_BYTES=65536;
function ownedWorker(child){
  return !!child&&child.connected===true&&Number.isSafeInteger(child.pid)&&
    child.pid>0&&child.exitCode===null&&!child.killed&&!child._tsFailed&&
    typeof child.send==='function'&&typeof child.on==='function'&&
    typeof child.off==='function';
}
class OwnedOriginalMinerBridge{
  constructor({minerChild,nodeIpc,nodeEndpoint,address,onTelemetry,timeoutMs=90000}={}){
    if(!ownedWorker(minerChild)||!nodeIpc||nodeIpc.revoked||
       !nodeIpc.allowBlockMutation||!ownedWorker(nodeIpc.child)||
       typeof nodeIpc.submitMinedBlock!=='function')
      throw Error('Original node block owner admission and OS-owned miner required');
    if(typeof nodeEndpoint!=='string'||
       !/^http:\/\/127\.0\.0\.1:[0-9]{4,5}$/.test(nodeEndpoint)||
       typeof address!=='string'||!ADDRESS.test(address)||
       (onTelemetry!==undefined&&typeof onTelemetry!=='function')||
       !Number.isSafeInteger(timeoutMs)||timeoutMs<5000||timeoutMs>120000)
      throw Error('Invalid original Miner owner bridge inputs');
    this.child=minerChild;this.ipc=nodeIpc;this.endpoint=nodeEndpoint;
    this.address=address;this.onTelemetry=onTelemetry||(()=>{});
    this.timeoutMs=timeoutMs;this.session=randomBytes(32).toString('hex');
    this.state='CREATED';this.receipt=null;this.requestId=0;
    this.promise=null;
  }
  async run(){
    if(this.promise)throw Error('Original Miner owner bridge already started');
    const child=this.child,channel=this.ipc;
    if(!ownedWorker(child)||channel.revoked||!ownedWorker(channel.child))
      throw Error('Original Miner or node owner lost before start');
    this.state='STARTING';
    const session=this.session;
    this.promise=new Promise((resolve,reject)=>{
      let done=false,finished=false,submitting=false;
      const cleanup=()=>{
        clearTimeout(timer);
        for(const [event,handler] of [
          ['message',onMessage],['exit',onExit],['disconnect',onDisconnect],
          ['error',onError]])child.off(event,handler);
      };
      const end=(error)=>{
        if(done)return;
        done=true;cleanup();
        if(error){
          this.state='FAILED';
          if(ownedWorker(child))try{child.send({
            type:'fae-v34-stop',session,network:NETWORK})}catch{}
          return reject(error);
        }
        this.state='FINISHED';resolve(Object.freeze({
          status:'STOPPED',session,block_count:this.requestId,
          receipt:this.receipt
        }));
      };
      const fail=reason=>end(Error(reason));
      const onError=()=>fail('Original Miner OS worker process error');
      const onDisconnect=()=>{if(!finished)fail('Original Miner OS worker disconnected before finish')};
      const onExit=(code)=>{
        if(!finished||code!==0||submitting||!this.receipt)
          return fail('Original Miner worker exited without authenticated block receipt');
        end();
      };
      const onMessage=message=>{
        if(done)return;
        let size;
        try{size=Buffer.byteLength(JSON.stringify(message),'utf8')}
        catch{return fail('Invalid original Miner child message')}
        if(!message||typeof message!=='object'||Array.isArray(message)||
           size>MAX_MESSAGE_BYTES||message.session!==session||
           message.network!==NETWORK)
          return fail('Forged or oversized original Miner child message');
        if(message.type==='fae-v34-ready'){
          if(this.state!=='STARTING')return fail('Replayed original Miner ready');
          this.state='READY';return;
        }
        if(message.type==='fae-v34-telemetry'){
          if(!['READY','SUBMITTING','ACKED'].includes(this.state)||
             !['CONNECTING','TEMPLATE_READY','MINING','WORK_ACCEPTED',
               'WORK_REJECTED','NODE_UNAVAILABLE','RECONNECTING','STOPPED']
               .includes(message.state))
            return fail('Invalid original Miner telemetry');
          try{this.onTelemetry(Object.freeze({
            state:message.state,height:message.height??null,
            total_hashes:message.total_hashes??null
          }))}catch{return fail('Original Miner telemetry handler failed')}
          return;
        }
        if(message.type==='fae-v34-proposal'){
          if(this.state!=='READY'||submitting||this.requestId!==0||
             message.request_id!==1||channel.revoked||
             !ownedWorker(child)||!ownedWorker(channel.child))
            return fail('Unauthorized or replayed original Miner proposal');
          this.state='SUBMITTING';submitting=true;this.requestId=1;
          void channel.submitMinedBlock(message.submission).then(receipt=>{
            submitting=false;
            if(done)return;
            if(!ownedWorker(child)||channel.revoked||
               !ownedWorker(channel.child)||!receipt||receipt.durable!==true)
              return fail('Original Miner block owner session lost after submission');
            this.receipt=receipt;this.state='ACKED';
            try{child.send({
              type:'fae-v34-submit-result',session,network:NETWORK,
              request_id:message.request_id,ok:true,receipt
            },error=>{if(error)fail('Original Miner receipt send failed')})}
            catch{return fail('Original Miner receipt send failed')}
          }).catch(()=>{submitting=false;fail('Original Miner native block outcome unknown; no replay')});
          return;
        }
        if(message.type==='fae-v34-finish'){
          if(this.state!=='ACKED'||message.status!=='STOPPED'||
             this.requestId!==1||!this.receipt)
            return fail('Original Miner child finished without confirmed owner receipt');
          finished=true;this.state='EXITING';
          if(ownedWorker(child))try{child.disconnect()}catch{
            return fail('Original Miner child disconnect failed');
          }
          return;
        }
        return fail('Unexpected original Miner child message');
      };
      const timer=setTimeout(()=>fail('Original Miner owner bridge timeout; outcome unknown'),
        this.timeoutMs);
      for(const [event,handler] of [
        ['message',onMessage],['exit',onExit],['disconnect',onDisconnect],
        ['error',onError]])child.on(event,handler);
      try{child.send({type:'fae-v34-start',session,network:NETWORK,
        node:this.endpoint,address:this.address},error=>{
        if(error)fail('Original Miner startup IPC send failed')})}
      catch{fail('Original Miner startup IPC send failed')}
    });
    return this.promise;
  }
  stop(){
    if(['FINISHED','FAILED'].includes(this.state))return;
    this.state='STOPPING';
    if(ownedWorker(this.child))try{this.child.send({
      type:'fae-v34-stop',session:this.session,network:NETWORK})}catch{}
  }
}
module.exports={OwnedOriginalMinerBridge};
