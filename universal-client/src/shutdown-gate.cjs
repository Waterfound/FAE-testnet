'use strict';
// Both window close and application quit share one fail-closed process shutdown.
// No window is destroyed before the managed node/miner exits are confirmed.
function createShutdownGate({dispose,quit,onFailure}={}){
  if(typeof dispose!=='function'||typeof quit!=='function'||typeof onFailure!=='function')
    throw Error('Shutdown requires disposal, quit and failure handlers');
  let pending=null,completed=false;
  function request(event){
    if(completed)return;
    if(!event||typeof event.preventDefault!=='function')
      throw Error('Cancelable native close event required');
    event.preventDefault();
    if(pending)return pending;
    pending=Promise.resolve().then(dispose).then(()=>{
      completed=true;
      try{quit()}catch(error){completed=false;throw error}
    }).catch(error=>{
      pending=null;
      // Do not abandon the window or process when termination fails.
      onFailure(error);
    });
    return pending;
  }
  return Object.freeze({request,get closing(){return Boolean(pending)},get completed(){return completed}});
}
module.exports={createShutdownGate};
