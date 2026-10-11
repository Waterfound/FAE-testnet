import test from 'node:test';
import assert from 'node:assert/strict';
import {createVaultBoundPublicObserver} from './wallet-vault-public-bridge.mjs';

const TIP={network:'fairyelf-public-testnet-v4',height:23,hash:'b'.repeat(64)};
const walletId=c=>'wallet-'+c.repeat(64);
const address=c=>'faet1'+c.repeat(30);
const record=(c)=>({walletId:walletId(c),network:TIP.network,activeIndex:0,
  addresses:[{address:address(c),index:0,pub:'public-material-'+c}],passphraseProtected:c!=='a',
  fingerprint:c.repeat(64)});
const makeVault=(wallets,active=wallets[0]?.walletId||null)=>{
  const state={activeWalletId:active};
  const flags={secretsTouched:0};
  return {state,wallets,flags,
    readState:async()=>({...state}),
    listWallets:async()=>wallets.map(w=>({...w,addresses:w.addresses.map(a=>({...a}))})),
    loadAccount:async()=>{flags.secretsTouched++;throw Error('secret decryption MUST NOT run')},
    loadActive:async()=>{flags.secretsTouched++;throw Error('private account MUST NOT run')},
    setActiveWallet:async()=>{flags.secretsTouched++;throw Error('bridge MUST NOT switch vault')}
  };
};
const readAdapter=(amounts={})=>({status:async()=>({tip:TIP}),
  address:async({address,expectedTip})=>({tip:expectedTip,address,balanceAtoms:amounts[address]||'0'})});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve}};
test('empty vault is no-wallet, never an observed zero',async()=>{
  const vault=makeVault([]);
  const b=createVaultBoundPublicObserver({vault,adapter:readAdapter()});
  assert.equal((await b.refresh()).state,'no_wallet');
  assert.equal(b.getSnapshot().balanceAtoms,null);
  assert.equal(vault.flags.secretsTouched,0);
});
test('follows three real-form public vault records without decryption or mutation',async()=>{
  const items=['a','b','c'].map(record);
  const vault=makeVault(items);
  const amounts=Object.fromEntries(items.map((w,i)=>[w.addresses[0].address,['0','190000000','90000000000000000'][i]]));
  const b=createVaultBoundPublicObserver({vault,adapter:readAdapter(amounts)});
  for(const r of items){
    vault.state.activeWalletId=r.walletId;
    const s=await b.refresh();
    assert.equal(s.state,'observed');
    assert.equal(s.walletId,r.walletId);
    assert.equal(s.address,r.addresses[0].address);
    assert.equal(s.balanceAtoms,amounts[r.addresses[0].address]);
    assert.deepEqual(s.tip,TIP);
  }
  assert.equal(vault.flags.secretsTouched,0);
  assert.equal(b.getSnapshot().walletId,items[2].walletId);
});
test('external selected Wallet switch while node request is pending discards old balance',async()=>{
  const wallets=['a','b'].map(record),vault=makeVault(wallets);
  const wait=deferred();let first=true;
  const a={status:async()=>({tip:TIP}),address:async({address,expectedTip})=>{
    if(first){first=false;return wait.promise}
    return {tip:expectedTip,address,balanceAtoms:'22'};
  }};
  const b=createVaultBoundPublicObserver({vault,adapter:a});
  const early=b.refresh();
  // Ensure the first HTTP-facing public address call has begun.
  for(let i=0;first&&i<30;i++)await Promise.resolve();
  assert.equal(first,false);
  vault.state.activeWalletId=wallets[1].walletId;
  wait.resolve({tip:TIP,balanceAtoms:'9999999'});
  const dropped=await early;
  assert.equal(dropped.state,'vault_unavailable');
  assert.equal(dropped.code,'VAULT_CHANGED');
  assert.equal(dropped.balanceAtoms,null);
  assert.equal(b.getSnapshot().balanceAtoms,null);
  const second=await b.refresh();
  assert.equal(second.walletId,wallets[1].walletId);
  assert.equal(second.balanceAtoms,'22');
  assert.equal(vault.flags.secretsTouched,0);
});
test('external active address change invalidates previous address and balance',async()=>{
  const one=record('a');one.addresses.push({address:address('d'),index:1,pub:'second-pub'});
  const vault=makeVault([one]);
  const b=createVaultBoundPublicObserver({vault,adapter:readAdapter({[address('a')]:'6',[address('d')]:'12'})});
  assert.equal((await b.refresh()).balanceAtoms,'6');
  one.activeIndex=1;
  const now=await b.refresh();
  assert.equal(now.address,address('d'));
  assert.equal(now.balanceAtoms,'12');
  assert.equal(b.getSnapshot().address,address('d'));
});
test('malformed, absent, wrong-network and ambiguous active vault state fails closed',async()=>{
  const a=record('a');
  const cases=[
    makeVault([a],null),
    makeVault([a],'wallet-'+'f'.repeat(64)),
    makeVault([{...a,network:'wrong-network'}]),
    makeVault([{...a,activeIndex:3}]),
    makeVault([{...a,addresses:[{address:'bad',index:0}]}]),
    makeVault([a,a])
  ];
  for(const vault of cases){
    const b=createVaultBoundPublicObserver({vault,adapter:readAdapter()});
    const state=await b.refresh();
    assert.equal(state.state,'vault_unavailable');
    assert.equal(state.code,'INVALID_VAULT_METADATA');
    assert.equal(state.balanceAtoms,null);
    assert.equal(b.getSnapshot().state,'vault_unavailable');
    assert.equal(vault.flags.secretsTouched,0);
  }
});
test('storage failure and invalidate cannot be silently downgraded to no-wallet',async()=>{
  const vault=makeVault([record('a')]);
  const b=createVaultBoundPublicObserver({vault,adapter:readAdapter({[address('a')]:'20'})});
  assert.equal((await b.refresh()).balanceAtoms,'20');
  vault.readState=async()=>{throw Error('IndexedDB blocked or damaged')};
  const r=await b.refresh();
  assert.equal(r.state,'vault_unavailable');
  assert.equal(r.code,'VAULT_UNAVAILABLE');
  assert.equal(b.getSnapshot().state,'vault_unavailable');
  assert.equal(b.invalidate().state,'no_wallet');
  assert.equal(b.getSnapshot().balanceAtoms,null);
});
test('concurrent refreshes never overwrite later one with old public response',async()=>{
  const vault=makeVault([record('a')]);
  const hold=deferred();let calls=0;
  const adapter={status:async()=>({tip:TIP}),address:async({expectedTip})=>{
    if(++calls===1)return hold.promise;
    return {tip:expectedTip,balanceAtoms:'5'};
  }};
  const b=createVaultBoundPublicObserver({vault,adapter});
  const older=b.refresh();
  for(let i=0;calls<1&&i<30;i++)await Promise.resolve();
  assert.equal(calls,1);
  const newer=await b.refresh();
  assert.equal(newer.balanceAtoms,'5');
  hold.resolve({tip:TIP,balanceAtoms:'99'});
  const dropped=await older;
  assert.equal(dropped.state,'stale_discarded');
  assert.equal(b.getSnapshot().balanceAtoms,'5');
});
test('public bridge rejects a private-only or incomplete vault port',()=>{
  assert.throws(()=>createVaultBoundPublicObserver({vault:{loadActive:async()=>({})},adapter:readAdapter()}),
    {code:'INVALID_VAULT_METADATA'});
});
