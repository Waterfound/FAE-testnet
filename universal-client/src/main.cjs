'use strict';
const {app,BrowserWindow,ipcMain,session,utilityProcess}=require('electron');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {ProcessController}=require('./controller.cjs');
const {WatchAddressBook}=require('./watch-address-book.cjs');
const {makeUtilitySpawn}=require('./utility-process-adapter.cjs');
let win,controller,watchBook,quitting=false;
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
  if(process.argv.includes('--ts-node-smoke')){
    // Explicitly opt-in only on isolated CI; true Electron utilityProcess + FAE node.
    const timeout=setTimeout(()=>{console.error('TS_NODE_SMOKE_TIMEOUT');app.exit(2)},35000);
    win.webContents.once('did-finish-load',async()=>{
      try{
        const s=await win.webContents.executeJavaScript(
          "(async()=>{let started=false;try{const a=await window.triumph.startNode();started=a.node==='running';const status=await window.triumph.status();const explorer=await window.triumph.explorer('/explorer/status',{});return {started,network:status.network,height:status.height,explorer_network:explorer.network,tip_height:explorer.observed_tip_height};}finally{if(started)await window.triumph.stopNode();}})()");
        if(!s.started||s.network!=='fairyelf-public-testnet-v4'||s.explorer_network!==s.network||
          !Number.isSafeInteger(s.height)||s.height!==s.tip_height)throw Error('Native node/Explorer mismatch');
        console.log('TS_NODE_SMOKE_PASS '+JSON.stringify(s));clearTimeout(timeout);app.exit(0);
      }catch(error){console.error('TS_NODE_SMOKE_FAIL '+error.message);clearTimeout(timeout);app.exit(1)}
    });
  }
  if(process.argv.includes('--ts-miner-smoke')){
    // Only disposable local network on runner; no private wallet keys.
    const timer=setTimeout(()=>{console.error('TS_MINER_SMOKE_TIMEOUT');app.exit(2)},45000);
    win.webContents.once('did-finish-load',async()=>{
      try{
        const result=await win.webContents.executeJavaScript(
          "(async()=>{const address='faet1z5g4r8qgv29jcy350mvxgr3hpk35vjhdk3s6fn';let node=false,miner=false,unsubscribe=()=>{};try{const n=await window.triumph.startNode();node=n.node==='running';if(!node)throw Error('real node not started');const telemetry=new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('No measured miner progress')),20000);unsubscribe=window.triumph.onState(s=>{if(s.miner==='running'&&s.telemetry?.state==='MINING'&&Number.isSafeInteger(s.telemetry?.hashrate_hs)&&s.telemetry.hashrate_hs>0){clearTimeout(timeout);resolve(s.telemetry)}})});const a=await window.triumph.startMiner(address);miner=a.miner==='running';if(!miner)throw Error('standalone miner did not start');const t=await telemetry;return {network:(await window.triumph.status()).network,real_miner:miner,hashrate_hs:t.hashrate_hs,total_hashes:t.total_hashes};}finally{unsubscribe();if(miner)await window.triumph.stopMiner();if(node)await window.triumph.stopNode()}})()");
        if(result.network!=='fairyelf-public-testnet-v4'||!result.real_miner||result.hashrate_hs<=0)throw Error('Invalid owned miner evidence');
        console.log('TS_MINER_SMOKE_PASS '+JSON.stringify(result));clearTimeout(timer);app.exit(0);
      }catch(error){console.error('TS_MINER_SMOKE_FAIL '+error.message);clearTimeout(timer);app.exit(1)}
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
    'ts:explorer':(route,query)=>controller.readExplorer(route,query),
    'ts:watch-list':()=>watchBook.list(),
    'ts:watch-add':(address,alias)=>watchBook.add(address,alias),
    'ts:watch-update':(address,changes)=>watchBook.update(address,changes),
    'ts:watch-remove':address=>watchBook.remove(address)
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
  controller=new ProcessController({repoRoot:app.isPackaged?path.join(process.resourcesPath,'fae-runtime'):path.resolve(__dirname,'..','..'),dataDir:app.getPath('userData'),
    spawnFn:makeUtilitySpawn(utilityProcess.fork.bind(utilityProcess))});
  watchBook=new WatchAddressBook(app.getPath('userData'));
  bindIpc();windowCreate();
});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',e=>{
  if(quitting||!controller)return;
  e.preventDefault();quitting=true;
  void controller.dispose().finally(()=>app.quit());
});
