'use strict';
// Candidate-only ownership and readiness gate for the existing FAE independent node.
// This never launches an alternate node, signs, mines, or trusts arbitrary local listeners.
const net=require('node:net');
const {NETWORK,validateRead}=require('./bridge-contract.cjs');

function isManagedChildAlive(child){
  return Boolean(child&&child.exitCode===null&&!child.killed&&!child._tsFailed);
}
function assertManagedNodeReady(child,startPending=false){
  if(startPending||!isManagedChildAlive(child)){
    throw Error('Local FAE node is not ready or not owned by this client');
  }
}
function probeLoopbackPort(port=8787){
  if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid managed node port');
  return new Promise((resolve,reject)=>{
    const server=net.createServer();
    server.once('error',error=>reject(Error('FAE local port '+port+' unavailable: '+error.code)));
    server.listen(port,'127.0.0.1',()=>server.close(resolve));
  });
}
async function verifyManagedReadiness({child,readStatus,timeoutMs=5000,pollMs=90}={}){
  if(typeof readStatus!=='function')throw Error('Readiness probe required');
  const deadline=Date.now()+timeoutMs;
  do{
    if(!isManagedChildAlive(child))throw Error('Managed FAE node exited before readiness');
    try{
      const reply=await readStatus();
      if(reply?.ok===true&&reply.network!==NETWORK){
        throw Error('Managed FAE node network mismatch');
      }
      const verified=validateRead(reply,{kind:'status'});
      if(verified.node_version!==undefined&&typeof verified.node_version!=='string'){
        throw Error('Invalid FAE node version');
      }
      return verified;
    }catch(error){
      if(error.message==='Managed FAE node network mismatch'||Date.now()>=deadline){
        throw Error('Managed FAE node failed readiness: '+error.message);
      }
    }
    await new Promise(resolve=>setTimeout(resolve,pollMs));
  }while(Date.now()<deadline);
  throw Error('Managed FAE node readiness timed out');
}
module.exports={isManagedChildAlive,assertManagedNodeReady,probeLoopbackPort,verifyManagedReadiness};
