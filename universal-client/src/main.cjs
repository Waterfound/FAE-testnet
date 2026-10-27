'use strict';
const {app,BrowserWindow,ipcMain,session,utilityProcess}=require('electron');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {ProcessController}=require('./controller.cjs');
const {makeUtilitySpawn}=require('./utility-process-adapter.cjs');
let win,controller,quitting=false;
function windowCreate(){
  win=new BrowserWindow({
    title:'Triumph Sovereign — Public Testnet Candidate',width:1220,height:820,minWidth:850,minHeight:610,
    backgroundColor:'#faf9f6',autoHideMenuBar:true,
    webPreferences:{preload:path.join(__dirname,'preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true}
  });
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',e=>e.preventDefault());
  if(process.argv.includes('--ts-smoke')) {
    // Isolated candidate CI only: no node, miner, signing or external network startup.
    const timeout=setTimeout(()=>{console.error('TS_GUI_SMOKE_TIMEOUT');app.exit(2)},30000);
    win.webContents.once('did-finish-load',async()=>{
      try{
        const snapshot=await win.webContents.executeJavaScript(
          "(async()=>{const pages=document.querySelectorAll('.nav[data-page]').length;const bridge=typeof window.triumph==='object';const state=bridge?await window.triumph.snapshot():null;return {title:document.title,pages,bridge,node:state?.node,miner:state?.miner,home:document.getElementById('page-home').classList.contains('visible')}})()"
        );
        if(snapshot.pages!==6||!snapshot.bridge||snapshot.node!=='stopped'||snapshot.miner!=='stopped'||!snapshot.home)
          throw Error('Desktop UI/IPC smoke assertion failed: '+JSON.stringify(snapshot));
        console.log('TS_GUI_SMOKE_PASS '+JSON.stringify(snapshot));
        clearTimeout(timeout);app.exit(0);
      }catch(error){clearTimeout(timeout);console.error('TS_GUI_SMOKE_FAIL '+error.message);app.exit(1)}
    });
  }
  win.loadFile(path.join(__dirname,'index.html'));
}
function bindIpc(){
  const origin=pathToFileURL(path.join(__dirname,'index.html')).href;
  const calls={
    'ts:snapshot':()=>controller.snapshot(),
    'ts:start-node':()=>controller.startNode(),
    'ts:stop-node':()=>controller.stopNode(),
    'ts:start-miner':addr=>controller.startMiner(addr),
    'ts:stop-miner':()=>controller.stopMiner(),
    'ts:status':()=>controller.readStatus(),
    'ts:balance':addr=>controller.readBalance(addr),
    'ts:explorer':(route,query)=>controller.readExplorer(route,query)
  };
  for(const [verb,invoke] of Object.entries(calls)){
    ipcMain.handle(verb,(event,...args)=>{
      if(!win||win.isDestroyed()||event.sender!==win.webContents||event.senderFrame?.url!==origin)throw Error('Untrusted IPC');
      return invoke(...args);
    });
  }
  controller.on('state',state=>{if(win&&!win.isDestroyed())win.webContents.send('ts:state',state)});
}
app.whenReady().then(()=>{
  session.defaultSession.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  session.defaultSession.setPermissionCheckHandler(()=>false);
  controller=new ProcessController({repoRoot:path.resolve(__dirname,'..','..'),dataDir:app.getPath('userData'),
    spawnFn:makeUtilitySpawn(utilityProcess.fork.bind(utilityProcess))});
  bindIpc();windowCreate();
});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',e=>{
  if(quitting||!controller)return;
  e.preventDefault();quitting=true;
  void controller.dispose().finally(()=>app.quit());
});
