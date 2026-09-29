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

const vaultRecords=new Map();
let vaultActiveId=null;
let migrationState=null;
const FAEWalletVault={
  capabilityProbe:async()=>({ok:true,persistence:{supported:true,granted:true,persisted:true}}),
  listWallets:async()=>Array.from(vaultRecords.entries()).map(([walletId,account])=>({
    walletId,
    fingerprint:walletId.slice(7),
    network:'fairyelf-public-testnet-v4',
    source:account.source,
    passphraseProtected:Boolean(account.passphraseProtected),
    activeIndex:account.activeIndex,
    addresses:account.addresses.map(({index,address,pub})=>({index,address,pub})),
    createdAt:walletId
  })),
  readState:async()=>({activeWalletId:vaultActiveId,migration:migrationState}),
  loadAccount:async walletId=>{
    const account=vaultRecords.get(walletId);
    if(!account)throw Error('Wallet is not present in the local vault');
    return account;
  },
  loadActive:async()=>{
    if(!vaultActiveId)return{state:{activeWalletId:null},record:null,account:null};
    const account=vaultRecords.get(vaultActiveId);
    return{
      state:{activeWalletId:vaultActiveId},
      record:{walletId:vaultActiveId,network:'fairyelf-public-testnet-v4'},
      account
    };
  },
  admitAccount:async(account,{makeActive=true}={})=>{
    const walletId='wallet-'+account.addresses[0].address;
    const deduplicated=vaultRecords.has(walletId);
    if(!deduplicated)vaultRecords.set(walletId,account);
    if(makeActive||!vaultActiveId)vaultActiveId=walletId;
    return{walletId,deduplicated,account:vaultRecords.get(walletId)};
  },
  setActiveWallet:async walletId=>{
    if(!vaultRecords.has(walletId))throw Error('Wallet is not present in the local vault');
    vaultActiveId=walletId;
    return walletId;
  },
  setActiveAddress:async(walletId,index)=>{
    const account=vaultRecords.get(walletId);
    if(!account)throw Error('Wallet is not present in the local vault');
    account.activeIndex=index;
    return account;
  },
  removeWallet:async walletId=>{
    const removed=vaultRecords.delete(walletId);
    if(vaultActiveId===walletId)vaultActiveId=vaultRecords.keys().next().value||null;
    return{removed,activeWalletId:vaultActiveId};
  },
  markMigration:async migration=>(migrationState=migration)
};

let submittedTransaction=null;
let failNextStatus=false;
const fetch=async(url,options={})=>{
  const requestUrl=new URL(String(url));
  const path=requestUrl.pathname.split('fae-public-testnet-v4')[1]||'';
  let body={};
  if(path.startsWith('/status')){
    if(failNextStatus){
      failNextStatus=false;
      return new Response(JSON.stringify({error:'refresh_unavailable'}),{status:503,headers:{'content-type':'application/json'}});
    }
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
    failNextStatus=true;
    body={txid:'a'.repeat(64)};
  }
  return new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'}});
};

let clipboard='';
const context={
  window:null,
  document,
  localStorage,
  FAEWalletVault,
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
assert.ok(indexHtml.includes('src="/wallet-transactions.js"'),'wallet transaction contract adapter must load before the client');
assert.ok(indexHtml.includes('id="sendstate" class="status" role="status" aria-live="polite"'),'send receipt feedback must be announced accessibly');

for(const file of ['bip39-en.js','network-status.js','wallet-transactions.js','core.js','wallet-crypto.js','wallet.js','mining.js']){
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

await vm.runInContext('beginNewWallet()',context);
assert.equal(vaultRecords.size,0,'New Wallet must not persist before backup confirmation');
assert.equal(vm.runInContext('walletAccount',context),null);
const pendingPhrase=vm.runInContext('pendingNewWallet.mnemonic',context);
assert.equal(pendingPhrase.trim().split(/\s+/).length,24);
vm.runInContext('readyForNewWalletConfirmation()',context);

const wrongPhrase=await vm.runInContext(
  'FAEWalletCrypto.mnemonicFromEntropy(crypto.getRandomValues(new Uint8Array(32)))',
  context
);
document.getElementById('confirmseed').value=wrongPhrase;
await assert.rejects(vm.runInContext('confirmNewWallet()',context),/do not exactly match/);
assert.equal(vaultRecords.size,0,'wrong backup confirmation must fail closed');

document.getElementById('confirmseed').value=pendingPhrase;
await vm.runInContext('confirmNewWallet()',context);
const created=vm.runInContext('({count:walletAccount.addresses.length,address:wallet.address,protected:walletAccount.passphraseProtected})',context);
assert.equal(created.count,5);
assert.equal(created.protected,false);
assert.equal(vaultRecords.size,1);

// Recover a second independent Wallet with an optional passphrase.
document.getElementById('recoveryseed').value=await vm.runInContext(
  'FAEWalletCrypto.mnemonicFromEntropy(crypto.getRandomValues(new Uint8Array(32)))',
  context
);
document.getElementById('recoverypassphrase').value=Array.from(
  crypto.getRandomValues(new Uint8Array(16)),
  byte=>byte.toString(16).padStart(2,'0')
).join('');
await vm.runInContext('verifyRecoveryWallet()',context);
assert.equal(document.getElementById('recoverypassphrase').value,'');
const recoveryPreview=document.getElementById('recoverypreview').value;
assert.match(recoveryPreview,/^faet1/);
await vm.runInContext('admitRecoveryWallet()',context);
const inserted=vm.runInContext('({count:walletAccount.addresses.length,address:wallet.address,protected:walletAccount.passphraseProtected})',context);
assert.equal(inserted.count,5);
assert.equal(inserted.protected,true);
assert.notEqual(inserted.address,created.address);
assert.equal(vaultRecords.size,2,'New and recovered Wallets must coexist');

await vm.runInContext('activateAccountAddress(3)',context);
assert.equal(vm.runInContext('wallet.index',context),3);
await vm.runInContext('copyReceiveAddress()',context);
assert.equal(clipboard,vm.runInContext('wallet.address',context));

const txHistory=document.getElementById('txhist');
assert.equal(txHistory.children.length,1);
assert.equal(txHistory.children[0].className,'transaction-row transaction-details');
const detailBody=txHistory.children[0].children[1];
const detailField=key=>detailBody.children.find(child=>child.dataset.detailKey===key);
const txidField=detailField('txid');
assert.ok(txidField,'transaction details must expose a TXID field');
assert.equal(txidField.children[1].value,'b'.repeat(64));
assert.equal(txidField.children[1].readOnly,true);
assert.equal(detailField('direction').children[1].textContent,'Self transfer');
assert.equal(detailField('status').children[1].textContent,'Pending');
assert.equal(detailField('from').children[1].textContent,vm.runInContext('wallet.address',context));
assert.ok(detailField('outputs').children[1].textContent.includes('1 FAE'));
const historyCopyButton=txidField.children[2];
const historyCopyFeedback=txidField.children[3];
await historyCopyButton.listeners.click[0]();
assert.equal(clipboard,'b'.repeat(64));
assert.equal(historyCopyButton.textContent,'Copied');
assert.equal(historyCopyFeedback.textContent,'Full transaction ID copied.');

document.getElementById('sendto').value=vm.runInContext('walletAccount.addresses[1].address',context);
document.getElementById('sendamt').value='1';
await vm.runInContext('sendFAE()',context);
assert.ok(submittedTransaction?.signature);
assert.equal(submittedTransaction.inputs[0],'smoke:0');
assert.equal(submittedTransaction.outputs.length,2);
assert.equal(document.getElementById('lastsendtx').hidden,false);
assert.equal(document.getElementById('lastsendtxid').value,'a'.repeat(64));
assert.match(document.getElementById('sendstate').textContent,/accepted/i);
assert.match(document.getElementById('sendstate').textContent,/unconfirmed/i);
assert.match(document.getElementById('sendstate').textContent,/refresh is unavailable/i);
await vm.runInContext('copyLastSentTxid()',context);
assert.equal(clipboard,'a'.repeat(64));
assert.match(document.getElementById('sendstate').textContent,/remains unconfirmed/i);

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

console.log('FAE client staged create, multi-wallet recovery, receive, TXID/history, signing, backup, and watch-only checks passed.');
