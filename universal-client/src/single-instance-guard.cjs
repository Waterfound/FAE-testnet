'use strict';
// Protect the one local state directory and managed FAE node from concurrent app
// processes. A lock does not authenticate the separate HTTP server.
function registerSingleInstanceGuard(app,getWindow){
  if(typeof app?.requestSingleInstanceLock!=='function'||typeof getWindow!=='function')
    throw Error('Native desktop application lock required');
  const acquired=app.requestSingleInstanceLock();
  if(!acquired)return false;
  app.on('second-instance',()=>{
    const win=getWindow();
    if(!win||win.isDestroyed?.())return;
    if(win.isMinimized?.())win.restore();
    win.focus();
  });
  return true;
}
module.exports={registerSingleInstanceGuard};
