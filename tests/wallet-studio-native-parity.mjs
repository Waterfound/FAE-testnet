import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';

const BASE='http://127.0.0.1:4173';
const DEBUG='http://127.0.0.1:9231';
const binaries=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser'].filter(Boolean);
const chrome=binaries.find(existsSync);
assert.ok(chrome,'Native Chromium is required to prove Wallet Studio visual geometry');
const proc=spawn(chrome,['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-gpu',
 '--remote-debugging-address=127.0.0.1','--remote-debugging-port=9231',
 '--user-data-dir=/tmp/fae-wallet-studio-parity-chrome','about:blank'],{stdio:['ignore','ignore','pipe']});
let stderr='';proc.stderr.on('data',c=>stderr+=c.toString());
const sleep=ms=>new Promise(ok=>setTimeout(ok,ms));
async function json(url){const r=await fetch(url);if(!r.ok)throw Error('HTTP '+r.status);return r.json()}
let version;for(let i=0;i<80;i++){try{version=await json(DEBUG+'/json/version');break}catch{await sleep(200)}}
assert.ok(version,'Chromium inspector did not start: '+stderr.slice(-900));
const pages=await json(DEBUG+'/json/list');
const target=pages.find(x=>x.type==='page');
assert.ok(target?.webSocketDebuggerUrl);
const ws=new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true})});
let serial=0;const pending=new Map();
ws.addEventListener('message',event=>{const v=JSON.parse(event.data);if(!v.id||!pending.has(v.id))return;
 const p=pending.get(v.id);pending.delete(v.id);v.error?p.reject(Error(v.error.message)):p.resolve(v.result)});
function send(method,params={}){return new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))})}
async function run(expr){const r=await send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text);return r.result?.value}
async function wait(expr,label){for(let i=0;i<80;i++){if(await run(expr))return;await sleep(100)}throw Error('Timed out '+label)}
await send('Page.enable');await send('Runtime.enable');
await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
const selectorsByScreen={
 empty:['.shell','.stage-head','.empty-space','.empty-primary','.empty-aside','.empty-number','.empty-choices','.empty-floor'],
 create:['.shell','.stage-head','.creation-head','.creation-layout','.creation-primary','.creation-aside','.creation-rule','.creation-foot'],
 recovery:['.shell','.stage-head','.recovery-composition','.recovery-primary','.recovery-sheet','.recovery-step','.recovery-boundary','.sheet-foot']
};
let selectors=selectorsByScreen.empty;
const widths=[{w:1440,h:900,label:'desktop'},{w:834,h:1194,label:'ipad'},{w:390,h:844,label:'mobile'}];
const imageDir=process.env.FAE_STUDIO_EVIDENCE_DIR;
async function setup(kind,screen){
 const path=kind==='reference'?'/design/approved-wallet-vr08-studio/index.html':'/design/wallet-studio-functional/index.html';
 await send('Page.navigate',{url:BASE+path});
 await wait('location.pathname==='+JSON.stringify(path)+' && document.readyState==="complete"','page '+kind);
 if(kind==='reference'){
   await run("document.querySelectorAll('[data-screen]').forEach(v=>v.hidden=v.dataset.screen!=="+JSON.stringify(screen)+")");
 }else{
   await wait("document.documentElement.dataset.walletAdapter==='empty-vault-read-only'","candidate vault admission");
   if(screen==='create')await run("document.getElementById('startNew').click()");
   if(screen==='recovery')await run("document.getElementById('startRecovery').click()");
 }
 await wait("document.querySelector('.view:not([hidden])')?.dataset.screen==="+JSON.stringify(screen),"visible "+screen);
}
async function geometry(kind,item,screen){
 await send('Emulation.setDeviceMetricsOverride',{width:item.w,height:item.h,deviceScaleFactor:1,mobile:item.w<900});
 await sleep(130);
 const result=await run("(()=>{const names="+JSON.stringify(selectors)+";const rects={};for(const sel of names){const el=document.querySelector(sel);if(!el)throw Error('Missing '+sel);const r=el.getBoundingClientRect();if(r.width===0||r.height===0)throw Error('Invisible '+sel);rects[sel]={x:r.x,y:r.y,w:r.width,h:r.height}}return {rects,overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,viewport:innerWidth,visibleScreen:document.querySelector('.view:not([hidden])')?.dataset.screen,activeHidden:document.querySelector('[data-screen=active]').hidden}})()");
 assert.equal(result.visibleScreen,screen);
 assert.equal(result.activeHidden,true);
 assert.ok(result.overflow<=1,kind+' '+item.label+' horizontal overflow: '+result.overflow);
 const leak=await run("Array.from(document.querySelectorAll('textarea')).some(n=>!n.closest('[hidden]')&&n.value.trim().split(/\\s+/).length===24)");
 assert.equal(leak,false,'Recovery material would appear in screenshot');
 // Compare the interior independently of the known right-edge scrollbar rasterization.
 // Any interior mismatch fails the exact-source CI; never classify it as scrollbar drift.
 const interior=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,
   clip:{x:0,y:0,width:item.w-4,height:item.h,scale:1}});
 result.interiorPngSha256=createHash('sha256').update(Buffer.from(interior.data,'base64')).digest('hex');
 if(imageDir){
   const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
   const png=Buffer.from(shot.data,'base64');assert.ok(png.byteLength>15000);
   mkdirSync(imageDir,{recursive:true});
   writeFileSync(imageDir+'/'+screen+'-'+kind+'-'+item.label+'-'+item.w+'.png',png,{flag:'wx'});
 }
 return result;
}
try{
 for(const screen of ['empty','create','recovery']){
   selectors=selectorsByScreen[screen];
   await setup('reference',screen);
   const references=[];
   for(const item of widths)references.push(await geometry('reference',item,screen));
   await setup('candidate',screen);
   for(let i=0;i<widths.length;i++){
     const actual=await geometry('candidate',widths[i],screen),expected=references[i];
     assert.equal(actual.interiorPngSha256,expected.interiorPngSha256,
       'Approved Studio interior pixel drift '+screen+' '+widths[i].label+' (rightmost 4px scrollbar excluded)');
     for(const sel of selectors)for(const axis of ['x','y','w','h']){
       const delta=Math.abs(actual.rects[sel][axis]-expected.rects[sel][axis]);
       assert.ok(delta<=2,'Approved Studio geometry drift '+screen+' '+widths[i].label+' '+sel+' '+axis+' '+delta.toFixed(2)+'px');
     }
   }
 }
 console.log(JSON.stringify({status:'PASS',contract:'DFR_NATIVE_STUDIO_EMPTY_CREATE_RECOVERY_PARITY',reference:'1791582226769',scenes:['empty','create','recovery'],viewports:widths.map(x=>x.w),epsilon_px:2,interior_pixel_sha256_equal:true,scrollbar_edge_excluded_px:4,artistic_acceptance:false}));
}finally{
 ws.close();proc.kill('SIGTERM');
}
