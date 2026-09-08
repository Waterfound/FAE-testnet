import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';

class FakeClassList{add(){}remove(){}toggle(){}}
class FakeElement{
  constructor(id=''){this.id=id;this.hidden=false;this.tabIndex=0;this.disabled=false;this.value='';this.files=[];this.textContent='';this.className='';this.children=[];this.attributes={};this.dataset={};this.classList=new FakeClassList();this.style={};this.listeners={};this.lastElementChild={textContent:''}}
  addEventListener(type,listener){(this.listeners[type]??=[]).push(listener)}setAttribute(name,value){this.attributes[name]=String(value)}getAttribute(name){return this.attributes[name]}querySelector(){return this.lastElementChild}
  append(...nodes){this.children.push(...nodes);this.firstChild=this.children[0]||null;this.lastElementChild=this.children.at(-1)||this.lastElementChild}removeChild(node){this.children=this.children.filter(x=>x!==node);this.firstChild=this.children[0]||null;return node}
  focus(){}select(){}remove(){}scrollIntoView(){}click(){}
}
const elements=new Map(),document={body:new FakeElement('body'),getElementById(id){if(!elements.has(id))elements.set(id,new FakeElement(id));return elements.get(id)},createElement(){return new FakeElement()},execCommand(){return true}},storage=new Map(),localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)};

let coordinatorMode='active',workCalls=0,shareCalls=0,directTemplates=0,directSubmissions=0;
const COORDINATOR='https://coordinator.test',ACTIVE='fae-public-testnet-v4';
const fetch=async(url,options={})=>{
  const text=String(url),method=options.method||'GET';
  if(text.startsWith(COORDINATOR)){
    if(text.endsWith('/work')&&method==='POST'){
      workCalls++;
      if(coordinatorMode==='inactive')return new Response(JSON.stringify({ok:false,error:'PPLNS multi-output coinbase activation required'}),{status:409,headers:{'content-type':'application/json'}});
      const address=JSON.parse(options.body).address,payouts=[{address,amount_atoms:'1037'}];
      return new Response(JSON.stringify({ok:true,workMode:'share',jobId:'job-12345678',targetDifficultyBits:12,blockDifficultyBits:18,payoutCommitment:'c'.repeat(64),header:{network:'fairyelf-public-testnet-v4',height:151,previous_hash:'a'.repeat(64),difficulty_bits:18,coinbase_mode:'pplns-direct',reward_atoms:'1000',fee_atoms:'37'},payouts,coinbase_outputs:payouts,txids:[]}),{status:200,headers:{'content-type':'application/json'}});
    }
    if(text.endsWith('/share')&&method==='POST'){
      shareCalls++;
      if(coordinatorMode==='stale')return new Response(JSON.stringify({ok:false,error:'Stale share job after chain-tip change'}),{status:409,headers:{'content-type':'application/json'}});
      return new Response(JSON.stringify({ok:true,accepted:true,share:{seq:1,entryHash:'d'.repeat(64),zeroBits:12,targetDifficultyBits:12},block:null,payoutCommitment:'c'.repeat(64)}),{status:200,headers:{'content-type':'application/json'}});
    }
  }
  const path=text.split(ACTIVE)[1]||'';let body={};
  if(path.startsWith('/status'))body={height:150,issued_fae:'1500',max_supply_fae:'12000000',halving_era_blocks:600000,difficulty_bits:18,node_version:5};
  else if(path.startsWith('/state'))body={recent:[]};
  else if(path.startsWith('/balance'))body={balance_fae:'0'};
  else if(path.startsWith('/spendable'))body={spendable_fae:'0',utxos:[]};
  else if(path.startsWith('/transactions'))body={transactions:[]};
  else if(path.startsWith('/template')){directTemplates++;body={header:{network:'fairyelf-public-testnet-v4',height:151,previous_hash:'a'.repeat(64),difficulty_bits:18,reward_atoms:'1000'},txids:[]}}
  else if(path.startsWith('/submit-block')){directSubmissions++;body={ok:true,height:151,hash:'0'.repeat(64),tx_count:0}}
  return new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'}});
};

let clipboard='';const context={window:null,document,localStorage,fetch,crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,Array,Map,Set,BigInt,Blob,URL,Response,Error,String,Number,Object,JSON,Date,Math,Promise,console,atob,btoa,AbortController,navigator:{clipboard:{writeText:async value=>{clipboard=value}}},setTimeout,clearTimeout,setInterval:()=>0,clearInterval,confirm:()=>true,FAE_SHARE_COORDINATORS:[COORDINATOR]};context.window=context;vm.createContext(context);
for(const file of ['bip39-en.js','network-status.js','core.js','wallet-crypto.js','wallet.js','mining.js'])vm.runInContext(await readFile(new URL('../'+file,import.meta.url),'utf8'),context,{filename:file});
await new Promise(resolve=>setTimeout(resolve,25));await vm.runInContext('createNewWallet()',context);const address=vm.runInContext('wallet.address',context);context.address=address;
vm.runInContext("localPow=async()=>({nonce:7,hash:'0'.repeat(64),attempts:1})",context);

const shareCycle=await vm.runInContext('mineOneIteration(address)',context);assert.equal(shareCycle.mode,'share');assert.equal(workCalls,1);assert.equal(shareCalls,1);assert.equal(directTemplates,0);assert.equal(directSubmissions,0);
coordinatorMode='inactive';const fallback=await vm.runInContext('mineOneIteration(address)',context);assert.equal(fallback.mode,'direct');assert.equal(fallback.fallbackFailures,1);assert.equal(directTemplates,1);assert.equal(directSubmissions,1);
coordinatorMode='stale';const staleFallback=await vm.runInContext('mineOneIteration(address)',context);assert.equal(staleFallback.mode,'direct');assert.equal(staleFallback.fallbackFailures,1);assert.equal(shareCalls,2);assert.equal(directTemplates,2);assert.equal(directSubmissions,2);
assert.equal(vm.runInContext('SHARE_COORDINATORS.length',context),1);assert.equal(clipboard,'');
console.log('FAE browser PPLNS share path and direct-PoW fallback checks passed.');
