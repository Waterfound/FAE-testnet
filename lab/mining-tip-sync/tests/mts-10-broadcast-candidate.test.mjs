import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import test from 'node:test';
import vm from 'node:vm';

class FakeEventTarget{
  constructor(){this.listeners=new Map()}
  addEventListener(type,listener){if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push(listener)}
  removeEventListener(type,listener){this.listeners.set(type,(this.listeners.get(type)||[]).filter(item=>item!==listener))}
  dispatchEvent(event){const e=typeof event==='string'?{type:event}:event;for(const listener of [...(this.listeners.get(e.type)||[])])listener.call(this,e);return true}
}
class FakeClassList{add(){} remove(){} toggle(){}}
class FakeElement extends FakeEventTarget{
  constructor(id=''){super();this.id=id;this.hidden=false;this.disabled=false;this.value='';this.files=[];this.textContent='';this.className='';this.children=[];this.attributes={};this.dataset={};this.classList=new FakeClassList();this.style={};this.lastElementChild={textContent:''}}
  setAttribute(name,value){this.attributes[name]=String(value)} getAttribute(name){return this.attributes[name]}
  querySelector(){return this.lastElementChild}
  append(...nodes){this.children.push(...nodes);this.firstChild=this.children[0]||null;this.lastElementChild=this.children.at(-1)||this.lastElementChild}
  removeChild(node){this.children=this.children.filter(item=>item!==node);this.firstChild=this.children[0]||null;return node}
  focus(){} select(){} remove(){} scrollIntoView(){} click(){}
}
class FakeTimers{
  constructor(){this.nextId=1;this.tasks=new Map();this.runCount=0}
  setTimeout(fn,ms){const id=this.nextId++;this.tasks.set(id,{fn,ms});return id}
  clearTimeout(id){this.tasks.delete(id)}
  async runNext(){
    const id=[...this.tasks.keys()].sort((a,b)=>a-b)[0];
    if(id===undefined)throw new Error('no scheduled timeout');
    const task=this.tasks.get(id);this.tasks.delete(id);this.runCount++;
    await task.fn();await Promise.resolve();return{ms:task.ms,id};
  }
}
class BroadcastHub{
  constructor(){this.byName=new Map();this.posts=[]}
  makeClass(clientId){
    const hub=this;
    return class FakeBroadcastChannel{
      constructor(name){
        this.name=name;this.clientId=clientId;this.listeners=[];this.closed=false;
        if(!hub.byName.has(name))hub.byName.set(name,new Set());
        hub.byName.get(name).add(this);
      }
      addEventListener(type,listener){if(type==='message')this.listeners.push(listener)}
      removeEventListener(type,listener){if(type==='message')this.listeners=this.listeners.filter(x=>x!==listener)}
      postMessage(data){
        if(this.closed)return;
        hub.posts.push({clientId:this.clientId,name:this.name,data});
        for(const peer of hub.byName.get(this.name)||[]){
          if(peer===this||peer.closed)continue;
          for(const listener of [...peer.listeners])listener.call(peer,{data});
        }
      }
      close(){this.closed=true;hub.byName.get(this.name)?.delete(this)}
    };
  }
  inject(name,data){
    this.posts.push({clientId:'external-test',name,data});
    for(const peer of this.byName.get(name)||[])for(const listener of [...peer.listeners])listener.call(peer,{data});
  }
}
async function flush(){for(let i=0;i<10;i++)await new Promise(resolve=>setImmediate(resolve))}
const tipHash=n=>Number(n).toString(16).padStart(64,'0');

class SharedNetwork{
  constructor(){
    this.network='fairyelf-public-testnet-v4';this.height=100;this.tipHash='a'.repeat(64);
    this.statusRequests=[];this.templateRequests=[];this.submitRequests=[];this.failureBudget=new Map();this.advanceOnSubmit=false;
  }
  setTip(height,hash){this.height=height;this.tipHash=hash}
  failStatus(clientId,count=1){this.failureBudget.set(clientId,(this.failureBudget.get(clientId)||0)+count)}
  response(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}})}
  async fetch(clientId,rewardAddress,url,options={}){
    const text=String(url),path=text.includes('fae-public-testnet-v4')?text.split('fae-public-testnet-v4')[1]:text;
    if(path.startsWith('/status')){
      this.statusRequests.push({clientId,height:this.height,tip_hash:this.tipHash});
      const remaining=this.failureBudget.get(clientId)||0;
      if(remaining>0){this.failureBudget.set(clientId,remaining-1);throw new TypeError('simulated hint status outage')}
      return this.response({ok:true,node_version:5,network:this.network,height:this.height,tip_hash:this.tipHash,difficulty_bits:17,target_seconds:180,issued_atoms:'0',issued_fae:'0',max_supply_fae:'12000000',halving_era_blocks:600000});
    }
    if(path.startsWith('/state'))return this.response({ok:true,height:this.height,tip_hash:this.tipHash,recent:[]});
    if(path.startsWith('/balance'))return this.response({ok:true,balance_fae:'0'});
    if(path.startsWith('/spendable'))return this.response({ok:true,spendable_fae:'0',utxos:[]});
    if(path.startsWith('/transactions'))return this.response({ok:true,transactions:[]});
    if(path.startsWith('/template')){
      const value={ok:true,template_policy:'snapshot',header:{network:this.network,height:this.height+1,previous_hash:this.tipHash,timestamp_ms:Date.now(),difficulty_bits:17,miner_address:rewardAddress,reward_atoms:'1000000000',tx_root:'0'.repeat(64),tx_count:0},txids:[]};
      this.templateRequests.push({clientId,height:value.header.height,previous_hash:value.header.previous_hash});return this.response(value);
    }
    if(path.startsWith('/submit-block')){
      const body=JSON.parse(options.body||'{}');this.submitRequests.push({clientId,body});
      if(body.header?.height!==this.height+1||body.header?.previous_hash!==this.tipHash)return this.response({ok:false,error:'stale_tip',height:this.height,tip_hash:this.tipHash},409);
      const acceptedHeight=body.header.height;
      if(this.advanceOnSubmit){this.height=acceptedHeight;this.tipHash=tipHash(acceptedHeight)}
      return this.response({ok:true,height:acceptedHeight});
    }
    throw new Error('unexpected fetch '+path);
  }
}
async function makeClient(clientId,network,hub,{broadcast=true,storage=new Map()}={}){
  const elements=new Map(),documentTarget=new FakeEventTarget();
  const document={
    hidden:false,visibilityState:'visible',body:new FakeElement('body'),
    addEventListener:documentTarget.addEventListener.bind(documentTarget),
    removeEventListener:documentTarget.removeEventListener.bind(documentTarget),
    dispatchEvent:documentTarget.dispatchEvent.bind(documentTarget),
    getElementById(id){if(!elements.has(id))elements.set(id,new FakeElement(id));return elements.get(id)},
    createElement(){return new FakeElement()},execCommand(){return true}
  };
  const windowTarget=new FakeEventTarget(),timers=new FakeTimers();
  const localStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,String(value)),removeItem:key=>storage.delete(key)};
  const rewardAddress='faet1mts10'+clientId.replace(/[^a-z0-9]/gi,'').toLowerCase();
  class FakeWorker{
    static instances=[];
    constructor(url){this.url=url;this.terminated=false;this.messages=[];this.onmessage=null;this.onerror=null;FakeWorker.instances.push(this)}
    postMessage(message){this.messages.push(message)} terminate(){this.terminated=true} emit(data){this.onmessage?.({data})}
  }
  const context={
    document,localStorage,fetch:(url,options)=>network.fetch(clientId,rewardAddress,url,options),
    crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,Array,Map,Set,BigInt,
    Blob:class FakeBlob{constructor(parts,options){this.parts=parts;this.options=options}},
    URL:class FakeURL extends URL{static createObjectURL(){return'blob:'+clientId}static revokeObjectURL(){}},
    Response,Error,TypeError,String,Number,Object,JSON,Date,Math,Promise,console,atob,btoa,
    navigator:{clipboard:{writeText:async()=>{}}},
    setTimeout:(fn,ms)=>timers.setTimeout(fn,ms),clearTimeout:id=>timers.clearTimeout(id),
    setInterval:()=>0,clearInterval:()=>{},confirm:()=>true,Worker:FakeWorker,
    addEventListener:windowTarget.addEventListener.bind(windowTarget),
    removeEventListener:windowTarget.removeEventListener.bind(windowTarget),
    dispatchEvent:windowTarget.dispatchEvent.bind(windowTarget)
  };
  if(broadcast)context.BroadcastChannel=hub.makeClass(clientId);
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
  return{clientId,context,timers,FakeWorker,rewardAddress};
}
async function waitWorker(client,count=1){
  for(let i=0;i<100;i++){const worker=client.FakeWorker.instances[count-1];if(worker?.messages?.length)return worker;await flush()}
  throw new Error(client.clientId+' worker '+count+' did not start');
}
async function stopLoop(client,loop){vm.runInContext('stopMining()',client.context);await loop}
const tracked=promise=>promise.then(value=>({value}),error=>({error}));

test('MTS-10 authoritative stale observation hints peer into immediate revalidation before its 2000ms timer',async()=>{
  const network=new SharedNetwork(),hub=new BroadcastHub(),storage=new Map();
  const a=await makeClient('tab-a',network,hub,{storage}),b=await makeClient('tab-b',network,hub,{storage});
  const loops=[vm.runInContext('miningLoop()',a.context),vm.runInContext('miningLoop()',b.context)];
  const [a1,b1]=await Promise.all([waitWorker(a),waitWorker(b)]);
  network.setTip(101,tipHash(101));
  const bRunsBefore=b.timers.runCount,bStatusBefore=network.statusRequests.filter(x=>x.clientId==='tab-b').length;
  const poll=await a.timers.runNext();
  assert.equal(poll.ms,2000);
  await flush();
  assert.equal(a1.terminated,true);
  assert.equal(b1.terminated,true,'peer stale work survived until its own polling timer');
  assert.equal(b.timers.runCount,bRunsBefore,'peer polling timer should not be required for hint acceleration');
  assert.ok(network.statusRequests.filter(x=>x.clientId==='tab-b').length>bStatusBefore,'peer did not perform authoritative /status revalidation');
  assert.ok(hub.posts.some(x=>x.clientId==='tab-a'&&x.data?.kind==='revalidate'));
  assert.ok(hub.posts.every(x=>x.data?.height===undefined&&x.data?.tip_hash===undefined),'hint leaked authoritative-looking tip payload');
  await Promise.all([waitWorker(a,2),waitWorker(b,2)]);
  assert.equal(network.submitRequests.length,0);
  await Promise.all([stopLoop(a,loops[0]),stopLoop(b,loops[1])]);
});

test('MTS-10 forged hint payload cannot cancel current work because /status remains authority',async()=>{
  const network=new SharedNetwork(),hub=new BroadcastHub(),b=await makeClient('tab-b',network,hub);
  const loop=vm.runInContext('miningLoop()',b.context),worker=await waitWorker(b);
  const before=network.statusRequests.filter(x=>x.clientId==='tab-b').length;
  hub.inject('fae-mining-tip-hint-v1',{kind:'revalidate',height:999999,tip_hash:'f'.repeat(64)});
  await flush();
  assert.equal(worker.terminated,false);
  assert.ok(network.statusRequests.filter(x=>x.clientId==='tab-b').length>before);
  assert.equal(network.submitRequests.length,0);
  await stopLoop(b,loop);
});

test('MTS-10 hint-triggered status outage is acceleration failure, not cancellation authority',async()=>{
  const network=new SharedNetwork(),hub=new BroadcastHub(),b=await makeClient('tab-b',network,hub);
  const loop=vm.runInContext('miningLoop()',b.context),worker=await waitWorker(b);
  network.failStatus('tab-b',1);
  hub.inject('fae-mining-tip-hint-v1',{kind:'revalidate'});
  await flush();
  assert.equal(worker.terminated,false,'hint outage incorrectly failed closed and canceled live work');
  assert.equal(network.submitRequests.length,0);
  await stopLoop(b,loop);
});

test('MTS-10 BroadcastChannel absence preserves independent polling convergence',async()=>{
  const network=new SharedNetwork(),hub=new BroadcastHub(),device=await makeClient('no-broadcast-device',network,hub,{broadcast:false});
  const loop=vm.runInContext('miningLoop()',device.context),worker=await waitWorker(device);
  network.setTip(101,tipHash(101));
  const poll=await device.timers.runNext();
  assert.equal(poll.ms,2000);
  const replacement=await waitWorker(device,2);
  assert.equal(worker.terminated,true);
  assert.equal(replacement.messages[0].header.previous_hash,tipHash(101));
  assert.equal(network.submitRequests.length,0);
  await stopLoop(device,loop);
});

test('MTS-10 locally accepted direct block hints peer only after authoritative acceptance',async()=>{
  const network=new SharedNetwork(),hub=new BroadcastHub(),a=await makeClient('winner',network,hub),b=await makeClient('peer',network,hub);
  const aResult=tracked(vm.runInContext('mineDirectIteration(wallet.address)',a.context));
  const bLoop=vm.runInContext('miningLoop()',b.context);
  const [a1,b1]=await Promise.all([waitWorker(a),waitWorker(b)]);
  network.advanceOnSubmit=true;
  a1.emit({nonce:77,hash:'0'.repeat(64),attempts:77});
  const settled=await aResult;
  assert.ok(settled.value,'winning direct iteration did not complete');
  await flush();
  assert.equal(b1.terminated,true,'peer did not revalidate after accepted local block hint');
  const b2=await waitWorker(b,2);
  assert.equal(b2.messages[0].header.previous_hash,tipHash(101));
  assert.equal(network.submitRequests.length,1);
  assert.ok(hub.posts.some(x=>x.clientId==='winner'&&x.data?.kind==='revalidate'));
  await stopLoop(b,bLoop);
});

console.log('MTS-10 BroadcastChannel candidate matrix passed.');
