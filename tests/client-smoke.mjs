import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
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
    this.tabIndex=0;
    this.disabled=false;
    this.value='';
    this.files=[];
    this.textContent='';
    this.className='';
    this.children=[];
    this.attributes={};
    this.dataset={};
    this.classList=new FakeClassList();
    this.style={};
    this.listeners={};
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
  scrollIntoView(){}
  click(){}
}

const elements=new Map();
const document={
  body:new FakeElement('body'),
  getElementById(id){
    if(!elements.has(id))elements.set(id,new FakeElement(id));
    return elements.get(id);
  },
  createElement(){return new FakeElement()},
  execCommand(){return true}
};

const storage=new Map();
const localStorage={
  getItem:key=>storage.get(key)??null,
  setItem:(key,value)=>storage.set(key,String(value)),
  removeItem:key=>storage.delete(key)
};

let submittedTransaction=null;
const fetch=async(url,options={})=>{
  const requestUrl=new URL(String(url));
  const path=requestUrl.pathname.split('fae-public-testnet-v4')[1]||'';
  let body={};
  if(path.startsWith('/status')){
    body={height:150,issued_fae:'1500',max_supply_fae:'21000000',halving_era_blocks:600000,difficulty_bits:17,node_version:5};
  }else if(path.startsWith('/state')){
    body={recent:[]};
  }else if(path.startsWith('/balance')){
    body={balance_fae:'2'};
  }else if(path.startsWith('/spendable')){
    body={spendable_fae:'2',utxos:[{outpoint:'smoke:0',amount_atoms:'200000000'}]};
  }else if(path.startsWith('/transactions')){
    const activeAddress=requestUrl.searchParams.get('address');
    body={transactions:activeAddress?[{
      txid:'b'.repeat(64),
      from_address:activeAddress,
      inputs:['smoke:0'],
      outputs:[{address:activeAddress,amount_atoms:'100000000'}],
      status:'pending',
      confirmed_height:null,
      created_at:'2026-09-23T10:00:00Z',
      mempool_seq:1
    }]:[]};
  }else if(path.startsWith('/submit-tx')){
    submittedTransaction=JSON.parse(options.body).tx;
    body={txid:'a'.repeat(64)};
  }
  return new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'}});
};

let clipboard='';
const context={
  window:null,
  document,
  localStorage,
  fetch,
  crypto:webcrypto,
  TextEncoder,
  TextDecoder,
  Uint8Array,
  Array,
  Map,
  Set,
  BigInt,
  Blob,
  URL,
  Response,
  Error,
  String,
  Number,
  Object,
  JSON,
  Date,
  Math,
  Promise,
  console,
  atob,
  btoa,
  navigator:{clipboard:{writeText:async value=>{clipboard=value}}},
  setTimeout,
  clearTimeout,
  setInterval:()=>0,
  clearInterval,
  confirm:()=>true
};
context.window=context;
vm.createContext(context);

const indexHtml=await readFile(new URL('../index.html',import.meta.url),'utf8');
assert.ok(indexHtml.includes('id="history-panel">'),'transaction history must be visible by default');
assert.ok(indexHtml.includes('aria-expanded="true"'),'history toggle must reflect the default-open state');
assert.ok(indexHtml.indexOf('id="history-panel"')<indexHtml.indexOf('id="addresslist"'),'transaction history must appear before the wallet address list');
assert.ok(indexHtml.includes('id="lastsendtxid"'),'send flow must expose a full transaction ID field');

for(const file of ['bip39-en.js','network-status.js','core.js','wallet-crypto.js','wallet.js','mining.js']){
  vm.runInContext(await readFile(new URL('../'+file,import.meta.url),'utf8'),context,{filename:file});
}
await new Promise(resolve=>setTimeout(resolve,25));

assert.equal(document.getElementById('netstatus').dataset.state,'online');
assert.equal(document.getElementById('netstatus').lastElementChild.textContent,'Network online');
vm.runInContext('FAENetworkStatus.offline()',context);
assert.equal(document.getElementById('netstatus').lastElementChild.textContent,'Network offline');
vm.runInContext('FAENetworkStatus.connecting()',context);
assert.equal(document.getElementById('netstatus').lastElementChild.textContent,'Connecting…');
vm.runInContext('FAENetworkStatus.online()',context);

await vm.runInContext('createNewWallet()',context);
const created=vm.runInContext('({count:walletAccount.addresses.length,address:wallet.address,protected:walletAccount.passphraseProtected})',context);
assert.equal(created.count,5);
assert.equal(created.protected,false);

// Use fresh test-only material. No reusable recovery phrase or passphrase is
// stored in the public repository.
document.getElementById('insertseed').value=await vm.runInContext(
  'FAEWalletCrypto.mnemonicFromEntropy(crypto.getRandomValues(new Uint8Array(32)))',
  context
);
document.getElementById('insertpassphrase').value=Array.from(
  crypto.getRandomValues(new Uint8Array(16)),
  byte=>byte.toString(16).padStart(2,'0')
).join('');
await vm.runInContext('insertWalletFromSeed()',context);
const inserted=vm.runInContext('({count:walletAccount.addresses.length,address:wallet.address,protected:walletAccount.passphraseProtected})',context);
assert.equal(inserted.count,5);
assert.equal(inserted.protected,true);
assert.notEqual(inserted.address,created.address);
assert.equal(document.getElementById('insertpassphrase').value,'');

await vm.runInContext('activateAccountAddress(3)',context);
assert.equal(vm.runInContext('wallet.index',context),3);
await vm.runInContext('copyReceiveAddress()',context);
assert.equal(clipboard,vm.runInContext('wallet.address',context));

const txHistory=document.getElementById('txhist');
assert.equal(txHistory.children.length,1);
assert.equal(txHistory.children[0].className,'transaction-row transaction-details');
const fullHistoryTxid=txHistory.children[0].children[1].children[1].textContent;
assert.equal(fullHistoryTxid,'b'.repeat(64));
await vm.runInContext("copyTransactionId('"+'b'.repeat(64)+"')",context);
assert.equal(clipboard,'b'.repeat(64));

document.getElementById('sendto').value=vm.runInContext('walletAccount.addresses[1].address',context);
document.getElementById('sendamt').value='1';
await vm.runInContext('sendFAE()',context);
assert.ok(submittedTransaction?.signature);
assert.equal(submittedTransaction.inputs[0],'smoke:0');
assert.equal(submittedTransaction.outputs.length,2);
assert.equal(document.getElementById('lastsendtx').hidden,false);
assert.equal(document.getElementById('lastsendtxid').value,'a'.repeat(64));
await vm.runInContext('copyLastSentTxid()',context);
assert.equal(clipboard,'a'.repeat(64));

const packageJson=await vm.runInContext('recoveryPackage().then(JSON.stringify)',context);
context.packageJson=packageJson;
const roundTrip=await vm.runInContext('accountFromRecovery(packageJson)',context);
assert.equal(roundTrip.account.addresses.length,5);
assert.deepEqual(
  roundTrip.account.addresses.map(item=>item.address),
  vm.runInContext('walletAccount.addresses.map(item=>item.address)',context)
);

document.getElementById('existingaddr').value=inserted.address;
await vm.runInContext('useExistingAddress()',context);
assert.equal(vm.runInContext('wallet.watchOnly',context),true);
assert.equal(document.getElementById('send').disabled,true);
await vm.runInContext('useSavedFullWallet()',context);
assert.equal(vm.runInContext('wallet.watchOnly',context),false);

console.log('FAE client create, insert, receive, send, TXID copy/history, recovery, and watch-only checks passed.');
