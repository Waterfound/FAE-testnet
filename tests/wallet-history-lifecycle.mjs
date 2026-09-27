import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

class FakeClassList{
  add(){}
  remove(){}
  toggle(){}
}

class FakeElement{
  constructor(id=''){
    this.id=id;
    this.hidden=false;
    this.disabled=false;
    this.tabIndex=0;
    this.value='';
    this.textContent='';
    this.className='';
    this.children=[];
    this.attributes={};
    this.dataset={};
    this.classList=new FakeClassList();
    this.style={};
    this.listeners={};
    this.firstChild=null;
    this.lastElementChild={textContent:''};
  }
  addEventListener(type,listener){(this.listeners[type]??=[]).push(listener)}
  setAttribute(name,value){this.attributes[name]=String(value)}
  getAttribute(name){return this.attributes[name]}
  querySelector(){return this.lastElementChild}
  append(...nodes){
    this.children.push(...nodes);
    this.firstChild=this.children[0]||null;
    this.lastElementChild=this.children.at(-1)||this.lastElementChild;
  }
  removeChild(node){
    this.children=this.children.filter(item=>item!==node);
    this.firstChild=this.children[0]||null;
    return node;
  }
  focus(){}
  select(){}
  remove(){}
}

const elements=new Map();
const document={
  getElementById(id){
    if(!elements.has(id))elements.set(id,new FakeElement(id));
    return elements.get(id);
  },
  createElement(){return new FakeElement()},
  body:new FakeElement('body')
};

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const txid=letter=>letter.repeat(64);
const transaction=(address,letter)=>({
  txid:txid(letter),
  from_address:address,
  inputs:['fixture:0'],
  outputs:[{address,amount_atoms:'100000000'}],
  status:'pending',
  confirmed_height:null,
  created_at:'2026-09-27T17:00:00Z',
  mempool_seq:1
});

let statusFailOnce=false;
let historyMode='ready';
let readyLetter='a';
const pendingHistory=[];

function jsonResponse(payload,status=200){
  return new Response(JSON.stringify(payload),{
    status,
    headers:{'content-type':'application/json'}
  });
}

const fetch=async url=>{
  const requestUrl=new URL(String(url));
  const path=requestUrl.pathname.split('fae-public-testnet-v4')[1]||'';
  if(path.startsWith('/status')){
    if(statusFailOnce){
      statusFailOnce=false;
      return jsonResponse({error:'status_unavailable'},503);
    }
    return jsonResponse({
      height:200,
      issued_fae:'2000',
      max_supply_fae:'12000000',
      halving_era_blocks:430000,
      difficulty_bits:18,
      node_version:5
    });
  }
  if(path.startsWith('/state'))return jsonResponse({recent:[]});
  if(path.startsWith('/balance'))return jsonResponse({balance_fae:'2'});
  if(path.startsWith('/spendable'))return jsonResponse({spendable_fae:'2',utxos:[]});
  if(path.startsWith('/transactions')){
    const address=requestUrl.searchParams.get('address');
    if(historyMode==='invalid')return jsonResponse({transactions:'bad'});
    if(historyMode==='empty')return jsonResponse({transactions:[]});
    if(historyMode==='unavailable')return jsonResponse({error:'history_unavailable'},503);
    if(historyMode==='ready')return jsonResponse({transactions:[transaction(address,readyLetter)]});
    if(historyMode==='deferred'){
      return await new Promise(resolve=>{
        pendingHistory.push({
          address,
          resolve(payload){resolve(jsonResponse(payload))}
        });
      });
    }
  }
  return jsonResponse({});
};

const context={
  window:null,
  document,
  fetch,
  URL,
  Response,
  Date,
  Number,
  String,
  BigInt,
  Object,
  Array,
  RegExp,
  Error,
  JSON,
  Math,
  Promise,
  console,
  setTimeout,
  clearTimeout,
  TextEncoder,
  Uint8Array,
  atob,
  btoa
};
context.window=context;
vm.createContext(context);

const indexHtml=await readFile(new URL('../index.html',import.meta.url),'utf8');
assert.ok(indexHtml.includes('id="historystate"'),'history lifecycle status must be visible');
assert.ok(indexHtml.includes('id="retryhistory"'),'history retry control must exist');
assert.ok(indexHtml.includes('latest 100 network transactions'),'coverage must disclose the network scan bound');
assert.ok(indexHtml.includes('up to 30 for this address'),'coverage must disclose the per-address result bound');
assert.ok(indexHtml.includes('No pagination'),'coverage must disclose lack of pagination');
assert.ok(indexHtml.includes('mining rewards are excluded'),'coverage must exclude mining rewards');
assert.ok(indexHtml.includes('not lifetime history'),'coverage must reject lifetime-history claims');

for(const file of ['wallet-transactions.js','core.js']){
  vm.runInContext(
    await readFile(new URL('../'+file,import.meta.url),'utf8'),
    context,
    {filename:file}
  );
}

const setWallet=address=>{
  context.__address=address;
  vm.runInContext('wallet={address:__address}',context);
};
const historyState=()=>document.getElementById('historystate');
const historyList=()=>document.getElementById('txhist');
const currentTxid=()=>{
  const row=historyList().children[0];
  const body=row?.children?.[1];
  const field=body?.children?.find(child=>child.dataset.detailKey==='txid');
  return field?.children?.[1]?.value??null;
};

// Explicit loading -> ready lifecycle.
setWallet('fixture-address-A');
historyMode='deferred';
const loadingRun=vm.runInContext('refresh()',context);
await sleep(20);
assert.equal(historyState().dataset.state,'loading');
assert.equal(pendingHistory.length,1);
pendingHistory.shift().resolve({transactions:[transaction('fixture-address-A','a')]});
await loadingRun;
assert.equal(historyState().dataset.state,'ready_recent');
assert.equal(currentTxid(),txid('a'));

// A -> B -> A: only the newest A request may update history.
historyMode='deferred';
setWallet('fixture-address-A');
const a1=vm.runInContext('refresh()',context);
setWallet('fixture-address-B');
const b2=vm.runInContext('refresh()',context);
setWallet('fixture-address-A');
const a3=vm.runInContext('refresh()',context);
await sleep(20);
assert.deepEqual(pendingHistory.map(item=>item.address),[
  'fixture-address-A',
  'fixture-address-B',
  'fixture-address-A'
]);

pendingHistory[2].resolve({transactions:[transaction('fixture-address-A','c')]});
await a3;
assert.equal(historyState().dataset.state,'ready_recent');
assert.equal(currentTxid(),txid('c'));

pendingHistory[1].resolve({transactions:[transaction('fixture-address-B','b')]});
await b2;
pendingHistory[0].resolve({transactions:[transaction('fixture-address-A','a')]});
await a1;
assert.equal(historyState().dataset.state,'ready_recent');
assert.equal(currentTxid(),txid('c'),'stale A/B responses must not replace newest A result');
pendingHistory.length=0;

// A network/status failure preserves previously valid history and marks it stale.
historyMode='ready';
statusFailOnce=true;
await vm.runInContext('refresh()',context).catch(()=>{});
assert.equal(historyState().dataset.state,'stale');
assert.equal(currentTxid(),txid('c'),'stale history must preserve the prior valid result');
assert.equal(document.getElementById('retryhistory').hidden,false);
assert.match(historyState().textContent,/stale/i);

// Invalid payload is distinct from a bounded empty result.
historyMode='invalid';
await vm.runInContext('refresh()',context);
assert.equal(historyState().dataset.state,'invalid_payload');
assert.match(historyState().textContent,/invalid/i);
assert.doesNotMatch(historyState().textContent,/No transfers found/i);

historyMode='empty';
await vm.runInContext('refresh()',context);
assert.equal(historyState().dataset.state,'empty_within_available_coverage');
assert.match(historyState().textContent,/bounded source/i);
assert.match(historyState().textContent,/not a lifetime-history claim/i);

// Retry is wired to the same lifecycle and can recover to a valid result.
historyMode='invalid';
await vm.runInContext('refresh()',context);
assert.equal(document.getElementById('retryhistory').hidden,false);
readyLetter='b';
historyMode='ready';
assert.equal(document.getElementById('retryhistory').listeners.click.length,1);
document.getElementById('retryhistory').listeners.click[0]();
await sleep(30);
assert.equal(historyState().dataset.state,'ready_recent');
assert.equal(currentTxid(),txid('b'));
assert.equal(document.getElementById('retryhistory').hidden,true);

console.log('WTX-04 history lifecycle, bounded coverage, retry, stale preservation, and A-B-A rejection passed.');
