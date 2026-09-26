import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const fixture=JSON.parse(await readFile(new URL('./fixtures/wallet-transaction-ux.json',import.meta.url),'utf8'));
const context={window:null,Object,String,Number,Array,BigInt,Date,Error,RegExp,Boolean,Math};
context.window=context;
vm.createContext(context);
vm.runInContext(await readFile(new URL('../wallet-transaction-ux.js',import.meta.url),'utf8'),context,{filename:'wallet-transaction-ux.js'});
const UX=context.FAEWalletTransactionUX;

for(const item of fixture.cases){
  const result=UX.historyFromPayload({ok:true,transactions:[item.transaction]},fixture.active_address);
  assert.equal(result.state,UX.HISTORY_STATES.READY,item.id);
  const tx=result.transactions[0];
  assert.equal(tx.status,item.expected.state,item.id+' status');
  const perspective=UX.transactionPerspective(tx,fixture.active_address);
  assert.equal(perspective.direction,item.expected.direction,item.id+' direction');
  assert.equal(perspective.amount_atoms,item.expected.amount_atoms,item.id+' amount');
}

for(const item of fixture.invalid_payloads){
  const result=UX.historyFromPayload(item.payload,fixture.active_address);
  assert.equal(result.state,UX.HISTORY_STATES.INVALID,item.id);
}

const receipt=UX.acceptedReceipt({
  txid:fixture.cases[0].transaction.txid,
  address:fixture.active_address,
  submittedAt:'2026-09-23T10:00:01.000Z'
});
const noMatch=UX.historyFromPayload({ok:true,transactions:[fixture.cases[1].transaction]},fixture.active_address);
assert.equal(UX.observeReceipt(receipt,noMatch).state,UX.RECEIPT_STATES.ACCEPTED);

const pending=UX.historyFromPayload({ok:true,transactions:[fixture.cases[0].transaction]},fixture.active_address);
assert.equal(UX.observeReceipt(receipt,pending).state,UX.RECEIPT_STATES.PENDING);

const confirmedTx={...fixture.cases[0].transaction,status:'confirmed',confirmed_height:400};
const confirmedHistory=UX.historyFromPayload({ok:true,transactions:[confirmedTx]},fixture.active_address);
assert.equal(UX.observeReceipt(receipt,confirmedHistory).state,UX.RECEIPT_STATES.CONFIRMED);

console.log('FAE Wallet Transaction UX WTX-02 fixtures passed.');
