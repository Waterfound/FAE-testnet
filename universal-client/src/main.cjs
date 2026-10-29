'use strict';
const {app,BrowserWindow,ipcMain,session,utilityProcess,dialog}=require('electron');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {ProcessController}=require('./controller.cjs');
const {WatchAddressBook}=require('./watch-address-book.cjs');
const {readVaultPublicMetadata}=require('./wallet-vault-public-metadata.cjs');
const {assertTrustedIpcFrame}=require('./ipc-frame-gate.cjs');
const {reviewPublicPayment,compareObservedFunds}=require('./wallet-payment-review.cjs');
const {canonicalAddress,validateSavedWatchCatalog}=require('./canonical-public-address.cjs');
const {createShutdownGate}=require('./shutdown-gate.cjs');
const {authenticatedWalletBundle,runPrivilegedWalletTerminal}=require('./native-wallet-terminal-handoff.cjs');
const fsPromises=require('node:fs/promises');
const {registerSingleInstanceGuard}=require('./single-instance-guard.cjs');
const {makeUtilitySpawn}=require('./utility-process-adapter.cjs');
let win,controller,watchBook,shutdownGate=null,ciVaultSelection=null,walletTerminalActive=false;
function windowCreate(){
  win=new BrowserWindow({
    title:'Triumph Sovereign — Public Testnet Candidate',width:1220,height:820,minWidth:850,minHeight:610,
    backgroundColor:'#faf9f6',autoHideMenuBar:true,
    webPreferences:{preload:path.join(__dirname,'preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true}
  });
  win.on('close',event=>{if(shutdownGate)shutdownGate.request(event)});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',e=>e.preventDefault());
  if(process.argv.includes('--ts-smoke')) {
    // Isolated candidate CI only: no node, miner, signing or external network startup.
    const timeout=setTimeout(()=>{console.error('TS_GUI_SMOKE_TIMEOUT');app.exit(2)},30000);
    win.webContents.once('did-finish-load',async()=>{
      try{
        const snapshot=await win.webContents.executeJavaScript(
          "(async()=>{const pages=document.querySelectorAll('.nav[data-page]').length;const bridge=typeof window.triumph==='object';const state=bridge?await window.triumph.snapshot():null;const addr='faet1z5g4r8qgv29jcy350mvxgr3hpk35vjhdk3s6fn';const draft=await window.triumph.reviewPayment({from:addr,to:addr,amount:'1.00000001',fee:'0.00000002'});let forgedRejected=false;try{await window.triumph.watchAdd(addr.slice(0,-1)+'q','Unsafe address')}catch(e){forgedRejected=String(e?.message).includes('canonical FAE public address')}const e=id=>document.getElementById(id);e('wallet-address').value=addr;e('payment-to').value=addr;e('payment-amount').value='1.00000001';e('payment-fee').value='0.00000002';e('payment-review').click();let guiReady=false;for(let n=0;n<100;n++){if(e('payment-review-output').textContent.includes('Total: 1.00000003 FAE')){guiReady=true;break}await new Promise(resolve=>setTimeout(resolve,25))}e('payment-fee').value='0.00000003';e('payment-fee').dispatchEvent(new Event('input',{bubbles:true}));const guiReset=e('payment-review-output').textContent.includes('Payment details changed');return {draft,forgedRejected,guiReady,guiReset,reviewButton:document.getElementById('payment-review')?.textContent,title:document.title,pages,bridge,node:state?.node,miner:state?.miner,home:document.getElementById('page-home').classList.contains('visible'),ticker:document.querySelector('#page-home .eyebrow')?.textContent,displayedBalance:document.getElementById('balance-amount')?.textContent,unitLabel:document.querySelector('#page-wallet .balance-grid small')?.textContent,header:document.querySelector('header.top')?.textContent}})()"
        );
        if(snapshot.pages!==6||!snapshot.bridge||snapshot.node!=='stopped'||snapshot.miner!=='stopped'||!snapshot.home||
          !snapshot.ticker?.includes('TRIUM · OFFICIAL INTENDED TICKER')||
          snapshot.displayedBalance!=='— FAE'||
          snapshot.unitLabel!=='OBSERVED FAE TESTNET BALANCE · NOT TRIUM'||
          !snapshot.header?.includes('TRIUM · OFFICIAL INTENDED TICKER')||
          snapshot.header.includes('FATIMA')||
          snapshot.draft?.state!=='UNSIGNED_PUBLIC_REVIEW_ONLY'||
          snapshot.draft?.total_fae!=='1.00000003'||
          snapshot.draft?.submission!=='NOT_SUBMITTED'||
          snapshot.draft?.signing!=='UNAVAILABLE'||
          snapshot.guiReady!==true||snapshot.guiReset!==true||snapshot.forgedRejected!==true||
          !snapshot.reviewButton?.includes('Review unsigned payment'))
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
          "(async()=>{let started=false;try{const a=await window.triumph.startNode();started=a.node==='running';const addr='faet1z5g4r8qgv29jcy350mvxgr3hpk35vjhdk3s6fn';const status=await window.triumph.status();const explorer=await window.triumph.explorer('/explorer/status',{});const balance=await window.triumph.balance(addr);const activity=await window.triumph.explorer('/explorer/address',{address:addr,limit:5});const funding=await window.triumph.observePaymentFunds({from:addr,to:addr,amount:'1',fee:'0'});let malformedTxidDenied=false;try{await window.triumph.transactionLookup('bad')}catch{malformedTxidDenied=true}document.getElementById('wallet-txid').value='b'.repeat(64);document.getElementById('wallet-tx-track').click();let missingTxSafe=false;for(let n=0;n<120;n++){if(document.getElementById('wallet-tx-output').textContent.includes('No compatible transaction observation')){missingTxSafe=true;break}await new Promise(resolve=>setTimeout(resolve,25))}return {started,funding,malformedTxidDenied,missingTxSafe,network:status.network,height:status.height,tip_hash:status.tip_hash,explorer_network:explorer.network,tip_height:explorer.observed_tip_height,balance_address:balance.address,balance_atoms:balance.balance_atoms,activity_address:activity.address,activity_tip:activity.observed_tip_hash,activity_count:activity.events.length};}finally{if(started)await window.triumph.stopNode();}})()");
        if(!s.started||s.malformedTxidDenied!==true||s.missingTxSafe!==true||
          s.network!=='fairyelf-public-testnet-v4'||s.explorer_network!==s.network||
          !Number.isSafeInteger(s.height)||s.height!==s.tip_height||
          s.balance_address!=='faet1z5g4r8qgv29jcy350mvxgr3hpk35vjhdk3s6fn'||
          !/^[0-9]+$/.test(String(s.balance_atoms))||s.activity_address!==s.balance_address||
          s.activity_tip!==s.tip_hash||!Number.isSafeInteger(s.activity_count)||
          s.funding?.node!=='CURRENT_MANAGED_LOCAL_NODE_ASSERTION'||
          s.funding?.funding!=='NODE_REPORTED_BALANCE_BELOW_DRAFT_TOTAL'||
          s.funding?.observed_atoms!=='0'||
          s.funding?.observed_tip_height!==s.height||
          s.funding?.observed_tip_hash!==s.tip_hash||
          s.funding?.spendability!=='NOT_VERIFIED'||
          s.funding?.signing!=='UNAVAILABLE'||s.funding?.submission!=='NOT_SUBMITTED')
          throw Error('Native node/Explorer/Wallet watch-only tip mismatch');
        console.log('TS_NODE_SMOKE_PASS '+JSON.stringify(s));clearTimeout(timeout);app.exit(0);
      }catch(error){console.error('TS_NODE_SMOKE_FAIL '+error.message);clearTimeout(timeout);app.exit(1)}
    });
  }
  if(process.argv.includes('--ts-miner-smoke')){
    // Real installed Electron -> sandboxed IPC -> original node+miner ->
    // actual mined UTXO -> Wallet UI -> cold node restart. No signing.
    const timer=setTimeout(()=>{console.error('TS_MINER_SMOKE_TIMEOUT');app.exit(2)},105000);
    win.webContents.once('did-finish-load',async()=>{
      try{
        const result=await win.webContents.executeJavaScript(
          "(async()=>{\n  const address='faet1z5g4r8qgv29jcy350mvxgr3hpk35vjhdk3s6fn';\n  let node=false,miner=false,unsubscribe=()=>{};\n  const failClosed = result => result?.funding_authorization==='DENIED_UNVERIFIED'&&\n    result?.eligible_candidate_atoms==='0'&&result?.eligible_candidate_count===0&&\n    result?.outputs?.every(row=>row.spend_eligibility==='UNVERIFIED');\n  try{\n    const started=await window.triumph.startNode();\n    node=started.node==='running';\n    if(!node)throw Error('Original managed node did not start');\n    const genesis=await window.triumph.fundingCandidates(address);\n    if(!failClosed(genesis))throw Error('Node funding observation implied signing authority');\n    const initial=BigInt(genesis.confirmed_candidate_atoms);\n    const progress=new Promise((resolve,reject)=>{\n      const timeout=setTimeout(()=>reject(Error('No measured original miner progress')),20000);\n      unsubscribe=window.triumph.onState(s=>{\n        if(s.miner==='running'&&s.telemetry?.state==='MINING'&&\n           Number.isSafeInteger(s.telemetry?.hashrate_hs)&&s.telemetry.hashrate_hs>0){\n          clearTimeout(timeout);resolve(s.telemetry);\n        }\n      });\n    });\n    const mining=await window.triumph.startMiner(address);\n    miner=mining.miner==='running';\n    if(!miner)throw Error('Original managed miner did not start');\n    const telemetry=await progress;\n    let observed=null;\n    const until=Date.now()+60000;\n    while(Date.now()<until){\n      try{\n        observed=await window.triumph.fundingCandidates(address);\n      }catch(error){\n        // Real mining may change the tip between pre/post read status. Never\n        // trust the rejected observation; obtain a fresh read-only snapshot.\n        if(error.message!=='FAE chain tip changed during observation')throw error;\n        await new Promise(resolve=>setTimeout(resolve,140));\n        continue;\n      }\n      if(!failClosed(observed))throw Error('Managed node asserted unauthorized funding eligibility');\n      if(BigInt(observed.confirmed_candidate_atoms)>initial)break;\n      await new Promise(resolve=>setTimeout(resolve,140));\n    }\n    if(!observed||BigInt(observed.confirmed_candidate_atoms)<=initial)\n      throw Error('Original miner did not produce a real confirmed selected-node UTXO');\n    await window.triumph.stopMiner();miner=false;\n    const saved=await window.triumph.fundingCandidates(address);\n    if(!failClosed(saved)||BigInt(saved.confirmed_candidate_atoms)<=initial)\n      throw Error('Mining confirmation was not preserved before restart');\n    document.querySelector('.nav[data-page=\"wallet\"]').click();\n    document.getElementById('wallet-address').value=address;\n    document.getElementById('funding-candidates-refresh').click();\n    const ui=document.getElementById('funding-candidates-output');\n    let uiReady=false;\n    for(let i=0;i<100;i++){\n      if(ui.textContent.includes('FAE TESTNET · SELECTED NODE FUNDING CANDIDATES')&&\n         ui.textContent.includes('Funding authorization: DENIED_UNVERIFIED')){\n        uiReady=true;break;\n      }\n      await new Promise(resolve=>setTimeout(resolve,50));\n    }\n    if(!uiReady||!ui.textContent.includes('Signing: UNAVAILABLE')||\n       !ui.textContent.includes('Coinbase maturity: NOT VERIFIED'))\n      throw Error('Native Wallet UI did not display fail-closed real-mined UTXO observations');\n    const before={atoms:saved.candidate_atoms,confirmed:saved.confirmed_candidate_atoms,\n      height:saved.observed_tip_height,tip:saved.observed_tip_hash,outputs:saved.outputs};\n    await window.triumph.stopNode();node=false;\n    const restarted=await window.triumph.startNode();node=restarted.node==='running';\n    if(!node)throw Error('Original managed node could not restart');\n    const recovered=await window.triumph.fundingCandidates(address);\n    if(!failClosed(recovered)||JSON.stringify(before)!==JSON.stringify({\n      atoms:recovered.candidate_atoms,confirmed:recovered.confirmed_candidate_atoms,\n      height:recovered.observed_tip_height,tip:recovered.observed_tip_hash,\n      outputs:recovered.outputs\n    }))throw Error('Cold restart changed a mined public UTXO receipt or its exclusion state');\n    return {network:recovered.network,real_miner:true,\n      hashrate_hs:telemetry.hashrate_hs,real_confirmed_output:true,\n      cold_restart:true,gui_funding_observation:true,\n      eligible_candidate_atoms:recovered.eligible_candidate_atoms,\n      funding_authorization:recovered.funding_authorization,\n      observed_tip_height:recovered.observed_tip_height};\n  }finally{\n    unsubscribe();\n    if(miner)await window.triumph.stopMiner().catch(()=>{});\n    if(node)await window.triumph.stopNode().catch(()=>{});\n  }\n})()");
        if(result.network!=='fairyelf-public-testnet-v4'||!result.real_miner||
           result.hashrate_hs<=0||!result.real_confirmed_output||
           !result.cold_restart||!result.gui_funding_observation||
           result.eligible_candidate_atoms!=='0'||
           result.funding_authorization!=='DENIED_UNVERIFIED')
          throw Error('Invalid real installed miner-to-Wallet public funding/restart evidence');
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
async function trustedWalletTerminalCandidate(){
  // Developer-only candidate integration. The protected Wallet PR #342 has
  // not been merged into this client and installed release admission is HOLD.
  if(app.isPackaged||process.env.CI||typeof process.env.TS_WALLET_COMPANION_ROOT!=='string'||
     !path.isAbsolute(process.env.TS_WALLET_COMPANION_ROOT)||
     !process.stdin.isTTY||!process.stdout.isTTY||!process.stderr.isTTY)
    return null;
  const script=path.join(process.env.TS_WALLET_COMPANION_ROOT,
    'standalone','wallet','fae-wallet.mjs');
  try{await authenticatedWalletBundle(script);return script}
  catch{return null}
}
async function nativeWalletCandidateStatus(){
  const source=await trustedWalletTerminalCandidate();
  return Object.freeze({state:source?'TRUSTED_SOURCE_AND_TTY_CANDIDATE':'UNAVAILABLE',
    custody:'EXTERNAL_NATIVE_TERMINAL_ONLY',signing:'NOT_ADMITTED',
    send:'DISABLED',testnet:'FAE_PUBLIC_TESTNET_V4'});
}
async function nativeWalletCandidateCommand(command){
  if(!['create','recover','address','receive','outbox'].includes(command))
    throw Error('Wallet terminal command is not admitted');
  if(walletTerminalActive)throw Error('Native Wallet terminal already in progress');
  // Acquire synchronously before any asynchronous source attestation.
  walletTerminalActive=true;
  try{
    const script=await trustedWalletTerminalCandidate();
    if(!script)throw Error('Authenticated interactive Wallet companion unavailable');
    const vault=path.join(app.getPath('userData'),'native-wallet','fae-wallet.vault.json');
    await fsPromises.mkdir(path.dirname(vault),{recursive:true,mode:0o700});
    const result=await runPrivilegedWalletTerminal(command,{script,
      nodeExecutable:process.execPath,publicVault:vault,
      tty:{stdin:!!process.stdin.isTTY,stdout:!!process.stdout.isTTY,
        stderr:!!process.stderr.isTTY}});
    if(result.status!=='CLI_EXIT_SUCCESS'||!['create','recover'].includes(command))
      return result;
    // Public watch-only handoff only. A successful CLI exit cannot authenticate
    // ownership until a separately admitted signer unlocks and rederives keys.
    try{
      const addressSource=path.join(process.env.TS_WALLET_COMPANION_ROOT,
        'sovereign-forge','node','authoritative','address.mjs');
      const metadata=await readVaultPublicMetadata(vault,{addressSource});
      await validateSavedWatchCatalog(await watchBook.list(),addressSource);
      await watchBook.importPublicVaultAddresses(metadata.addresses);
      return {...result,public_import:'WATCH_ONLY_UNVERIFIED',
        imported_count:metadata.addresses.length};
    }catch{
      // Keep the independently created vault intact. No secret or path in UI.
      return {...result,public_import:'NOT_IMPORTED_VAULT_PRESERVED'};
    }
  }finally{walletTerminalActive=false}
}
function bindIpc(){
  const origin=pathToFileURL(path.join(__dirname,'index.html')).href;
  const addressSource=path.join(app.isPackaged?path.join(process.resourcesPath,'fae-runtime'):path.resolve(__dirname,'..','..'),
    'sovereign-forge','node','authoritative','address.mjs');
  const checkedWatchMutation=async operation=>{
    // Refuse to append to or rewrite a legacy invalid address catalog.
    // Preserve its bytes for independent recovery rather than silently purging.
    await validateSavedWatchCatalog(await watchBook.list(),addressSource);
    return operation();
  };
  const calls={
    'ts:snapshot':()=>controller.snapshot(),
    'ts:native-wallet-status':()=>nativeWalletCandidateStatus(),
    'ts:native-wallet-terminal':command=>nativeWalletCandidateCommand(command),
    'ts:start-node':()=>controller.startNode(),
    'ts:stop-node':()=>controller.stopNode(),
    'ts:start-miner':async addr=>controller.startMiner(await canonicalAddress(addr,addressSource)),
    'ts:stop-miner':()=>controller.stopMiner(),
    'ts:status':()=>controller.readStatus(),
    'ts:balance':async addr=>controller.readBalance(await canonicalAddress(addr,addressSource)),
    'ts:funding-candidates':async addr=>controller.readFundingCandidates(await canonicalAddress(addr,addressSource)),
    'ts:transaction-lookup':async txid=>{
      // One renderer-facing observation API; mode is selected exclusively by
      // the actual parent-owned ProcessController, never by a renderer flag.
      if(typeof txid!=='string'||!/^[0-9a-f]{64}$/.test(txid))
        throw Error('Exact public FAE transaction ID required');
      if(controller.nativeIpcCandidate){
        // No local HTTP fallback even after native restart/revocation/error.
        const result=await controller.readTransactionByTxid(txid);
        return {origin:'PARENT_OWNED_NATIVE_IPC',result};
      }
      // Existing unadmitted GUI continues to show the historical, explicitly
      // untrusted Explorer observation; this is not a signer or a native claim.
      const result=await controller.readExplorer('/explorer/transaction',{txid});
      return {origin:'LOCAL_HTTP_EXPLORER_CLAIM',result};
    },
    'ts:explorer':async(route,query)=>{
      if(route==='/explorer/address'&&query?.address!==undefined)
        await canonicalAddress(query.address,addressSource);
      return controller.readExplorer(route,query);
    },
    'ts:review-payment':draft=>reviewPublicPayment(draft,{
      addressSource:path.join(app.isPackaged?path.join(process.resourcesPath,'fae-runtime'):path.resolve(__dirname,'..','..'),
        'sovereign-forge','node','authoritative','address.mjs')
    }),
    'ts:observe-payment-funds':async draft=>{
      const addressSource=path.join(app.isPackaged?path.join(process.resourcesPath,'fae-runtime'):path.resolve(__dirname,'..','..'),
        'sovereign-forge','node','authoritative','address.mjs');
      const review=await reviewPublicPayment(draft,{addressSource});
      // The managed node itself remains an untrusted source of claims.
      // Balance is stable-tip-bound; signing and spendability remain disabled.
      const observed=await controller.readBalance(review.from);
      return compareObservedFunds(review,observed);
    },
    'ts:watch-list':async()=>validateSavedWatchCatalog(await watchBook.list(),addressSource),
    'ts:watch-add':async(address,alias)=>checkedWatchMutation(async()=>watchBook.add(await canonicalAddress(address,addressSource),alias)),
    'ts:watch-update':async(address,changes)=>checkedWatchMutation(async()=>watchBook.update(await canonicalAddress(address,addressSource),changes)),
    'ts:watch-remove':async address=>checkedWatchMutation(async()=>watchBook.remove(await canonicalAddress(address,addressSource))),
    'ts:watch-select':async address=>checkedWatchMutation(async()=>watchBook.select(await canonicalAddress(address,addressSource))),
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
      return checkedWatchMutation(()=>watchBook.importPublicVaultAddresses(metadata.addresses));
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
  shutdownGate=createShutdownGate({
    dispose:()=>{
      if(walletTerminalActive)throw Error('Native Wallet terminal is still active');
      return controller.dispose();
    },
    quit:()=>app.quit(),
    onFailure:()=>dialog.showErrorBox('Triumph Sovereign — shutdown incomplete',
      'The managed node or miner did not confirm termination. The window stays open; safely stop the process before closing.')
  });
  bindIpc();windowCreate();
});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',e=>{
  if(shutdownGate)shutdownGate.request(e);
});

}
