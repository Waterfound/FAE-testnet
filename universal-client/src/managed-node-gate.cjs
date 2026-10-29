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
// Ask the operating system for an actually bindable local port, including
// on Windows hosts with dynamic excluded/reserved TCP port ranges. The
// reservation is released before the original node binds; this does NOT
// establish endpoint ownership or process authentication.
function allocateOsAssignedLoopbackPort(){
  return new Promise((resolve,reject)=>{
    const server=net.createServer();
    server.once('error',error=>reject(Error('FAE OS-assigned loopback port unavailable: '+error.code)));
    server.listen(0,'127.0.0.1',()=>{
      const bound=server.address();
      const port=bound&&typeof bound==='object'?bound.port:null;
      server.close(error=>{
        if(error)return reject(error);
        if(!Number.isInteger(port)||port<1024||port>65535)
          return reject(Error('FAE OS-assigned loopback port invalid'));
        resolve(port);
      });
    });
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

function waitForManagedListenEvidence({child,host='127.0.0.1',port,timeoutMs=6000}={}){
  if(host!=='127.0.0.1'||!Number.isInteger(port)||port<1||port>65535)
    return Promise.reject(Error('Invalid managed node startup endpoint'));
  if(!isManagedChildAlive(child)||!child.stdout||typeof child.stdout.on!=='function')
    return Promise.reject(Error('Managed node lacks process-bound stdout startup evidence'));
  // Canonical immutable FAE node logs this line only after server.listen callback.
  // A selected HTTP port or a plausible /status response cannot replace it.
  const prefix='[FAE] independent node ';
  const hostMarker=' listening on http://127.0.0.1:'+port+' height=';
  return new Promise((resolve,reject)=>{
    let ended=false,buffer='';
    const timer=setTimeout(()=>finish(Error('Managed node listener evidence timed out')),timeoutMs);
    function finish(error){
      if(ended)return;
      ended=true;clearTimeout(timer);
      child.stdout.off('data',onData);
      child.off('exit',onExit);
      child.off('error',onError);
      if(error)reject(error);else resolve({owned_process_log:true,host,port});
    }
    function onExit(){finish(Error('Managed node exited before bound-port evidence'))}
    function onError(){finish(Error('Managed node failed before bound-port evidence'))}
    function onData(chunk){
      if(ended)return;
      buffer+=String(chunk);
      if(buffer.length>16384)return finish(Error('Managed node startup output exceeded bound'));
      let newline;
      while((newline=buffer.indexOf('\n'))!==-1){
        const line=buffer.slice(0,newline).replace(/\r$/,'');
        buffer=buffer.slice(newline+1);
        if(!line.startsWith(prefix))continue;
        const index=line.indexOf(hostMarker);
        if(index>prefix.length&&/^\d+$/.test(line.slice(index+hostMarker.length))){
          if(!isManagedChildAlive(child))return finish(Error('Managed node terminated before bound-port evidence'));
          return finish();
        }
        if(line.includes(' listening on http://'))
          return finish(Error('Managed node announced unexpected endpoint'));
      }
    }
    child.stdout.on('data',onData);
    child.on('exit',onExit);
    child.on('error',onError);
  });
}

module.exports={isManagedChildAlive,assertManagedNodeReady,probeLoopbackPort,allocateOsAssignedLoopbackPort,verifyManagedReadiness,waitForManagedListenEvidence};
