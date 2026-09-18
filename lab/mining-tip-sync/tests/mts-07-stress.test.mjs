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
  for(let i=0;i<6;i++)await new Promise(resolve=>setImmediate(resolve));
}
const tipHash=n=>Number(n).toString(16).padStart(64,'0');

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
  const rewardAddress='faet1mts07stressonly';
  const A='a'.repeat(64);
  let height=100,tipHashValue=A,statusFailureBudget=0,statusFailureCount=0;
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
      statusRequests.push({height,tip_hash:tipHashValue});
      if(statusFailureBudget>0){statusFailureBudget--;statusFailureCount++;throw new TypeError('simulated transient status failure')}
      return response({ok:true,node_version:5,network:NETWORK,height,tip_hash:tipHashValue,difficulty_bits:17,target_seconds:180,issued_atoms:'0',issued_fae:'0',max_supply_fae:'12000000',halving_era_blocks:600000});
    }
    if(path.startsWith('/state'))return response({ok:true,height,tip_hash:tipHashValue,recent:[]});
    if(path.startsWith('/balance'))return response({ok:true,balance_fae:'0'});
    if(path.startsWith('/spendable'))return response({ok:true,spendable_fae:'0',utxos:[]});
    if(path.startsWith('/transactions'))return response({ok:true,transactions:[]});
    if(path.startsWith('/template')){
      const value={ok:true,template_policy:'snapshot',header:{
        network:NETWORK,height:height+1,previous_hash:tipHashValue,timestamp_ms:Date.now(),difficulty_bits:17,
        miner_address:rewardAddress,reward_atoms:'1000000000',tx_root:'0'.repeat(64),tx_count:0
      },txids:[]};
      templateRequests.push({height:value.header.height,previous_hash:value.header.previous_hash});
      return response(value);
    }
    if(path.startsWith('/submit-block')){
      const body=JSON.parse(options.body||'{}');
      submitRequests.push(body);
      if(body.header?.height!==height+1||body.header?.previous_hash!==tipHashValue){
        return response({ok:false,error:'stale_tip',height,tip_hash:tipHashValue},409);
      }
      return response({ok:true,height});
    }
    throw new Error('unexpected fetch '+path);
  };

  const context={
    window:null,document,localStorage,fetch,crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,Array,Map,Set,BigInt,
    Blob:class FakeBlob{constructor(parts,options){this.parts=parts;this.options=options}},
    URL:class FakeURL extends URL{static createObjectURL(){return'blob:fake-worker'}static revokeObjectURL(){}},
    Response,Error,TypeError,String,Number,Object,JSON,Date,Math,Promise,console,atob,btoa,
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
    context,timers,FakeWorker,templateRequests,submitRequests,statusRequests,A,rewardAddress,
    setTip(nextHeight,nextHash){height=nextHeight;tipHashValue=nextHash},
    failStatus(count=1){statusFailureBudget+=count},
    getStatusFailureCount(){return statusFailureCount},
    getTip(){return{height,tip_hash:tipHashValue}}
  };
}

async function waitWorkers(h,count){
  for(let i=0;i<100;i++){
    if(h.FakeWorker.instances.length>=count&&h.FakeWorker.instances[count-1].messages.length)return;
    await flush();
  }
  throw new Error('worker '+count+' did not start');
}

test('MTS-07 survives twelve rapid consecutive authoritative tips with zero stale submissions',async()=>{
  const h=await makeHarness();
  const loop=vm.runInContext('miningLoop()',h.context);
  await waitWorkers(h,1);

  for(let i=1;i<=12;i++){
    const nextHeight=100+i,nextHash=tipHash(i);
    const oldWorker=h.FakeWorker.instances[i-1];
    h.setTip(nextHeight,nextHash);
    const timer=await h.timers.runNext();
    assert.equal(timer.ms,2000);
    await waitWorkers(h,i+1);
    const current=h.FakeWorker.instances[i];
    assert.equal(oldWorker.terminated,true);
    assert.equal(current.messages[0].header.height,nextHeight+1);
    assert.equal(current.messages[0].header.previous_hash,nextHash);
    assert.equal(h.submitRequests.length,0);
    const active=h.FakeWorker.instances.filter(worker=>!worker.terminated);
    assert.equal(active.length,1);
    assert.equal(active[0],current);
  }

  vm.runInContext('stopMining()',h.context);
  await loop;
  assert.equal(h.submitRequests.length,0);
  assert.equal(h.templateRequests.length,13);
});

test('MTS-07 delayed observer under heavy callback pressure is still protected by pre-submit freshness',async()=>{
  const h=await makeHarness();
  const iteration=vm.runInContext('mineDirectIteration(wallet.address)',h.context);
  await waitWorkers(h,1);
  const worker=h.FakeWorker.instances[0];

  h.setTip(105,tipHash(105));
  for(let i=1;i<=2000;i++)worker.emit({progress:true,attempts:i*256,rate:50000+i});
  assert.equal(worker.terminated,false,'observer should still be pending in the delayed-event-loop model');

  worker.emit({nonce:77,hash:'0'.repeat(64),attempts:512001});
  await assert.rejects(iteration,/TIP_INVALIDATED/);

  assert.equal(h.submitRequests.length,0);
  assert.ok(h.statusRequests.some(row=>row.height===105&&row.tip_hash===tipHash(105)));
});

test('MTS-07 observer tolerates a three-failure status outage then cancels stale work on recovery',async()=>{
  const h=await makeHarness();
  const loop=vm.runInContext('miningLoop()',h.context);
  await waitWorkers(h,1);
  const first=h.FakeWorker.instances[0];

  h.setTip(103,tipHash(103));
  h.failStatus(3);
  for(let i=0;i<3;i++){
    const timer=await h.timers.runNext();
    assert.equal(timer.ms,2000);
    assert.equal(first.terminated,false);
    assert.equal(h.submitRequests.length,0);
  }
  assert.equal(h.getStatusFailureCount(),3);

  await h.timers.runNext();
  await waitWorkers(h,2);
  const second=h.FakeWorker.instances[1];

  assert.equal(first.terminated,true);
  assert.equal(second.messages[0].header.height,104);
  assert.equal(second.messages[0].header.previous_hash,tipHash(103));
  assert.equal(h.submitRequests.length,0);

  vm.runInContext('stopMining()',h.context);
  await loop;
});

test('MTS-07 solution during transient status outage fails closed and miningLoop recovers automatically',async()=>{
  const h=await makeHarness();
  const loop=vm.runInContext('miningLoop()',h.context);
  await waitWorkers(h,1);
  const first=h.FakeWorker.instances[0];

  h.failStatus(1);
  first.emit({nonce:88,hash:'0'.repeat(64),attempts:88});

  await waitWorkers(h,2);
  const second=h.FakeWorker.instances[1];
  assert.equal(first.terminated,true);
  assert.equal(h.getStatusFailureCount(),1);
  assert.equal(h.submitRequests.length,0);
  assert.equal(second.messages[0].header.previous_hash,h.A);

  vm.runInContext('stopMining()',h.context);
  await loop;
});

console.log('MTS-07 rapid-tip, delayed-scheduling and transient-network stress tests passed.');
