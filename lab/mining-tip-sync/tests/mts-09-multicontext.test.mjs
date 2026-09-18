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
    const task=this.tasks.get(id);this.tasks.delete(id);
    await task.fn();await Promise.resolve();return{ms:task.ms,id};
  }
  get size(){return this.tasks.size}
}
async function flush(){for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve))}
const tipHash=n=>Number(n).toString(16).padStart(64,'0');

class SharedNetwork{
  constructor(){
    this.network='fairyelf-public-testnet-v4';
    this.height=100;
    this.tipHash='a'.repeat(64);
    this.statusRequests=[];
    this.templateRequests=[];
    this.submitRequests=[];
    this.failureBudget=new Map();
  }
  setTip(height,hash){this.height=height;this.tipHash=hash}
  failStatus(clientId,count=1){this.failureBudget.set(clientId,(this.failureBudget.get(clientId)||0)+count)}
  failuresLeft(clientId){return this.failureBudget.get(clientId)||0}
  response(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}})}
  async fetch(clientId,rewardAddress,url,options={}){
    const text=String(url),path=text.includes('fae-public-testnet-v4')?text.split('fae-public-testnet-v4')[1]:text;
    if(path.startsWith('/status')){
      this.statusRequests.push({clientId,height:this.height,tip_hash:this.tipHash});
      const remaining=this.failureBudget.get(clientId)||0;
      if(remaining>0){
        this.failureBudget.set(clientId,remaining-1);
        throw new TypeError('simulated per-context status outage');
      }
      return this.response({ok:true,node_version:5,network:this.network,height:this.height,tip_hash:this.tipHash,difficulty_bits:17,target_seconds:180,issued_atoms:'0',issued_fae:'0',max_supply_fae:'12000000',halving_era_blocks:600000});
    }
    if(path.startsWith('/state'))return this.response({ok:true,height:this.height,tip_hash:this.tipHash,recent:[]});
    if(path.startsWith('/balance'))return this.response({ok:true,balance_fae:'0'});
    if(path.startsWith('/spendable'))return this.response({ok:true,spendable_fae:'0',utxos:[]});
    if(path.startsWith('/transactions'))return this.response({ok:true,transactions:[]});
    if(path.startsWith('/template')){
      const value={ok:true,template_policy:'snapshot',header:{
        network:this.network,height:this.height+1,previous_hash:this.tipHash,timestamp_ms:Date.now(),difficulty_bits:17,
        miner_address:rewardAddress,reward_atoms:'1000000000',tx_root:'0'.repeat(64),tx_count:0
      },txids:[]};
      this.templateRequests.push({clientId,height:value.header.height,previous_hash:value.header.previous_hash});
      return this.response(value);
    }
    if(path.startsWith('/submit-block')){
      const body=JSON.parse(options.body||'{}');
      this.submitRequests.push({clientId,body});
      if(body.header?.height!==this.height+1||body.header?.previous_hash!==this.tipHash){
        return this.response({ok:false,error:'stale_tip',height:this.height,tip_hash:this.tipHash},409);
      }
      return this.response({ok:true,height:this.height});
    }
    throw new Error('unexpected fetch '+path);
  }
}

async function makeClient(clientId,network,storageMap){
  const elements=new Map();
  const documentTarget=new FakeEventTarget();
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
  const localStorage={
    getItem:key=>storageMap.get(key)??null,
    setItem:(key,value)=>storageMap.set(key,String(value)),
    removeItem:key=>storageMap.delete(key)
  };
  const timers=new FakeTimers();
  const rewardAddress='faet1mts09'+clientId.replace(/[^a-z0-9]/gi,'').toLowerCase();

  class FakeWorker{
    static instances=[];
    constructor(url){this.url=url;this.terminated=false;this.messages=[];this.onmessage=null;this.onerror=null;FakeWorker.instances.push(this)}
    postMessage(message){this.messages.push(message)}
    terminate(){this.terminated=true}
    emit(data){this.onmessage?.({data})}
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

  return{clientId,context,document,timers,FakeWorker,storageMap,rewardAddress};
}
async function waitWorker(client,count=1){
  for(let i=0;i<100;i++){
    const worker=client.FakeWorker.instances[count-1];
    if(worker?.messages?.length)return worker;
    await flush();
  }
  throw new Error(client.clientId+' worker '+count+' did not start');
}
async function stopLoop(client,loop){
  vm.runInContext('stopMining()',client.context);
  await loop;
}
const tracked=promise=>promise.then(value=>({value}),error=>({error}));

test('MTS-09 same-device tabs and isolated device converge independently after remote tip advance',async()=>{
  const network=new SharedNetwork(),sameDeviceStorage=new Map(),otherDeviceStorage=new Map();
  const tabA=await makeClient('tab-a',network,sameDeviceStorage);
  const tabB=await makeClient('tab-b',network,sameDeviceStorage);
  const device=await makeClient('device-c',network,otherDeviceStorage);

  const loops=[
    vm.runInContext('miningLoop()',tabA.context),
    vm.runInContext('miningLoop()',tabB.context),
    vm.runInContext('miningLoop()',device.context)
  ];
  const [a1,b1,c1]=await Promise.all([waitWorker(tabA),waitWorker(tabB),waitWorker(device)]);
  assert.equal(a1.messages[0].header.previous_hash,'a'.repeat(64));
  assert.equal(b1.messages[0].header.previous_hash,'a'.repeat(64));
  assert.equal(c1.messages[0].header.previous_hash,'a'.repeat(64));

  network.setTip(101,tipHash(101));

  await tabA.timers.runNext();
  const a2=await waitWorker(tabA,2);
  assert.equal(a1.terminated,true);
  assert.equal(a2.messages[0].header.previous_hash,tipHash(101));
  assert.equal(b1.terminated,false,'tab B changed before its own authoritative poll');
  assert.equal(c1.terminated,false,'other device changed before its own authoritative poll');

  await device.timers.runNext();
  const c2=await waitWorker(device,2);
  assert.equal(c1.terminated,true);
  assert.equal(c2.messages[0].header.previous_hash,tipHash(101));
  assert.equal(b1.terminated,false,'same-device tab B must not depend on tab A or device C');

  await tabB.timers.runNext();
  const b2=await waitWorker(tabB,2);
  assert.equal(b1.terminated,true);
  assert.equal(b2.messages[0].header.previous_hash,tipHash(101));

  assert.equal(network.submitRequests.length,0);
  assert.ok(network.statusRequests.some(row=>row.clientId==='tab-a'&&row.tip_hash===tipHash(101)));
  assert.ok(network.statusRequests.some(row=>row.clientId==='tab-b'&&row.tip_hash===tipHash(101)));
  assert.ok(network.statusRequests.some(row=>row.clientId==='device-c'&&row.tip_hash===tipHash(101)));

  await Promise.all([stopLoop(tabA,loops[0]),stopLoop(tabB,loops[1]),stopLoop(device,loops[2])]);
});

test('MTS-09 per-context status outage cannot contaminate healthy peers and delayed context converges later',async()=>{
  const network=new SharedNetwork(),sameDeviceStorage=new Map(),otherDeviceStorage=new Map();
  const tabA=await makeClient('tab-a',network,sameDeviceStorage);
  const tabB=await makeClient('tab-b',network,sameDeviceStorage);
  const device=await makeClient('device-c',network,otherDeviceStorage);
  const loops=[
    vm.runInContext('miningLoop()',tabA.context),
    vm.runInContext('miningLoop()',tabB.context),
    vm.runInContext('miningLoop()',device.context)
  ];
  const [a1,b1,c1]=await Promise.all([waitWorker(tabA),waitWorker(tabB),waitWorker(device)]);

  network.setTip(102,tipHash(102));
  network.failStatus('tab-a',2);

  await tabB.timers.runNext();
  await waitWorker(tabB,2);
  assert.equal(b1.terminated,true);
  assert.equal(a1.terminated,false);
  assert.equal(c1.terminated,false);

  await device.timers.runNext();
  await waitWorker(device,2);
  assert.equal(c1.terminated,true);
  assert.equal(a1.terminated,false);

  await tabA.timers.runNext();
  assert.equal(a1.terminated,false);
  await tabA.timers.runNext();
  assert.equal(a1.terminated,false);
  assert.equal(network.failuresLeft('tab-a'),0);

  await tabA.timers.runNext();
  const a2=await waitWorker(tabA,2);
  assert.equal(a1.terminated,true);
  assert.equal(a2.messages[0].header.previous_hash,tipHash(102));
  assert.equal(network.submitRequests.length,0);

  await Promise.all([stopLoop(tabA,loops[0]),stopLoop(tabB,loops[1]),stopLoop(device,loops[2])]);
});

test('MTS-09 externally mined block between nonce and submit is blocked locally without peer notification',async()=>{
  const network=new SharedNetwork(),device=await makeClient('device-c',network,new Map());
  const result=tracked(vm.runInContext('mineDirectIteration(wallet.address)',device.context));
  const worker=await waitWorker(device);

  network.setTip(101,tipHash(101));
  worker.emit({nonce:901,hash:'0'.repeat(64),attempts:901});
  const settled=await result;

  assert.match(settled.error?.message||'',/TIP_INVALIDATED/);
  assert.equal(network.submitRequests.length,0);
  assert.ok(network.statusRequests.some(row=>row.clientId==='device-c'&&row.tip_hash===tipHash(101)));
});

test('MTS-09 same-height remote parent replacement cancels each isolated context independently',async()=>{
  const network=new SharedNetwork(),storageA=new Map(),storageB=new Map();
  const a=await makeClient('device-a',network,storageA),b=await makeClient('device-b',network,storageB);
  const loops=[vm.runInContext('miningLoop()',a.context),vm.runInContext('miningLoop()',b.context)];
  const [a1,b1]=await Promise.all([waitWorker(a),waitWorker(b)]);

  network.setTip(100,'c'.repeat(64));
  await a.timers.runNext();
  const a2=await waitWorker(a,2);
  assert.equal(a1.terminated,true);
  assert.equal(a2.messages[0].header.previous_hash,'c'.repeat(64));
  assert.equal(b1.terminated,false);

  await b.timers.runNext();
  const b2=await waitWorker(b,2);
  assert.equal(b1.terminated,true);
  assert.equal(b2.messages[0].header.previous_hash,'c'.repeat(64));
  assert.equal(network.submitRequests.length,0);

  await Promise.all([stopLoop(a,loops[0]),stopLoop(b,loops[1])]);
});

console.log('MTS-09 multi-context independent-convergence stress tests passed.');
