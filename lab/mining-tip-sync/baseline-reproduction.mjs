#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';

class FakeClassList{add(){} remove(){} toggle(){}}
class FakeElement{
  constructor(id=''){
    this.id=id;this.hidden=false;this.tabIndex=0;this.disabled=false;this.value='';this.files=[];
    this.textContent='';this.className='';this.children=[];this.attributes={};this.dataset={};
    this.classList=new FakeClassList();this.style={};this.listeners={};this.lastElementChild={textContent:''};
  }
  addEventListener(type,listener){(this.listeners[type]??=[]).push(listener)}
  setAttribute(name,value){this.attributes[name]=String(value)}
  getAttribute(name){return this.attributes[name]}
  querySelector(){return this.lastElementChild}
  append(...nodes){this.children.push(...nodes);this.firstChild=this.children[0]||null;this.lastElementChild=this.children.at(-1)||this.lastElementChild}
  removeChild(node){this.children=this.children.filter(item=>item!==node);this.firstChild=this.children[0]||null;return node}
  focus(){} select(){} remove(){} scrollIntoView(){} click(){}
}

const elements=new Map();
const document={
  body:new FakeElement('body'),
  getElementById(id){if(!elements.has(id))elements.set(id,new FakeElement(id));return elements.get(id)},
  createElement(){return new FakeElement()},
  execCommand(){return true}
};
const storage=new Map();
const localStorage={
  getItem:key=>storage.get(key)??null,
  setItem:(key,value)=>storage.set(key,String(value)),
  removeItem:key=>storage.delete(key)
};

const NETWORK='fairyelf-public-testnet-v4';
const rewardAddress='faet1baselineonly000000000000000000000000000000000000000000';
const tipA='a'.repeat(64);
const tipB='b'.repeat(64);
const tipC='c'.repeat(64);
let height=100;
let tipHash=tipA;
const templateRequests=[];
const submitRequests=[];
const statusObservations=[];

class FakeWorker{
  static instances=[];
  constructor(url){
    this.url=url;this.terminated=false;this.messages=[];this.onmessage=null;this.onerror=null;
    FakeWorker.instances.push(this);
  }
  postMessage(message){this.messages.push(message)}
  terminate(){this.terminated=true}
  emit(data){if(this.onmessage)this.onmessage({data})}
}

function jsonResponse(body,status=200){
  return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
}

const fetch=async(url,options={})=>{
  const text=String(url);
  const path=text.includes('fae-public-testnet-v4')?text.split('fae-public-testnet-v4')[1]:text;
  if(path.startsWith('/status')){
    const body={ok:true,node_version:5,network:NETWORK,height,tip_hash:tipHash,difficulty_bits:17,target_seconds:180,issued_atoms:'0',issued_fae:'0',max_supply_fae:'12000000',halving_era_blocks:600000};
    statusObservations.push({height,tip_hash:tipHash});
    return jsonResponse(body);
  }
  if(path.startsWith('/state'))return jsonResponse({ok:true,height,tip_hash:tipHash,recent:[]});
  if(path.startsWith('/balance'))return jsonResponse({ok:true,balance_fae:'0'});
  if(path.startsWith('/spendable'))return jsonResponse({ok:true,spendable_fae:'0',utxos:[]});
  if(path.startsWith('/transactions'))return jsonResponse({ok:true,transactions:[]});
  if(path.startsWith('/template')){
    const template={
      ok:true,
      template_policy:'snapshot',
      header:{
        network:NETWORK,
        height:height+1,
        previous_hash:tipHash,
        timestamp_ms:Date.now(),
        difficulty_bits:17,
        miner_address:rewardAddress,
        reward_atoms:'1000000000',
        tx_root:'0'.repeat(64),
        tx_count:0
      },
      txids:[]
    };
    templateRequests.push({height:template.header.height,previous_hash:template.header.previous_hash});
    return jsonResponse(template);
  }
  if(path.startsWith('/submit-block')){
    const body=JSON.parse(options.body||'{}');
    submitRequests.push({height:body.header?.height,previous_hash:body.header?.previous_hash,nonce:body.nonce,hash:body.hash});
    if(body.header?.height!==height+1||body.header?.previous_hash!==tipHash){
      return jsonResponse({ok:false,error:'stale_tip',height,tip_hash:tipHash},409);
    }
    return jsonResponse({ok:true,height});
  }
  throw new Error('Unexpected fetch '+path);
};

const context={
  window:null,document,localStorage,fetch,crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,Array,Map,Set,BigInt,
  Blob:class FakeBlob{constructor(parts,options){this.parts=parts;this.options=options}},
  URL:class FakeURL extends URL{
    static createObjectURL(){return 'blob:fake-worker'}
    static revokeObjectURL(){}
  },
  Response,Error,String,Number,Object,JSON,Date,Math,Promise,console,atob,btoa,
  navigator:{clipboard:{writeText:async()=>{}}},
  setTimeout,clearTimeout,setInterval:()=>0,clearInterval,
  confirm:()=>true,Worker:FakeWorker
};
context.window=context;
vm.createContext(context);

vm.runInContext(await readFile(new URL('../../core.js',import.meta.url),'utf8'),context,{filename:'core.js'});
vm.runInContext(`
async function loadWallet(){}
function renderWallet(){}
function copyText(){return Promise.resolve()}
function setStatus(id,text,kind=''){const el=$(id);el.textContent=text;el.className='status'+(kind?' '+kind:'')}
`,context);
vm.runInContext(await readFile(new URL('../../mining.js',import.meta.url),'utf8'),context,{filename:'mining.js'});
await new Promise(resolve=>setTimeout(resolve,0));
context.rewardAddress=rewardAddress;
vm.runInContext('wallet={address:rewardAddress,watchOnly:true}',context);

async function waitFor(predicate,label){
  for(let i=0;i<100;i++){
    if(predicate())return;
    await new Promise(resolve=>setTimeout(resolve,0));
  }
  throw new Error('Timed out waiting for '+label);
}

// Scenario A: ordinary refresh sees a new tip, but current Worker remains active.
const firstPromise=vm.runInContext('mineDirectIteration(wallet.address)',context);
await waitFor(()=>FakeWorker.instances.length===1&&FakeWorker.instances[0].messages.length===1,'first worker start');
const first=FakeWorker.instances[0];
assert.equal(first.messages[0].header.height,101);
assert.equal(first.messages[0].header.previous_hash,tipA);

height=101;tipHash=tipB;
await vm.runInContext('refresh()',context);
assert.equal(document.getElementById('height').textContent,101);
assert.equal(first.terminated,false,'refresh unexpectedly terminated stale Worker');

first.emit({nonce:7,hash:'0'.repeat(64),attempts:42});
let staleError=null;
try{await firstPromise}catch(error){staleError=error}
assert.ok(staleError,'expected stale submission rejection');
assert.equal(staleError.data?.error,'stale_tip');
assert.equal(submitRequests.length,1);
assert.equal(submitRequests[0].previous_hash,tipA);

// Scenario B: manual stop terminates old Worker; the next direct iteration reacquires /template.
const secondPromise=vm.runInContext('mineDirectIteration(wallet.address)',context);
await waitFor(()=>FakeWorker.instances.length===2&&FakeWorker.instances[1].messages.length===1,'second worker start');
const second=FakeWorker.instances[1];
assert.equal(second.messages[0].header.height,102);
assert.equal(second.messages[0].header.previous_hash,tipB);

height=102;tipHash=tipC;
await vm.runInContext('refresh()',context);
assert.equal(second.terminated,false,'refresh unexpectedly terminated second stale Worker');
vm.runInContext("stopWorker('STOP')",context);
let stopError=null;
try{await secondPromise}catch(error){stopError=error}
assert.equal(stopError?.message,'STOP');
assert.equal(second.terminated,true);

const thirdPromise=vm.runInContext('mineDirectIteration(wallet.address)',context);
await waitFor(()=>FakeWorker.instances.length===3&&FakeWorker.instances[2].messages.length===1,'third worker start');
const third=FakeWorker.instances[2];
assert.equal(third.messages[0].header.height,103);
assert.equal(third.messages[0].header.previous_hash,tipC);
vm.runInContext("stopWorker('STOP')",context);
try{await thirdPromise}catch(error){assert.equal(error.message,'STOP')}

const evidence={
  schema:'FAE_MTS_01_BASELINE_REPRODUCTION_V1',
  source_files:['core.js','mining.js'],
  deterministic_harness:true,
  real_pow_performed:false,
  private_material_used:false,
  initial_work:{height:101,previous_hash:tipA},
  authoritative_tip_after_refresh:{height:101,tip_hash:tipB},
  refresh_observed_new_tip:statusObservations.some(row=>row.height===101&&row.tip_hash===tipB),
  stale_worker_survived_authoritative_refresh:true,
  automatic_pre_nonce_cancellation_observed:false,
  stale_detection_point:'after fake solution -> submit-block -> stale_tip',
  stale_submission_observed:{count:submitRequests.length,previous_hash:submitRequests[0].previous_hash,rejected_as:'stale_tip'},
  manual_stop_terminated_old_worker:true,
  restart_reacquired_template:{height:103,previous_hash:tipC},
  template_requests:templateRequests,
  conclusion:'CURRENT_BROWSER_MINER_REPRODUCES_TIP_DRIVEN_CANCELLATION_GAP'
};

console.log(JSON.stringify(evidence,null,2));
const outputIndex=process.argv.indexOf('--output');
if(outputIndex!==-1){
  const output=process.argv[outputIndex+1];
  if(!output)throw new Error('--output requires a path');
  await writeFile(output,JSON.stringify(evidence,null,2)+'\n');
}
