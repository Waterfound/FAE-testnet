import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import test from 'node:test';
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

class FakeTimers{
  constructor(){this.nextId=1;this.tasks=new Map()}
  setTimeout(fn,ms){const id=this.nextId++;this.tasks.set(id,{fn,ms});return id}
  clearTimeout(id){this.tasks.delete(id)}
  async runNext(){
    const id=[...this.tasks.keys()].sort((a,b)=>a-b)[0];
    if(id===undefined)throw new Error('no scheduled timeout');
    const task=this.tasks.get(id);this.tasks.delete(id);
    await task.fn();
    await Promise.resolve();
    return{ms:task.ms,id};
  }
  get size(){return this.tasks.size}
}

async function flush(){
  for(let i=0;i<4;i++)await new Promise(resolve=>setImmediate(resolve));
}

async function makeHarness(){
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
  const timers=new FakeTimers();
  const NETWORK='fairyelf-public-testnet-v4';
  const rewardAddress='faet1mts0406labonly';
  const A='a'.repeat(64),B='b'.repeat(64),C='c'.repeat(64);
  let height=100,tipHash=A,failNextStatus=false;
  const templateRequests=[],submitRequests=[],statusRequests=[];

  class FakeWorker{
    static instances=[];
    constructor(url){this.url=url;this.terminated=false;this.messages=[];this.onmessage=null;this.onerror=null;FakeWorker.instances.push(this)}
    postMessage(message){this.messages.push(message)}
    terminate(){this.terminated=true}
    emit(data){this.onmessage?.({data})}
  }

  const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
  const fetch=async(url,options={})=>{
    const text=String(url),path=text.includes('fae-public-testnet-v4')?text.split('fae-public-testnet-v4')[1]:text;
    if(path.startsWith('/status')){
      statusRequests.push({height,tip_hash:tipHash});
      if(failNextStatus){failNextStatus=false;throw new Error('simulated status outage')}
      return response({ok:true,node_version:5,network:NETWORK,height,tip_hash:tipHash,difficulty_bits:17,target_seconds:180,issued_atoms:'0',issued_fae:'0',max_supply_fae:'12000000',halving_era_blocks:600000});
    }
    if(path.startsWith('/state'))return response({ok:true,height,tip_hash:tipHash,recent:[]});
    if(path.startsWith('/balance'))return response({ok:true,balance_fae:'0'});
    if(path.startsWith('/spendable'))return response({ok:true,spendable_fae:'0',utxos:[]});
    if(path.startsWith('/transactions'))return response({ok:true,transactions:[]});
    if(path.startsWith('/template')){
      const value={ok:true,template_policy:'snapshot',header:{
        network:NETWORK,height:height+1,previous_hash:tipHash,timestamp_ms:Date.now(),difficulty_bits:17,
        miner_address:rewardAddress,reward_atoms:'1000000000',tx_root:'0'.repeat(64),tx_count:0
      },txids:[]};
      templateRequests.push({height:value.header.height,previous_hash:value.header.previous_hash});
      return response(value);
    }
    if(path.startsWith('/submit-block')){
      const body=JSON.parse(options.body||'{}');
      submitRequests.push(body);
      if(body.header?.height!==height+1||body.header?.previous_hash!==tipHash)return response({ok:false,error:'stale_tip',height,tip_hash:tipHash},409);
      return response({ok:true,height});
    }
    throw new Error('unexpected fetch '+path);
  };

  const context={
    window:null,document,localStorage,fetch,crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,Array,Map,Set,BigInt,
    Blob:class FakeBlob{constructor(parts,options){this.parts=parts;this.options=options}},
    URL:class FakeURL extends URL{static createObjectURL(){return'blob:fake-worker'}static revokeObjectURL(){}},
    Response,Error,String,Number,Object,JSON,Date,Math,Promise,console,atob,btoa,
    navigator:{clipboard:{writeText:async()=>{}}},
    setTimeout:(fn,ms)=>timers.setTimeout(fn,ms),
    clearTimeout:id=>timers.clearTimeout(id),
    setInterval:()=>0,clearInterval:()=>{},confirm:()=>true,Worker:FakeWorker
  };
  context.window=context;
  vm.createContext(context);
  vm.runInContext(await readFile(new URL('../../../core.js',import.meta.url),'utf8'),context,{filename:'core.js'});
  vm.runInContext(`
    async function loadWallet(){}
    function renderWallet(){}
    function copyText(){return Promise.resolve()}
    function setStatus(id,text,kind=''){const el=$(id);el.textContent=text;el.className='status'+(kind?' '+kind:'')}
  `,context);
  vm.runInContext(await readFile(new URL('../../../mining.js',import.meta.url),'utf8'),context,{filename:'mining.js'});
  await flush();
  context.rewardAddress=rewardAddress;
  vm.runInContext('wallet={address:rewardAddress,watchOnly:true}',context);

  return{
    context,timers,FakeWorker,templateRequests,submitRequests,statusRequests,A,B,C,rewardAddress,
    setTip(nextHeight,nextHash){height=nextHeight;tipHash=nextHash},
    failNextStatus(){failNextStatus=true},
    getTip(){return{height,tipHash}}
  };
}

async function waitWorkers(h,count){
  for(let i=0;i<50;i++){
    if(h.FakeWorker.instances.length>=count&&h.FakeWorker.instances[count-1].messages.length)return;
    await flush();
  }
  throw new Error('worker '+count+' did not start');
}

test('MTS-04 unchanged authoritative parent does not cancel direct Worker',async()=>{
  const h=await makeHarness();
  const iteration=vm.runInContext('mineDirectIteration(wallet.address)',h.context);
  await waitWorkers(h,1);
  const worker=h.FakeWorker.instances[0];
  const timer=await h.timers.runNext();
  assert.equal(timer.ms,2000);
  assert.equal(worker.terminated,false);
  assert.equal(h.submitRequests.length,0);
  vm.runInContext("stopWorker('STOP')",h.context);
  await assert.rejects(iteration,/STOP/);
});

test('MTS-04 authoritative chain advance cancels Worker before nonce/submission',async()=>{
  const h=await makeHarness();
  const iteration=vm.runInContext('mineDirectIteration(wallet.address)',h.context);
  await waitWorkers(h,1);
  const worker=h.FakeWorker.instances[0];
  h.setTip(101,h.B);
  await h.timers.runNext();
  await assert.rejects(iteration,/TIP_INVALIDATED/);
  assert.equal(worker.terminated,true);
  assert.equal(h.submitRequests.length,0);
  assert.ok(h.statusRequests.some(x=>x.height===101&&x.tip_hash===h.B));
});

test('MTS-04 same-height parent replacement cancels Worker',async()=>{
  const h=await makeHarness();
  const iteration=vm.runInContext('mineDirectIteration(wallet.address)',h.context);
  await waitWorkers(h,1);
  const worker=h.FakeWorker.instances[0];
  h.setTip(100,h.B);
  await h.timers.runNext();
  await assert.rejects(iteration,/TIP_INVALIDATED/);
  assert.equal(worker.terminated,true);
  assert.equal(h.submitRequests.length,0);
});

test('MTS-04 miningLoop automatically reacquires fresh template after tip invalidation',async()=>{
  const h=await makeHarness();
  const loop=vm.runInContext('miningLoop()',h.context);
  await waitWorkers(h,1);
  const first=h.FakeWorker.instances[0];
  assert.equal(first.messages[0].header.previous_hash,h.A);

  h.setTip(101,h.B);
  await h.timers.runNext();
  await waitWorkers(h,2);
  const second=h.FakeWorker.instances[1];
  assert.equal(first.terminated,true);
  assert.equal(second.messages[0].header.height,102);
  assert.equal(second.messages[0].header.previous_hash,h.B);
  assert.equal(h.submitRequests.length,0);

  vm.runInContext('stopMining()',h.context);
  await loop;
  assert.equal(second.terminated,true);
});

test('MTS-06 harness is deterministic and uses no real Proof of Work',async()=>{
  const h=await makeHarness();
  const iteration=vm.runInContext('mineDirectIteration(wallet.address)',h.context);
  await waitWorkers(h,1);
  assert.equal(h.FakeWorker.instances[0].messages.length,1);
  assert.equal(h.FakeWorker.instances[0].messages[0].header.previous_hash,h.A);
  assert.equal(h.templateRequests.length,1);
  assert.equal(h.submitRequests.length,0);
  vm.runInContext("stopWorker('STOP')",h.context);
  await assert.rejects(iteration,/STOP/);
});

console.log('MTS-04 direct cancellation, MTS-05 race/freshness and MTS-06 deterministic harness tests passed.');


test('MTS-05 late callback from invalidated generation cannot affect replacement Worker',async()=>{
  const h=await makeHarness();
  const firstIteration=vm.runInContext('mineDirectIteration(wallet.address)',h.context);
  await waitWorkers(h,1);
  const first=h.FakeWorker.instances[0];

  h.setTip(101,h.B);
  await h.timers.runNext();
  await assert.rejects(firstIteration,/TIP_INVALIDATED/);
  assert.equal(first.terminated,true);

  const secondIteration=vm.runInContext('mineDirectIteration(wallet.address)',h.context);
  await waitWorkers(h,2);
  const second=h.FakeWorker.instances[1];
  assert.equal(second.messages[0].header.previous_hash,h.B);

  first.emit({nonce:999,hash:'0'.repeat(64),attempts:999});
  await flush();

  assert.equal(second.terminated,false);
  assert.equal(h.submitRequests.length,0);
  vm.runInContext("stopWorker('STOP')",h.context);
  await assert.rejects(secondIteration,/STOP/);
});

test('MTS-05 freshness barrier rejects tip advance after nonce but before submit',async()=>{
  const h=await makeHarness();
  const iteration=vm.runInContext('mineDirectIteration(wallet.address)',h.context);
  await waitWorkers(h,1);
  const worker=h.FakeWorker.instances[0];

  worker.emit({nonce:11,hash:'0'.repeat(64),attempts:11});
  h.setTip(101,h.B);

  await assert.rejects(iteration,/TIP_INVALIDATED/);
  assert.equal(h.submitRequests.length,0);
  assert.ok(h.statusRequests.some(x=>x.height===101&&x.tip_hash===h.B));
});

test('MTS-05 freshness barrier fails closed when authoritative status is unavailable',async()=>{
  const h=await makeHarness();
  const iteration=vm.runInContext('mineDirectIteration(wallet.address)',h.context);
  await waitWorkers(h,1);
  const worker=h.FakeWorker.instances[0];

  worker.emit({nonce:12,hash:'0'.repeat(64),attempts:12});
  h.failNextStatus();

  await assert.rejects(iteration,/TIP_FRESHNESS_UNKNOWN/);
  assert.equal(h.submitRequests.length,0);
});

test('MTS-05 current authoritative tip permits exactly one direct submission',async()=>{
  const h=await makeHarness();
  const iteration=vm.runInContext('mineDirectIteration(wallet.address)',h.context);
  await waitWorkers(h,1);
  const worker=h.FakeWorker.instances[0];

  worker.emit({nonce:13,hash:'0'.repeat(64),attempts:13});
  const result=await iteration;

  assert.equal(result.mode,'direct');
  assert.equal(h.submitRequests.length,1);
  assert.equal(h.submitRequests[0].header.height,101);
  assert.equal(h.submitRequests[0].header.previous_hash,h.A);
  assert.ok(h.statusRequests.some(x=>x.height===100&&x.tip_hash===h.A));
});
