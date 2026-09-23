import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const context={window:null,Object,String,Number,Array,BigInt,Date,Error,RegExp,Boolean,Math};
context.window=context;
vm.createContext(context);
vm.runInContext(await readFile(new URL('../wallet-transaction-ux.js',import.meta.url),'utf8'),context,{filename:'wallet-transaction-ux.js'});
const UX=context.FAEWalletTransactionUX;

const address='faet1testaddressfixture';
const txid='a'.repeat(64);
const txid2='B'.repeat(64);
const baseTx={
  txid,
  from_address:address,
  inputs:['fixture:0'],
  outputs:[{address:'faet1destinationfixture',amount_atoms:'100000000'}],
  status:'pending',
  confirmed_height:null,
  created_at:'2026-09-23T10:00:00.000Z',
  mempool_seq:7
};

assert.equal(UX.validTxid(txid),true);
assert.equal(UX.validTxid(txid2),true);
assert.equal(UX.validTxid('a'.repeat(63)),false);
assert.equal(UX.validTxid('g'.repeat(64)),false);

assert.equal(UX.HISTORY_COVERAGE.network_scan_limit,100);
assert.equal(UX.HISTORY_COVERAGE.address_result_limit,30);
assert.equal(UX.HISTORY_COVERAGE.complete,false);
assert.equal(UX.HISTORY_COVERAGE.includes_mining_rewards,false);
assert.equal(UX.HISTORY_COVERAGE.cache_authoritative,false);

assert.equal(UX.finiteTimestampMs('2026-09-23T10:00:00.000Z'),Date.parse('2026-09-23T10:00:00.000Z'));
assert.equal(UX.finiteTimestampMs('1758621600'),1758621600000);
assert.equal(UX.finiteTimestampMs(1758621600000),1758621600000);
assert.equal(UX.finiteTimestampMs('not-a-date'),null);

const ready=UX.historyFromPayload({ok:true,transactions:[baseTx]},address,{fetchedAt:1000});
assert.equal(ready.state,UX.HISTORY_STATES.READY);
assert.equal(ready.transactions.length,1);
assert.equal(ready.transactions[0].status,UX.TX_STATES.PENDING);
assert.equal(ready.transactions[0].timestamp_ms,Date.parse(baseTx.created_at));

const unknown=UX.historyFromPayload({ok:true,transactions:[{...baseTx,txid:txid2,status:'mystery'}]},address);
assert.equal(unknown.state,UX.HISTORY_STATES.READY);
assert.equal(unknown.transactions[0].status,UX.TX_STATES.UNKNOWN);
assert.equal(UX.statusLabel(unknown.transactions[0].status),'Status unavailable');

const empty=UX.historyFromPayload({ok:true,transactions:[]},address);
assert.equal(empty.state,UX.HISTORY_STATES.EMPTY);
const missing=UX.historyFromPayload({ok:true},address);
assert.equal(missing.state,UX.HISTORY_STATES.INVALID);
const malformed=UX.historyFromPayload({ok:true,transactions:[{...baseTx,txid:'bad'}]},address);
assert.equal(malformed.state,UX.HISTORY_STATES.INVALID);
const malformedConfirmed=UX.historyFromPayload({ok:true,transactions:[{...baseTx,status:'confirmed',confirmed_height:null}]},address);
assert.equal(malformedConfirmed.state,UX.HISTORY_STATES.INVALID);

const unavailable=UX.historyUnavailable(address,new Error('offline'));
assert.equal(unavailable.state,UX.HISTORY_STATES.UNAVAILABLE);
const stale=UX.historyUnavailable(address,new Error('offline'),ready);
assert.equal(stale.state,UX.HISTORY_STATES.STALE);
assert.equal(stale.transactions.length,1);
assert.equal(stale.error,'offline');

const receipt=UX.acceptedReceipt({txid,address,submittedAt:'2026-09-23T10:01:00.000Z'});
assert.equal(receipt.state,UX.RECEIPT_STATES.ACCEPTED);
assert.equal(UX.statusLabel(receipt.state),'Accepted · awaiting network observation');

const absent=UX.observeReceipt(receipt,empty,{observedAt:'2026-09-23T10:02:00.000Z'});
assert.equal(absent.state,UX.RECEIPT_STATES.ACCEPTED);
assert.equal(absent.observation,'not_observed_within_bounded_history');

const afterOutage=UX.observeReceipt(receipt,unavailable,{observedAt:'2026-09-23T10:03:00.000Z'});
assert.equal(afterOutage.state,UX.RECEIPT_STATES.ACCEPTED);
assert.equal(afterOutage.observation,'history_unavailable');

const pending=UX.observeReceipt(receipt,ready,{observedAt:'2026-09-23T10:04:00.000Z'});
assert.equal(pending.state,UX.RECEIPT_STATES.PENDING);

const confirmedHistory=UX.historyFromPayload({ok:true,transactions:[{...baseTx,status:'confirmed',confirmed_height:321}]},address);
const confirmed=UX.observeReceipt(pending,confirmedHistory,{observedAt:'2026-09-23T10:05:00.000Z'});
assert.equal(confirmed.state,UX.RECEIPT_STATES.CONFIRMED);
assert.equal(confirmed.confirmed_height,321);

const confirmedAfterOutage=UX.observeReceipt(confirmed,unavailable,{observedAt:'2026-09-23T10:06:00.000Z'});
assert.equal(confirmedAfterOutage.state,UX.RECEIPT_STATES.CONFIRMED);
assert.equal(confirmedAfterOutage.confirmed_height,321);

const publicRecord=UX.receiptPublicRecord(confirmed);
assert.deepEqual(Object.keys(publicRecord).sort(),['active_address','format','network','submitted_at_ms','txid']);
assert.equal('state' in publicRecord,false);
assert.equal('confirmed_height' in publicRecord,false);
const restored=UX.receiptFromPublicRecord(publicRecord);
assert.equal(restored.state,UX.RECEIPT_STATES.ACCEPTED);
assert.equal(restored.confirmed_height,null);

assert.throws(()=>UX.acceptedReceipt({txid:'bad',address}),/Invalid FAE transaction ID/);
assert.throws(()=>UX.receiptFromPublicRecord({...publicRecord,network:'other'}),/Unsupported transaction receipt/);

console.log('FAE Wallet Transaction UX WTX-01 contract checks passed.');
