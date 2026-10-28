'use strict';
const {app,BrowserWindow,ipcMain,session,utilityProcess,dialog}=require('electron');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {ProcessController}=require('./controller.cjs');
const {WatchAddressBook}=require('./watch-address-book.cjs');
const {readVaultPublicMetadata}=require('./wallet-vault-public-metadata.cjs');
const {assertTrustedIpcFrame}=require('./ipc-frame-gate.cjs');
const {reviewPublicPayment}=require('./wallet-payment-review.cjs');
const {registerSingleInstanceGuard}=require('./single-instance-guard.cjs');
const {makeUtilitySpawn}=require('./utility-process-adapter.cjs');
let win,controller,watchBook,quitting=false,ciVaultSelection=null;
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
          "(async()=>{const pages=document.querySelectorAll('.nav[data-page]').length;const bridge=typeof window.triumph==='object';const state=bridge?await window.triumph.snapshot():null;return {title:document.title,pages,bridge,node:state?.node,miner:state?.miner,home:document.getElementById('page-home').classList.contains('visible'),ticker:document.querySelector('#page-home .eyebrow')?.textContent,displayedBalance:document.getElementById('balance-amount')?.textContent,unitLabel:document.querySelector('#page-wallet .balance-grid small')?.textContent,header:document.querySelector('header.top')?.textContent}})()"
        );
        if(snapshot.pages!==6||!snapshot.bridge||snapshot.node!=='stopped'||snapshot.miner!=='stopped'||!snapshot.home||
          !snapshot.ticker?.includes('TRIUM · OFFICIAL INTENDED TICKER')||
          snapshot.displayedBalance!=='— FAE'||
          snapshot.unitLabel!=='OBSERVED FAE TESTNET BALANCE · NOT TRIUM'||
          !snapshot.header?.includes('TRIUM · OFFICIAL INTENDED TICKER')||
          snapshot.header.includes('FATIMA'))
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
          "(async()=>{let started=false;try{const a=await window.triumph.startNode();started=a.node==='running';const addr='faet1z5g4r8qgv29jcy350mvxgr3hpk35vjhdk3s6fn';const status=await window.triumph.status();const explorer=await window.triumph.explorer('/explorer/status',{});const balance=await window.triumph.balance(addr);const activity=await window.triumph.explorer('/explorer/address',{address:addr,limit:5});return {started,network:status.network,height:status.height,tip_hash:status.tip_hash,explorer_network:explorer.network,tip_height:explorer.observed_tip_height,balance_address:balance.address,balance_atoms:balance.balance_atoms,activity_address:activity.address,activity_tip:activity.observed_tip_hash,activity_count:activity.events.length};}finally{if(started)await window.triumph.stopNode();}})()");
        if(!s.started||s.network!=='fairyelf-public-testnet-v4'||s.explorer_network!==s.network||
          !Number.isSafeInteger(s.height)||s.height!==s.tip_height||
          s.balance_address!=='faet1z5g4r8qgv29jcy350mvxgr3hpk35vjhdk3s6fn'||
          !/^[0-9]+$/.test(String(s.balance_atoms))||s.activity_address!==s.balance_address||
          s.activity_tip!==s.tip_hash||!Number.isSafeInteger(s.activity_count))
          throw Error('Native node/Explorer/Wallet watch-only tip mismatch');
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

  if(process.argv.includes('--ts-watch-smoke')&&process.env.CI==='true'){
    const timer=setTimeout(()=>{console.error('TS_WATCH_SMOKE_TIMEOUT');app.exit(2)},25000);
    win.webContents.once('did-finish-load',async()=>{
      try{
        const observed=await win.webContents.executeJavaScript(
          "(async()=>{const a='faet1z5g4r8qgv29jcy350mvxgr3hpk35vjhdk3s6fn';const current=await window.triumph.watchList();if(!current.entries.some(e=>e.address===a))await window.triumph.watchAdd(a,'Native test public address');await window.triumph.watchUpdate(a,{hidden:true,alias:'Native test public address'});const rows=await window.triumph.watchList();return {present:rows.entries.some(e=>e.address===a&&e.hidden&&e.alias==='Native test public address')}})()");
        if(!observed.present)throw Error('Native watch-only IPC acceptance failed');
        const cold=await (new WatchAddressBook(app.getPath('userData'))).list();
        if(!cold.entries.some(e=>e.alias==='Native test public address'&&e.hidden))
          throw Error('Cold persisted public catalog did not roundtrip');
        await watchBook.remove('faet1z5g4r8qgv29jcy350mvxgr3hpk35vjhdk3s6fn');
        const interfaceRoundtrip=await win.webContents.executeJavaScript("(async()=>{\n  const addr='faet1z5g4r8qgv29jcy350mvxgr3hpk35vjhdk3s6fn';\n  const el=id=>document.getElementById(id);\n  const until=async test=>{\n    for(let i=0;i<80;i++){if(test())return;await new Promise(resolve=>setTimeout(resolve,40))}\n    throw Error('Watch-only real GUI interaction timed out');\n  };\n  document.querySelector('.nav[data-page=\"wallet\"]').click();\n  el('wallet-address').value=addr;\n  el('watch-alias').value='Real GUI public address';\n  el('watch-save').click();\n  await until(()=>el('watch-entries').querySelector('.watch-entry'));\n  let row=el('watch-entries').querySelector('.watch-entry');\n  if(!row.textContent.includes('Real GUI public address'))throw Error('Saved GUI alias missing');\n  row.querySelectorAll('button')[0].click();\n  if(el('wallet-address').value!==addr||el('mining-address').value!==addr)\n    throw Error('Saved public address selection was not reflected in UI');\n  row.querySelectorAll('button')[1].click();\n  await until(()=>el('watch-entries').querySelector('.watch-entry span')?.textContent.includes('hidden'));\n  row=el('watch-entries').querySelector('.watch-entry');\n  if(row.textContent.includes(addr))throw Error('Hidden public address remains displayed');\n  row.querySelectorAll('button')[2].click();\n  await until(()=>el('watch-entries').textContent.includes('No saved public addresses'));\n  return {saved:true,selected:true,hidden:true,removed:true};\n})()");
        if(!interfaceRoundtrip.saved||!interfaceRoundtrip.removed)
          throw Error('Native GUI watch-list interaction did not complete');
        const afterUi=await (new WatchAddressBook(app.getPath('userData'))).list();
        if(afterUi.entries.some(e=>e.alias==='Real GUI public address'))
          throw Error('GUI removal did not persist across fresh native state reader');
        console.log('TS_WATCH_GUI_E2E_PASS '+JSON.stringify(interfaceRoundtrip));
        // Leave a public-only fixture after the GUI delete test. A second
        // independent Electron process must recover it without writing.
        const testAddress='faet1z5g4r8qgv29jcy350mvxgr3hpk35vjhdk3s6fn';
        await watchBook.add(testAddress,'Cold process public address');
        await watchBook.update(testAddress,{hidden:true});
        await watchBook.select(testAddress);
        console.log('TS_WATCH_SMOKE_PASS '+JSON.stringify({ipc:true,cold_restart:true,stored:cold.entries.length}));
        clearTimeout(timer);app.exit(0);
      }catch(error){clearTimeout(timer);console.error('TS_WATCH_SMOKE_FAIL '+error.message);app.exit(1)}
    });
  }

  if(process.argv.includes('--ts-watch-verify')&&process.env.CI==='true'){
    // A separate OS process reads the exact userData persisted by --ts-watch-smoke.
    // No entry is added or modified during this verification phase.
    const timer=setTimeout(()=>{console.error('TS_WATCH_COLD_PROCESS_TIMEOUT');app.exit(2)},25000);
    win.webContents.once('did-finish-load',async()=>{
      try{
        const observed=await win.webContents.executeJavaScript(
          "(async()=>{const a='faet1z5g4r8qgv29jcy350mvxgr3hpk35vjhdk3s6fn';const s=await window.triumph.watchList();return {network:s.network,kind:s.kind,selected:s.selected,matches:s.entries.filter(e=>e.address===a&&e.hidden&&e.alias==='Cold process public address').length}})()"
        );
        if(observed.network!=='fairyelf-public-testnet-v4'||observed.kind!=='watch_only'||observed.matches!==1||observed.selected!=='faet1z5g4r8qgv29jcy350mvxgr3hpk35vjhdk3s6fn')
          throw Error('Persisted public address missing after complete Electron process exit');
        const native=await (new WatchAddressBook(app.getPath('userData'))).list();
        if(native.selected!=='faet1z5g4r8qgv29jcy350mvxgr3hpk35vjhdk3s6fn'||!native.entries.some(e=>e.alias==='Cold process public address'&&e.hidden))
          throw Error('Cold process native data reader disagrees with renderer IPC');
        console.log('TS_WATCH_COLD_PROCESS_PASS '+JSON.stringify({native_process_relaunch:true,read_only:true}));
        clearTimeout(timer);app.exit(0);
      }catch(e){clearTimeout(timer);console.error('TS_WATCH_COLD_PROCESS_FAIL '+e.message);app.exit(1)}
    });
  }

  if(process.argv.includes('--ts-lock-owner-smoke')&&process.env.CI==='true'){
    const timer=setTimeout(()=>{console.error('TS_PRIMARY_LOCK_TIMEOUT');app.exit(2)},25000);
    win.webContents.once('did-finish-load',()=>{
      console.log('TS_PRIMARY_LOCK_READY');
      clearTimeout(timer);
      setTimeout(()=>{console.log('TS_PRIMARY_LOCK_EXIT');app.exit(0)},16000);
    });
  }

  if(process.argv.includes('--ts-vault-import-smoke')&&process.env.CI==='true'){
    // Disposable CI-only native read-only import: no seed, key, signing or vault unlock.
    const timer=setTimeout(()=>{console.error('TS_VAULT_PUBLIC_IMPORT_TIMEOUT');app.exit(2)},30000);
    win.webContents.once('did-finish-load',async()=>{
      const fs=require('node:fs/promises'),crypto=require('node:crypto');
      let file=null;
      try{
        const root=path.join(app.getPath('userData'),'ci-public-metadata');
        await fs.mkdir(root,{recursive:true,mode:0o700});
        const addressSource=path.join(
          app.isPackaged?path.join(process.resourcesPath,'fae-runtime'):path.resolve(__dirname,'..','..'),
          'sovereign-forge','node','authoritative','address.mjs');
        const {encodeAddress}=await import(pathToFileURL(addressSource).href);
        const records=Array.from({length:5},(_,index)=>{
          const {publicKey}=crypto.generateKeyPairSync('ed25519');
          const spki=publicKey.export({type:'spki',format:'der'});
          return {index,address:encodeAddress(crypto.createHash('sha256').update(spki).digest().subarray(0,20),'faet'),
            public_key_spki:spki.toString('base64')};
        });
        // This is an intentionally fake encrypted envelope for testing PUBLIC
        // metadata handling only; it must never be used as a real wallet.
        const fixture={format:'FAE_STANDALONE_VAULT_V1',network:'fairyelf-public-testnet-v4',
          public_addresses:records,encryption:{cipher:'aes-256-gcm',kdf:'scrypt',payload:'CI_TEST_NON_SECRET_DATA'}};
        file=path.join(root,'ci-import-'+crypto.randomBytes(8).toString('hex')+'.json');
        await fs.writeFile(file,JSON.stringify(fixture),{flag:'wx',mode:0o600});
        ciVaultSelection=file;
        const ui=await win.webContents.executeJavaScript(
          "(async()=>{document.querySelector('.nav[data-page=\"wallet\"]').click();const before=(await window.triumph.watchList()).entries.length;document.getElementById('watch-import-vault').click();for(let i=0;i<150;i++){const s=await window.triumph.watchList();if(s.entries.some(e=>e.alias==='Vault public address 5')){const rows=document.querySelectorAll('#watch-entries .watch-entry').length;return {before,after:s.entries.length,rows,kind:s.kind,network:s.network,exposedSecrets:JSON.stringify(s).includes('public_key_spki')||JSON.stringify(s).includes('CI_TEST_NON_SECRET_DATA')}}await new Promise(resolve=>setTimeout(resolve,45))}throw Error('Real native public vault import UI timeout')})()");
        if(ui.after<5||ui.rows<5||ui.kind!=='watch_only'||ui.network!=='fairyelf-public-testnet-v4'||ui.exposedSecrets)
          throw Error('Native public vault import UI acceptance failed');
        const saved=await fs.readFile(path.join(app.getPath('userData'),'watch-addresses.json'),'utf8');
        if(saved.includes('public_key_spki')||saved.includes('CI_TEST_NON_SECRET_DATA'))
          throw Error('Native public address storage leaked vault content');
        console.log('TS_VAULT_PUBLIC_IMPORT_PASS '+JSON.stringify({real_renderer_click:true,native_ipc:true,canonical_spki_binding:true,privates_exposed:false}));
        clearTimeout(timer);app.exit(0);
      }catch(error){clearTimeout(timer);console.error('TS_VAULT_PUBLIC_IMPORT_FAIL '+error.message);app.exit(1)}
      finally{ciVaultSelection=null;if(file)await fs.unlink(file).catch(()=>{})}
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
    'ts:review-payment':draft=>reviewPublicPayment(draft,{
      addressSource:path.join(app.isPackaged?path.join(process.resourcesPath,'fae-runtime'):path.resolve(__dirname,'..','..'),
        'sovereign-forge','node','authoritative','address.mjs')
    }),
    'ts:watch-list':()=>watchBook.list(),
    'ts:watch-add':(address,alias)=>watchBook.add(address,alias),
    'ts:watch-update':(address,changes)=>watchBook.update(address,changes),
    'ts:watch-remove':address=>watchBook.remove(address),
    'ts:watch-select':address=>watchBook.select(address),
    'ts:watch-import-vault':async()=>{
      const selected=ciVaultSelection&&process.env.CI==='true'&&process.argv.includes('--ts-vault-import-smoke')
        ?{canceled:false,filePaths:[ciVaultSelection]}
        :await dialog.showOpenDialog(win,{
        title:'Import public addresses from encrypted FAE vault',properties:['openFile'],
        filters:[{name:'FAE encrypted vault',extensions:['json']}]
      });
      if(selected.canceled||selected.filePaths.length!==1)return null;
      let metadata;
      try{
        const source=path.join(app.isPackaged?path.join(process.resourcesPath,'fae-runtime'):path.resolve(__dirname,'..','..'),
          'sovereign-forge','node','authoritative','address.mjs');
        metadata=await readVaultPublicMetadata(selected.filePaths[0],{addressSource:source})
      }
      catch{throw Error('Selected encrypted FAE vault public metadata could not be validated')}
      return watchBook.importPublicVaultAddresses(metadata.addresses);
    }
  };
  for(const [verb,invoke] of Object.entries(calls)){
    ipcMain.handle(verb,(event,...args)=>{
      assertTrustedIpcFrame(event,win,origin);
      return invoke(...args);
    });
  }
  controller.on('state',state=>{if(win&&!win.isDestroyed())win.webContents.send('ts:state',state)});
}
const primaryInstance=registerSingleInstanceGuard(app,()=>win);
if(!primaryInstance){
  // Native operating-system lock failure means no node, file state or wallet
  // is initialized in this process. Never run a second writer.
  if(process.env.CI==='true'&&process.argv.includes('--ts-lock-probe')){
    console.log('TS_SECONDARY_LOCK_REJECTED');
  }
  app.quit();
}else{
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
  // A termination timeout is NOT evidence that a child has exited. Refuse to
  // abandon a still-owned node/miner on ordinary application close.
  void controller.dispose().then(
    ()=>app.quit(),
    ()=>{quitting=false;dialog.showErrorBox('Triumph Sovereign — shutdown incomplete',
      'A managed process did not confirm termination. The client remains active so it can be stopped safely.');}
  );
});

}
