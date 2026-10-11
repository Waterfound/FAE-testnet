import test from 'node:test';
import assert from 'node:assert/strict';
import {createWalletPublicLedgerObserver} from './wallet-public-ledger-observer.mjs';
import {ExplorerDataError} from './explorer-read-adapter.mjs';

const TIP={network:'fairyelf-public-testnet-v4',height:18,hash:'a'.repeat(64)};
const addr=n=>'faet1'+String(n).repeat(30);
const wallet=n=>({walletId:'public-fingerprint-'+n,address:addr(n)});
const node=(balance='0')=>({
  status:async()=>({tip:TIP}),
  address:async({address,expectedTip})=>({tip:expectedTip,balanceAtoms:balance,address})
});
function deferred(){
  let resolve,reject;
  const promise=new Promise((res,rej)=>{resolve=res;reject=rej;});
  return {promise,resolve,reject};
}
test('no-wallet is not a fabricated zero-balance Wallet',async()=>{
  const o=createWalletPublicLedgerObserver({adapter:node()});
  assert.deepEqual(o.getSnapshot(),{state:'no_wallet',walletId:null,address:null,balanceAtoms:null,tip:null,code:null});
  assert.equal((await o.refresh()).state,'no_wallet');
  assert.equal(o.selectWallet(wallet('a')).state,'unknown');
  assert.equal(o.getSnapshot().balanceAtoms,null);
  assert.equal(o.clear().state,'no_wallet');
});
test('three persistent public Wallet identities switch coherent balances and addresses',async()=>{
  const balances=new Map([[addr('a'),'0'],[addr('b'),'99999999999999999999999'],[addr('c'),'1250000000']]);
  const a={status:async()=>({tip:TIP}),address:async({address,expectedTip})=>({tip:expectedTip,balanceAtoms:balances.get(address)})};
  const o=createWalletPublicLedgerObserver({adapter:a});
  for(const id of ['a','b','c','a']){
    o.selectWallet(wallet(id));
    const s=await o.refresh();
    assert.equal(s.state,'observed');
    assert.equal(s.walletId,'public-fingerprint-'+id);
    assert.equal(s.address,addr(id));
    assert.equal(s.balanceAtoms,balances.get(addr(id)));
    assert.deepEqual(s.tip,TIP);
    assert.equal(Object.isFrozen(s),true);
  }
});
test('late old-wallet status cannot overwrite newly selected identity',async()=>{
  const older=deferred();
  const o=createWalletPublicLedgerObserver({adapter:{status:()=>older.promise,address:async()=>{throw Error('never read stale Wallet')}}});
  o.selectWallet(wallet('a'));
  const a=o.refresh();
  o.selectWallet(wallet('b'));
  older.resolve({tip:TIP});
  assert.equal((await a).state,'stale_discarded');
  assert.equal(o.getSnapshot().walletId,'public-fingerprint-b');
  assert.equal(o.getSnapshot().balanceAtoms,null);
});
test('late address reply cannot contaminate a second Wallet after switch',async()=>{
  const older=deferred(),seen=[];
  const a={status:async()=>({tip:TIP}),address:async({address,expectedTip})=>{
    seen.push(address);
    return address===addr('a')?older.promise:{tip:expectedTip,balanceAtoms:'44'};
  }};
  const o=createWalletPublicLedgerObserver({adapter:a});
  o.selectWallet(wallet('a'));
  const p=o.refresh();
  await Promise.resolve();await Promise.resolve();
  o.selectWallet(wallet('b'));
  const newer=await o.refresh();
  assert.equal(newer.balanceAtoms,'44');
  older.resolve({tip:TIP,balanceAtoms:'100000000'});
  assert.equal((await p).state,'stale_discarded');
  assert.equal(o.getSnapshot().walletId,'public-fingerprint-b');
  assert.equal(o.getSnapshot().balanceAtoms,'44');
  assert.ok(seen.includes(addr('b')));
});
test('out-of-order response for same Wallet does not replace a newer observation',async()=>{
  const old=deferred();let call=0;
  const a={status:async()=>({tip:TIP}),address:async()=>++call===1?old.promise:{tip:TIP,balanceAtoms:'20'}};
  const o=createWalletPublicLedgerObserver({adapter:a});
  o.selectWallet(wallet('a'));
  const first=o.refresh();
  await Promise.resolve();await Promise.resolve();
  const second=await o.refresh();
  assert.equal(second.balanceAtoms,'20');
  old.resolve({tip:TIP,balanceAtoms:'19'});
  assert.equal((await first).state,'stale_discarded');
  assert.equal(o.getSnapshot().balanceAtoms,'20');
});
test('locked-vault semantics hide selected address and block public observations',async()=>{
  let reads=0;
  const a={status:async()=>{reads++;return{tip:TIP}},address:async()=>{reads++;return{tip:TIP,balanceAtoms:'11'}}};
  const o=createWalletPublicLedgerObserver({adapter:a});
  o.selectWallet(wallet('a'));
  const locked=o.setVaultLocked(true);
  assert.equal(locked.state,'locked');
  assert.equal(locked.address,null);
  assert.equal((await o.refresh()).state,'locked');
  assert.equal(reads,0);
  assert.throws(()=>o.selectWallet(wallet('b')),{code:'INVALID_QUERY'});
  assert.equal(o.setVaultLocked(false).state,'unknown');
  assert.equal(o.getSnapshot().balanceAtoms,null);
  assert.equal((await o.refresh()).balanceAtoms,'11');
});
test('a lock while fetching discards a late public observation',async()=>{
  const wait=deferred(),o=createWalletPublicLedgerObserver({adapter:{status:()=>wait.promise,address:async()=>{throw Error('read after lock')}}});
  o.selectWallet(wallet('a'));
  const pending=o.refresh();
  o.setVaultLocked(true);
  wait.resolve({tip:TIP});
  assert.equal((await pending).state,'stale_discarded');
  assert.equal(o.getSnapshot().state,'locked');
  assert.equal(o.getSnapshot().address,null);
});
test('tip drift, wrong network, HTTP outage and malformed amount do not become zero balance',async()=>{
  const cases=[
    [()=>({tip:{...TIP,hash:'b'.repeat(64)},balanceAtoms:'7'}),'TIP_CHANGED'],
    [()=>{throw new ExplorerDataError('NETWORK_MISMATCH','wrong network')},'NETWORK_MISMATCH'],
    [()=>{throw Error('offline')},'NETWORK_UNAVAILABLE'],
    [()=>({tip:TIP,balanceAtoms:7}),'INVALID_RESPONSE'],
    [()=>({tip:TIP,balanceAtoms:'1.3'}),'INVALID_RESPONSE']
  ];
  for(const [fn,code] of cases){
    const a={status:async()=>({tip:TIP}),address:async()=>fn()};
    const o=createWalletPublicLedgerObserver({adapter:a});
    o.selectWallet(wallet('a'));
    const state=await o.refresh();
    assert.equal(state.state,'unavailable');
    assert.equal(state.balanceAtoms,null);
    assert.equal(state.code,code);
  }
});
test('no private Wallet material or accidental full-vault object accepted',()=>{
  const o=createWalletPublicLedgerObserver({adapter:node()});
  assert.throws(()=>o.selectWallet({...wallet('a'),seed:'never allowed'}),{code:'INVALID_QUERY'});
  assert.throws(()=>o.selectWallet({...wallet('a'),passphrase:'secret'}),{code:'INVALID_QUERY'});
  assert.throws(()=>o.selectWallet({walletId:'a'}),{code:'INVALID_QUERY'});
  assert.throws(()=>o.selectWallet({walletId:'a',address:'https://example.org'}),{code:'INVALID_QUERY'});
  assert.equal(o.getSnapshot().state,'no_wallet');
});
test('selected Wallet with known zero balance remains observed, not uninstalled',async()=>{
  const o=createWalletPublicLedgerObserver({adapter:node('0')});
  o.selectWallet(wallet('a'));
  const state=await o.refresh();
  assert.equal(state.state,'observed');
  assert.equal(state.balanceAtoms,'0');
  assert.notEqual(state.state,'no_wallet');
  assert.equal(state.walletId,'public-fingerprint-a');
});
