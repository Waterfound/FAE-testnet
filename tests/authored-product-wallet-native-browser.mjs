import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';

const BASE='http://127.0.0.1:4173/index.html';
const DEBUG='http://127.0.0.1:9222';
const candidates=[
  process.env.CHROME_BIN,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
].filter(Boolean);
const chrome=candidates.find(existsSync);
assert.ok(chrome,'No runner-native Chromium/Chrome executable found');

const proc=spawn(chrome,[
  '--headless=new',
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--remote-debugging-address=127.0.0.1',
  '--remote-debugging-port=9222',
  '--user-data-dir=/tmp/fae-authored-wallet-chrome',
  'about:blank'
],{stdio:['ignore','ignore','pipe']});

let stderr='';
proc.stderr.on('data',chunk=>stderr+=chunk.toString());

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function json(url,options){
  const response=await fetch(url,options);
  if(!response.ok)throw Error('HTTP '+response.status+' '+url);
  return response.json();
}
let version;
for(let i=0;i<60;i++){
  try{version=await json(DEBUG+'/json/version');break}catch{await sleep(250)}
}
assert.ok(version,'Chrome DevTools endpoint did not start: '+stderr.slice(-1200));

const targets=await json(DEBUG+'/json/list');
const page=targets.find(target=>target.type==='page');
assert.ok(page?.webSocketDebuggerUrl,'No page target available');

const ws=new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('CDP websocket timeout')),5000);
  ws.addEventListener('open',()=>{clearTimeout(timer);resolve()},{once:true});
  ws.addEventListener('error',event=>{clearTimeout(timer);reject(event.error||Error('CDP websocket error'))},{once:true});
});

let seq=0;
const pending=new Map();
ws.addEventListener('message',event=>{
  const msg=JSON.parse(event.data);
  if(msg.id&&pending.has(msg.id)){
    const {resolve,reject}=pending.get(msg.id);
    pending.delete(msg.id);
    if(msg.error)reject(Error(msg.error.message||JSON.stringify(msg.error)));
    else resolve(msg.result);
  }
});
function send(method,params={}){
  const id=++seq;
  return new Promise((resolve,reject)=>{
    pending.set(id,{resolve,reject});
    ws.send(JSON.stringify({id,method,params}));
  });
}
async function evaluate(expression){
  const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
  if(result.exceptionDetails)throw Error(result.exceptionDetails.text||'Runtime.evaluate failed');
  return result.result?.value;
}
async function waitFor(expression,label,limit=80){
  for(let i=0;i<limit;i++){
    if(await evaluate(expression))return;
    await sleep(100);
  }
  throw Error('Timed out waiting for '+label);
}

async function click(selector){
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
}
async function setValue(selector,value){
  await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
}

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});

const mockFetch=`
(()=>{
  const nativeFetch=globalThis.fetch.bind(globalThis);
  globalThis.fetch=async function(input,init={}){
    let raw=typeof input==='string'?input:(input&&input.url)||String(input);
    let url;
    try{url=new URL(raw,location.href)}catch{return nativeFetch(input,init)}
    if(url.hostname==='wfwwotuhectwknvbvgif.supabase.co'&&url.pathname.includes('/functions/v1/fae-public-testnet-v4')){
      const path=url.pathname.split('/functions/v1/fae-public-testnet-v4')[1]||'/';
      let body={};
      if(path.startsWith('/status')) body={height:250,issued_fae:'2500',max_supply_fae:'12000000',halving_era_blocks:430000,difficulty_bits:18,node_version:5,tip_hash:'0'.repeat(64)};
      else if(path.startsWith('/state')) body={recent:[]};
      else if(path.startsWith('/balance')) body={balance_fae:'2'};
      else if(path.startsWith('/spendable')) body={spendable_fae:'2',utxos:[{outpoint:'native-browser:0',amount_atoms:'200000000'}]};
      else if(path.startsWith('/submit-tx')) body={txid:'a'.repeat(64)};
      else if(path.startsWith('/transactions')) body={transactions:[]};
      else if(path.startsWith('/blocks')) body={blocks:[]};
      return new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'}});
    }
    return nativeFetch(input,init);
  };
})();`;
await send('Page.addScriptToEvaluateOnNewDocument',{source:mockFetch});

const visualDir=process.env.FAE_VISUAL_EVIDENCE_DIR;
async function captureSafeVisual(name,width,height){
  if(!visualDir)return;
  await evaluate('window.scrollTo(0,0)');
  await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<900});
  await sleep(170);
  const leak=await evaluate("Array.from(document.querySelectorAll('textarea')).some(e=>!e.closest('[hidden]') && e.value.trim().split(/\\s+/).length===24)");
  assert.equal(leak,false,'Screenshot blocked: recovery words visible');
  const mode=await evaluate("document.querySelector('#tab-wallet').getAttribute('aria-selected')==='true' && !document.querySelector('#panel-wallet').hidden ? 'wallet' : document.querySelector('#tab-mining').getAttribute('aria-selected')==='true' && !document.querySelector('#panel-mining').hidden ? 'mining' : 'unknown'");
  assert.equal(mode,name.startsWith('mining-')?'mining':'wallet','Wrong visible product mode for visual evidence '+name);
  if(name.startsWith('wallet-active-')){
    const anchor=await evaluate("(()=>{const n=document.querySelector('#bal');const r=n.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height,visible:!!n.offsetParent};})()");
    assert.ok(anchor.visible&&anchor.height>0&&anchor.top>=0&&anchor.top<height*.79,'Balance must be foreground in admitted Wallet: '+name+' '+JSON.stringify(anchor));
  }
  const overflow=await evaluate('document.documentElement.scrollWidth-document.documentElement.clientWidth');
  assert.ok(overflow<=1,'Visual evidence viewport overflows: '+name+' '+overflow);
  const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,fromSurface:true});
  const png=Buffer.from(shot.data,'base64');
  assert.ok(png.byteLength>15000,'Invalid visual capture '+name);
  mkdirSync(visualDir,{recursive:true});
  writeFileSync(visualDir+'/'+name+'.png',png,{flag:'wx'});
}

await send('Page.navigate',{url:BASE});
await waitFor("document.readyState==='complete'||document.readyState==='interactive'",'DOM ready');
await waitFor("document.querySelector('#panel-wallet')&&!document.querySelector('#panel-wallet').hidden",'Wallet default surface');

assert.equal(await evaluate("document.body.dataset.authorshipPropagation"),'product-wallet-v1');
assert.equal(await evaluate("document.querySelectorAll('.fae-hero').length"),0);
assert.equal(await evaluate("!!document.querySelector('.product-shell-head')"),true);
assert.equal(await evaluate("document.querySelector('#tab-wallet').getAttribute('aria-selected')"),'true');
assert.equal(await evaluate("document.querySelector('#wallet-connected-state').hidden"),true);
assert.match(await evaluate("document.querySelector('.wallet-admission-rule').textContent"),/No implicit Wallet creation/);
assert.match(await evaluate("document.querySelector('.wallet-stage-copy').textContent"),/Possession should feel quiet/);
assert.equal(await evaluate("document.querySelector('.ticker-track').textContent.includes('Block Height')"),true);

await captureSafeVisual('wallet-empty-desktop-1440',1440,900);
await captureSafeVisual('wallet-empty-ipad-834',834,1194);
await captureSafeVisual('wallet-empty-mobile-390',390,844);
await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});

await click('#action-create');
assert.equal(await evaluate("document.querySelector('#create-panel').hidden"),false);
assert.equal(await evaluate("document.querySelector('#wallet-connected-state').hidden"),true);
assert.equal(await evaluate("document.querySelector('#new-wallet-backup').hidden"),true);
assert.equal(await evaluate("document.querySelector('#new-wallet-confirmation').hidden"),true);

// Exact browser regression: staged New Wallet must remain non-persistent until all 24 words are verified.
await click('#createwallet');
await waitFor("document.querySelector('#newseedwords').value.trim().split(/\\s+/).length===24",'24-word generation');
const words=await evaluate("document.querySelector('#newseedwords').value.trim()");
assert.equal(await evaluate("document.querySelector('#wallet-connected-state').hidden"),true);
await click('#readyconfirm');
await waitFor("!document.querySelector('#new-wallet-confirmation').hidden",'backup confirmation stage');
await setValue('#confirmseed',words);
await click('#confirmwallet');
await waitFor("!document.querySelector('#wallet-connected-state').hidden",'Wallet admission');
const firstAddress=await evaluate("document.querySelector('#addr').value");
assert.match(firstAddress,/^faet1/);
assert.equal(await evaluate("document.querySelectorAll('#walletlist .wallet-row').length"),1);
assert.match(await evaluate("document.querySelector('#recoverystate').textContent"),/BACKUP_CONFIRMED|Wallet Connected/);

// Persistence must survive a real document reload with the encrypted vault still owning the identity.
await send('Page.navigate',{url:BASE});
await waitFor("document.readyState==='complete'||document.readyState==='interactive'",'Wallet reload');
await waitFor("!document.querySelector('#wallet-connected-state').hidden",'persisted Wallet after reload');
assert.equal(await evaluate("document.querySelector('#addr').value"),firstAddress);
assert.equal(await evaluate("document.querySelectorAll('#walletlist .wallet-row').length"),1);

// Authored visual evidence: capture ONLY a reloaded, admitted Wallet (no seed fields populated).
await click('#tab-wallet');
await waitFor("!document.querySelector('#panel-wallet').hidden && !document.querySelector('#wallet-connected-state').hidden",'Wallet selected for active screenshots');
assert.equal(await evaluate("document.querySelector('#tab-wallet').getAttribute('aria-selected')"),'true');
await captureSafeVisual('wallet-active-desktop-1440',1440,900);
await captureSafeVisual('wallet-active-ipad-834',834,1194);
await captureSafeVisual('wallet-active-mobile-390',390,844);
await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});

// Real browser signing path: DOM intent -> reviewed intent guard -> Ed25519 signing -> accepted TXID.
const sendDestination=await evaluate("walletAccount.addresses[1].address");
await setValue('#sendto',sendDestination);
await setValue('#sendamt','1');
await click('#send');
await waitFor("!document.querySelector('#lastsendtx').hidden",'accepted transaction receipt');
assert.equal(await evaluate("document.querySelector('#lastsendtxid').value"),'a'.repeat(64));
assert.match(await evaluate("document.querySelector('#sendstate').textContent"),/Transaction accepted/);

// Recovery with a passphrase must add a distinct Wallet without replacing the existing one.
await click('#action-recovery');
await captureSafeVisual('recovery-entry-mobile-390',390,844);
await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
await setValue('#recoveryseed',words);
await setValue('#recoverypassphrase','authored-native-browser');
await click('#verifyrecovery');
await waitFor("!document.querySelector('#recoverypreview-wrap').hidden",'recovery preview');
const recoveredAddress=await evaluate("document.querySelector('#recoverypreview').value");
assert.match(recoveredAddress,/^faet1/);
assert.notEqual(recoveredAddress,firstAddress);
await click('#admitrecovery');
await waitFor("document.querySelectorAll('#walletlist .wallet-row').length===2",'second Wallet admission');
assert.equal(await evaluate("document.querySelector('#addr').value"),recoveredAddress);

// Switch back to the original Wallet using the authored Wallet list controls.
await evaluate("Array.from(document.querySelectorAll('#walletlist .wallet-row')).find(row=>row.textContent.includes('Wallet 1'))?.querySelector('button:not(:disabled)')?.click()");
await waitFor("document.querySelector('#addr').value==="+JSON.stringify(firstAddress),'Wallet switch');
assert.equal(await evaluate("document.querySelectorAll('#walletlist .wallet-row').length"),2);

await click('#tab-wallet');
await waitFor("!document.querySelector('#panel-wallet').hidden",'Wallet selected for review');
await click('#tab-mining');
await waitFor("!document.querySelector('#panel-mining').hidden",'Mining mode');
await captureSafeVisual('mining-idle-desktop-1440',1440,900);
await captureSafeVisual('mining-idle-mobile-390',390,844);
await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
assert.match(await evaluate("document.querySelector('#miningactivity').textContent"),/Block discovery is probabilistic/);
assert.equal(await evaluate("/\\d+%\\s+to\\s+reward|almost there|reward in \\d+/i.test(document.querySelector('#panel-mining').textContent)"),false);
assert.equal(await evaluate("getComputedStyle(document.querySelector('.mining-activity-fill')).animationName"),'none');

await click('#tab-wallet');
await waitFor("!document.querySelector('#panel-wallet').hidden",'Wallet return');
assert.equal(await evaluate("document.querySelector('#wallet-connected-state').hidden"),false);
assert.equal(await evaluate("getComputedStyle(document.querySelector('.ticker-track')).animationName"),'none');

await evaluate("document.querySelector('#tab-wallet').focus()");
assert.equal(await evaluate("document.activeElement.id"),'tab-wallet');

let overflow=await evaluate("document.documentElement.scrollWidth-document.documentElement.clientWidth");
assert.ok(overflow<=1,'desktop horizontal overflow: '+overflow);

await send('Emulation.setDeviceMetricsOverride',{width:834,height:1194,deviceScaleFactor:1,mobile:true});
await sleep(150);
overflow=await evaluate("document.documentElement.scrollWidth-document.documentElement.clientWidth");
assert.ok(overflow<=1,'tablet horizontal overflow: '+overflow);

await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
await sleep(150);
overflow=await evaluate("document.documentElement.scrollWidth-document.documentElement.clientWidth");
assert.ok(overflow<=1,'mobile horizontal overflow: '+overflow);
assert.equal(await evaluate("document.querySelector('#wallet-connected-state').hidden"),false);

console.log(JSON.stringify({
  status:'PASS',
  engine:version.Browser,
  exact_surface:'Product Shell + Wallet',
  viewports:['1440x900','834x1194','390x844'],
  reduced_motion:true,
  no_implicit_wallet_creation:true,
  staged_24_word_admission:true,
  encrypted_vault_reload_persistence:true,
  local_signing_and_tx_receipt:true,
  passphrase_recovery_and_multi_wallet:true,
  mining_honesty:true,
  horizontal_overflow:false
},null,2));

ws.close();
proc.kill('SIGTERM');
