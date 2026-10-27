'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','src','renderer.js'),'utf8');
const A='faet1z5g4r8qgv29jcy350mvxgr3hpk35vjhdk3s6fn';
const B='faet1'+'q'.repeat(38);
function deferred(){
 let resolve,reject;
 const promise=new Promise((a,b)=>{resolve=a;reject=b});
 return {promise,resolve,reject};
}
async function setup(){
 const elements=new Map();
 function get(id){
  if(!elements.has(id)){
   const handlers=new Map();
   const element={
    value:'',textContent:'',hidden:false,disabled:false,handlers,
    addEventListener(name,callback){handlers.set(name,callback)},
    removeAttribute(){},setAttribute(){},replaceChildren(){this.textContent=''},
    classList:{toggle(){},contains(){return false}},
    append(){}
   };
   elements.set(id,element);
  }
  return elements.get(id);
 }
 const api={
  snapshot:async()=>({node:'stopped',miner:'stopped',telemetry:{}}),
  watchList:async()=>({kind:'watch_only',selected:null,entries:[]}),
  onState:()=>()=>{},
  balance:async()=>({ok:true,address:A,balance_atoms:'100000000'}),
  explorer:async()=>({network:'fairyelf-public-testnet-v4',address:A,
    observed_tip_height:0,observed_tip_hash:'0'.repeat(64),events:[]})
 };
 const context=vm.createContext({
  document:{hidden:false,getElementById:get,querySelectorAll:()=>[],addEventListener(){}},
  window:{triumph:api},
  matchMedia:()=>({matches:true,addEventListener(){}}),
  setTimeout,clearTimeout,console
 });
 new vm.Script(source,{filename:'renderer.js'}).runInContext(context);
 await new Promise(resolve=>setImmediate(resolve));
 vm.runInContext("view({node:'running',miner:'stopped',telemetry:{}})",context);
 return {elements,get,api,context};
}
test('old Wallet balance never reappears after public address change',async()=>{
 const x=await setup(),req=deferred();
 x.api.balance=()=>req.promise;
 x.get('wallet-address').value=A;
 const pending=vm.runInContext('balance()',x.context);
 x.get('wallet-address').value=B;
 x.get('wallet-address').handlers.get('input')();
 req.resolve({ok:true,address:A,balance_atoms:'9900000000'});
 await pending;
 assert.equal(x.get('balance-amount').textContent,'— FAE');
 assert.match(x.get('balance-status').textContent,/Select an address/);
});
test('node shutdown revokes in-flight Wallet activity and balance',async()=>{
 const x=await setup(),balanceReq=deferred(),activityReq=deferred();
 x.api.balance=()=>balanceReq.promise;
 x.api.explorer=()=>activityReq.promise;
 x.get('wallet-address').value=A;
 const balance=vm.runInContext('balance()',x.context);
 const activity=vm.runInContext('walletActivity()',x.context);
 vm.runInContext("view({node:'stopped',miner:'stopped',telemetry:{}})",x.context);
 balanceReq.resolve({ok:true,address:A,balance_atoms:'99900000000'});
 activityReq.resolve({address:A,events:[{txid:'suspicious-stale-event'}],network:'fairyelf-public-testnet-v4'});
 await Promise.all([balance,activity]);
 assert.equal(x.get('balance-amount').textContent,'— FAE');
 assert.match(x.get('balance-status').textContent,/node stopped/i);
 assert.equal(x.get('wallet-activity-output').textContent,'No current local node activity observation');
});
test('stable active public observation can render actual FAE units but no FATIMA conversion',async()=>{
 const x=await setup();
 x.get('wallet-address').value=A;
 await vm.runInContext('balance()',x.context);
 assert.equal(x.get('balance-amount').textContent,'1 FAE');
 assert.match(x.get('balance-status').textContent,/Selected local node observation/);
});
