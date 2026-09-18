import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import test from 'node:test';
import vm from 'node:vm';

class FakeEventTarget{
  constructor(){this.listeners=new Map()}
  addEventListener(type,listener){
    if(!this.listeners.has(type))this.listeners.set(type,[]);
    this.listeners.get(type).push(listener);
  }
  removeEventListener(type,listener){
    const list=this.listeners.get(type)||[];
    this.listeners.set(type,list.filter(item=>item!==listener));
  }
  dispatchEvent(event){
    const e=typeof event==='string'?{type:event}:event;
    for(const listener of [...(this.listeners.get(e.type)||[])])listener.call(this,e);
    return true;
  }
}
class FakeClassList{add(){} remove(){} toggle(){}}
class FakeElement extends FakeEventTarget{
  constructor(id=''){
    super();this.id=id;this.hidden=false;this.tabIndex=0;this.disabled=false;this.value='';this.files=[];
    this.textContent='';this.className='';this.children=[];this.attributes={};this.dataset={};
    this.classList=new FakeClassList();this.style={};this.lastElementChild={textContent:''};
  }
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
    const task=this.tasks.get(id);this.tasks.delete(id);await task.fn();await Promise.resolve();return task.ms;
  }
}
async function flush(){for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve))}

async function makeHarness(){
  const documentTarget=new FakeEventTarget();
  const elements=new Map();
  const document={
    hidden:false,visibilityState:'visible',body:new FakeElement('body'),
    addEventListener:documentTarget.addEventListener.bind(documentTarget),
    removeEventListener:documentTarget.removeEventListener.bind(documentTarget),
    dispatchEvent:documentTarget.dispatchEvent.bind(documentTarget),
    getElementById(id){if(!elements.has(id))elements.set(id,new FakeElement(id));return elements.get(id)},
    createElement(){return new FakeElement()},
    execCommand(){return true}
  };
  const windowTarget=new FakeEventTarget();
  const storage=new Map(),localStorage={
    getItem:key=>storage.get(key)??null,
    setItem:(key,value)=>storage.set(key,String(value)),
    removeItem:key=>storage.delete(key)
  };
  const timers=new FakeTimers();
  const NETWORK='fairyelf-public-testnet-v4',rewardAddress='faet1mts08lifecycleonly';
  const A='a'.repeat(64),B='b'.repeat(64);
  let height=100,tipHash=A,statusFailures=0;
  const statusRequests=[],submitRequests=[],templateRequests=[];

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
      if(statusFailures>0){statusFailures--;throw new TypeError('simulated lifecycle status outage')}
      return response({ok:true,node_version:5,network:NETWORK,height,tip_hash:tipHash,difficulty_bits:17,target_seconds:180,issued_atoms:'0',issued_fae:'0',max_supply_fae:'12000000',halving_era_blocks:600000});
    }
    if(path.startsWith('/state'))return response({ok:true,height,tip_hash:tipHash,recent:[]});
    if(path.startsWith('/balance'))return response({ok:true,balance_fae:'0'});
    if(path.startsWith('/spendable'))return response({ok:true,spendable_fae:'0',utxos:[]});
    if(path.startsWith('/transactions'))return response({ok:true,transactions:[]});
    if(path.startsWith('/template')){
      const value={ok:true,template_policy:'snapshot',header:{network:NETWORK,height:height+1,previous_hash:tipHash,timestamp_ms:Date.now(),difficulty_bits:17,miner_address:rewardAddress,reward_atoms:'1000000000',tx_root:'0'.repeat(64),tx_count:0},txids:[]};
      templateRequests.push({height:value.header.height,previous_hash:value.header.previous_hash});return response(value);
    }
    if(path.startsWith('/submit-block')){
      const body=JSON.parse(options.body||'{}');submitRequests.push(body);
      if(body.header?.height!==height+1||body.header?.previous_hash!==tipHash)return response({ok:false,error:'stale_tip',height,tip_hash:tipHash},409);
      return response({ok:true,height});
    }
    throw new Error('unexpected fetch '+path);
  };

  const context={
    document,localStorage,fetch,crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,Array,Map,Set,BigInt,
    Blob:class FakeBlob{constructor(parts,options){this.parts=parts;this.options=options}},
    URL:class FakeURL extends URL{static createObjectURL(){return'blob:fake-worker'}static revokeObjectURL(){}},
    Response,Error,TypeError,String,Number,Object,JSON,Date,Math,Promise,console,atob,btoa,
    navigator:{clipboard:{writeText:async()=>{}}},
    setTimeout:(fn,ms)=>timers.setTimeout(fn,ms),clearTimeout:id=>timers.clearTimeout(id),
    setInterval:()=>0,clearInterval:()=>{},confirm:()=>true,Worker:FakeWorker,
    addEventListener:windowTarget.addEventListener.bind(windowTarget),
    removeEventListener:windowTarget.removeEventListener.bind(windowTarget),
    dispatchEvent:windowTarget.dispatchEvent.bind(windowTarget)
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
  await flush();context.rewardAddress=rewardAddress;vm.runInContext('wallet={address:rewardAddress,watchOnly:true}',context);

  return{
    context,document,timers,FakeWorker,A,B,statusRequests,submitRequests,templateRequests,
    setTip(nextHeight,nextHash){height=nextHeight;tipHash=nextHash},
    setVisibility(hidden){document.hidden=hidden;document.visibilityState=hidden?'hidden':'visible';document.dispatchEvent({type:'visibilitychange'})},
    pageShow(persisted=true){context.dispatchEvent({type:'pageshow',persisted})},
    failStatus(count=1){statusFailures+=count}
  };
}
async function waitWorker(h,count=1){
  for(let i=0;i<80;i++){const worker=h.FakeWorker.instances[count-1];if(worker?.messages?.length)return worker;await flush()}
  throw new Error('worker did not start');
}
const tracked=promise=>promise.then(value=>({value}),error=>({error}));

test('MTS-08 safety: stale solution after a suspended interval is blocked even before lifecycle integration',async()=>{
  const h=await makeHarness(),result=tracked(vm.runInContext('mineDirectIteration(wallet.address)',h.context)),worker=await waitWorker(h);
  h.document.hidden=true;h.document.visibilityState='hidden';
  h.setTip(101,h.B);
  worker.emit({nonce:41,hash:'0'.repeat(64),attempts:41});
  const settled=await result;
  assert.match(settled.error?.message||'',/TIP_INVALIDATED/);
  assert.equal(h.submitRequests.length,0);
});

test('MTS-08 visibility resume must immediately revalidate stale direct work without waiting for throttled timer',async()=>{
  const h=await makeHarness(),result=tracked(vm.runInContext('mineDirectIteration(wallet.address)',h.context)),worker=await waitWorker(h);
  h.document.hidden=true;h.document.visibilityState='hidden';
  h.setTip(101,h.B);
  h.document.hidden=false;h.document.visibilityState='visible';
  h.document.dispatchEvent({type:'visibilitychange'});
  await flush();
  try{
    assert.equal(worker.terminated,true,'stale Worker survived foreground resume until polling timer');
    const settled=await result;
    assert.match(settled.error?.message||'',/TIP_INVALIDATED|TIP_FRESHNESS_UNKNOWN/);
    assert.equal(h.submitRequests.length,0);
  }finally{
    if(!worker.terminated){vm.runInContext("stopWorker('STOP')",h.context);await result}
  }
});

test('MTS-08 pageshow after suspension must immediately revalidate stale direct work',async()=>{
  const h=await makeHarness(),result=tracked(vm.runInContext('mineDirectIteration(wallet.address)',h.context)),worker=await waitWorker(h);
  h.setTip(101,h.B);
  h.pageShow(true);
  await flush();
  try{
    assert.equal(worker.terminated,true,'stale Worker survived pageshow until polling timer');
    const settled=await result;
    assert.match(settled.error?.message||'',/TIP_INVALIDATED|TIP_FRESHNESS_UNKNOWN/);
    assert.equal(h.submitRequests.length,0);
  }finally{
    if(!worker.terminated){vm.runInContext("stopWorker('STOP')",h.context);await result}
  }
});

test('MTS-08 resume with unchanged authoritative tip must not false-cancel direct work',async()=>{
  const h=await makeHarness(),result=tracked(vm.runInContext('mineDirectIteration(wallet.address)',h.context)),worker=await waitWorker(h);
  h.document.hidden=true;h.document.visibilityState='hidden';
  h.document.hidden=false;h.document.visibilityState='visible';
  h.document.dispatchEvent({type:'visibilitychange'});
  h.pageShow(true);
  await flush();
  assert.equal(worker.terminated,false);
  assert.equal(h.submitRequests.length,0);
  vm.runInContext("stopWorker('STOP')",h.context);await result;
});



test('MTS-08 foreground resume with unavailable status fails closed immediately',async()=>{
  const h=await makeHarness(),result=tracked(vm.runInContext('mineDirectIteration(wallet.address)',h.context)),worker=await waitWorker(h);
  h.document.hidden=true;h.document.visibilityState='hidden';
  h.failStatus(1);
  h.document.hidden=false;h.document.visibilityState='visible';
  h.document.dispatchEvent({type:'visibilitychange'});
  const settled=await result;
  assert.equal(worker.terminated,true);
  assert.match(settled.error?.message||'',/TIP_FRESHNESS_UNKNOWN/);
  assert.equal(h.submitRequests.length,0);
});

console.log('MTS-08 lifecycle stress matrix completed.');
