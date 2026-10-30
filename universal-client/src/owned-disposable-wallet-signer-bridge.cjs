'use strict';
// V52 original Wallet OS-process bridge, strictly for a disposable original-
// source A->B proof. Production vault unlock, user approval and signer source
// owner admission are NOT implemented; the ordinary GUI never invokes this.
const {randomBytes}=require('node:crypto');
const path=require('node:path');
const {NETWORK}=require('./owned-node-ipc.cjs');
const MODE='TS_V52_DISPOSABLE_SIGNER_ONLY';
const DIGEST=/^[0-9a-f]{64}$/;
const ADDRESS=/^faet1[023456789acdefghjklmnpqrstuvwxyz]{25,85}$/;
function alive(child){
  return !!child&&child.connected===true&&Number.isSafeInteger(child.pid)&&
    child.pid>0&&child.exitCode===null&&!child.killed&&
    typeof child.send==='function'&&typeof child.on==='function'&&
    typeof child.off==='function';
}
class OwnedDisposableWalletSignerBridge{
  constructor({signerChild,signerScript,nodeIpc,from,to,timeoutMs=10000}={}){
    if(!alive(signerChild)||typeof signerScript!=='string'||
       !path.isAbsolute(signerScript)||!Array.isArray(signerChild.spawnargs)||
       !signerChild.spawnargs.includes(signerScript)||
       !signerScript.endsWith(path.join('universal-client','src',
         'v52-disposable-original-wallet-signer.mjs'))||
       !nodeIpc||nodeIpc.revoked||!nodeIpc.allowSignedTxMutation||
       !alive(nodeIpc.child)||typeof nodeIpc.submitSignedTx!=='function')
      throw Error('Unadmitted or unowned disposable signer/node channel');
    if(typeof from!=='string'||!ADDRESS.test(from)||
       typeof to!=='string'||!ADDRESS.test(to)||from===to||
       !Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>30000)
      throw Error('Invalid disposable signed-transaction proof');
    this.child=signerChild;this.nodeIpc=nodeIpc;
    this.from=from;this.to=to;this.timeoutMs=timeoutMs;this.used=false;
  }
  async signAndSubmitOnce(outpoint){
    if(this.used)throw Error('Disposable original Wallet signer already consumed');
    this.used=true;
    if(!/^[0-9a-f]{64}:0$/.test(String(outpoint))||
       !alive(this.child)||this.nodeIpc.revoked||
       !alive(this.nodeIpc.child))
      throw Error('Disposable signer owner lost or malformed funding outpoint');
    const session=randomBytes(32).toString('hex');
    const child=this.child,channel=this.nodeIpc;
    const signed=await new Promise((resolve,reject)=>{
      let settled=false;
      const cleanup=()=>{
        clearTimeout(timer);
        for(const [event,fn] of handlers)child.off(event,fn);
      };
      const fail=()=>finish(Error('Disposable original Wallet signing outcome unknown'));
      const finish=(error,value)=>{
        if(settled)return;settled=true;cleanup();
        error?reject(error):resolve(value);
      };
      const onMessage=packet=>{
        let size;
        try{size=Buffer.byteLength(JSON.stringify(packet),'utf8')}
        catch{return fail()}
        if(!packet||typeof packet!=='object'||Array.isArray(packet)||
           size>65536||packet.mode!==MODE||packet.network!==NETWORK||
           packet.session!==session||packet.request_id!==1||
           packet.status!=='SIGNED_DISPOSABLE_ONLY'||
           packet.from!==this.from||packet.to!==this.to||
           typeof packet.txid!=='string'||!DIGEST.test(packet.txid)||
           !packet.tx||typeof packet.tx!=='object'||
           packet.tx.network!==NETWORK||packet.tx.version!==2||
           !Array.isArray(packet.tx.inputs)||packet.tx.inputs.length!==1||
           packet.tx.inputs[0]!==outpoint||
           !Array.isArray(packet.tx.outputs)||packet.tx.outputs.length!==2||
           packet.tx.outputs[0]?.address!==this.to||
           packet.tx.outputs[0]?.amount_atoms!=='100000000'||
           packet.tx.outputs[1]?.address!==this.from||
           packet.tx.outputs[1]?.amount_atoms!=='899999999')
          return fail();
        finish(null,Object.freeze({tx:packet.tx,txid:packet.txid}));
      };
      const handlers=[['message',onMessage],['exit',fail],
        ['disconnect',fail],['error',fail]];
      const timer=setTimeout(fail,this.timeoutMs);
      for(const [event,fn] of handlers)child.on(event,fn);
      try{child.send({mode:MODE,network:NETWORK,session,
        request_id:1,outpoint},error=>{if(error)fail()})}
      catch{fail()}
    });
    // The original node is still the sole crypto/consensus/persistence owner.
    // One submission only. Any timeout/revocation means UNKNOWN, not retry.
    if(channel!==this.nodeIpc||channel.revoked||!alive(channel.child))
      throw Error('Original node owner lost after disposable signature');
    return channel.submitSignedTx(signed.tx,signed.txid);
  }
}
module.exports={OwnedDisposableWalletSignerBridge};
