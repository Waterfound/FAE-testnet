'use strict';
// Renderer IPC is deliberately public/read-only or narrow native process control.
// No secret-bearing Wallet or arbitrary filesystem command is permitted here.
function assertTrustedIpcFrame(event,window,origin){
  const contents=window?.webContents;
  const frame=event?.senderFrame;
  if(!contents||typeof window.isDestroyed!=='function'||window.isDestroyed()||
     event?.sender!==contents||!frame||frame!==contents.mainFrame||
     frame.url!==origin){
    throw Error('Untrusted IPC');
  }
}
module.exports={assertTrustedIpcFrame};
