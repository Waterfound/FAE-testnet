import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

await import('../wallet-signing-intent.js');
const guard=globalThis.FAEWalletSigningIntent;
assert.ok(guard);

const base={
  network:'fae-public-testnet-v4',
  sourceAddress:'faet1source',
  destination:'faet1destination',
  amountAtoms:'100000000'
};
const intent=guard.create(base);
assert.equal(Object.isFrozen(intent),true);
assert.equal(guard.assertCurrent(intent,base),true);
assert.throws(()=>guard.assertCurrent(intent,{...base,destination:'faet1mutated'}),/reviewed destination changed/);
assert.throws(()=>guard.assertCurrent(intent,{...base,amountAtoms:'200000000'}),/reviewed amountAtoms changed/);
assert.throws(()=>guard.assertCurrent(intent,{...base,network:'other-network'}),/reviewed network changed/);
assert.throws(()=>guard.assertCurrent(intent,{...base,sourceAddress:'faet1other'}),/reviewed sourceAddress changed/);

const transaction={
  version:2,
  network:base.network,
  inputs:[{outpoint:'fixture:0'}],
  outputs:[
    {address:base.destination,amount_atoms:base.amountAtoms},
    {address:base.sourceAddress,amount_atoms:'50000000'}
  ],
  public_key_spki:'fixture',
  signature:''
};
assert.equal(guard.assertTransaction(intent,transaction),true);
assert.throws(()=>guard.assertTransaction(intent,{...transaction,network:'other-network'}),/network/);
assert.throws(()=>guard.assertTransaction(intent,{...transaction,outputs:[{address:'faet1mutated',amount_atoms:base.amountAtoms}]}),/spend output/);
assert.throws(()=>guard.assertTransaction(intent,{...transaction,outputs:[...transaction.outputs,{address:'faet1thirdparty',amount_atoms:'1'}]}),/unreviewed non-change output/);

const wallet=await readFile(new URL('../wallet.js',import.meta.url),'utf8');
assert.ok(wallet.includes('FAEWalletSigningIntent.create'));
assert.ok((wallet.match(/FAEWalletSigningIntent\.assertCurrent/g)||[]).length>=2,'intent must be rechecked across asynchronous signing');
assert.ok((wallet.match(/FAEWalletSigningIntent\.assertTransaction/g)||[]).length>=2,'transaction must be rechecked across asynchronous signing');
assert.ok(wallet.includes('stable(txPayload(transaction))!==signingPayload'),'signed payload must be rechecked immediately before signature release');

console.log('Wallet reviewed-intent to signed-payload integrity checks passed.');
