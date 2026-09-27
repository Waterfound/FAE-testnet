import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../wallet-transactions.js',import.meta.url),'utf8');
const contract=JSON.parse(await readFile(new URL('../docs/wallet-transaction-ux/contract.json',import.meta.url),'utf8'));

const context={Date,Number,String,BigInt,Object,Array,RegExp,Error,JSON};
context.globalThis=context;
vm.createContext(context);
vm.runInContext(source,context,{filename:'wallet-transactions.js'});

const api=context.FAEWalletTransactions;
assert.ok(api,'wallet transaction adapter must be exposed');

const expected=contract.adapter.exported_functions.slice().sort();
const actual=Object.keys(api).filter(name=>name!=='coverage').sort();
assert.deepEqual(actual,expected,'contract export names must match adapter');

assert.equal(api.coverage.kind,'recent_active_address_transfers');
assert.equal(api.coverage.active_address_only,true);
assert.equal(api.coverage.source_network_scan_limit,contract.coverage.source_network_scan_limit);
assert.equal(api.coverage.address_result_limit,contract.coverage.address_result_limit);
assert.equal(api.coverage.pagination,false);
assert.equal(api.coverage.mining_rewards_included,false);
assert.equal(api.coverage.lifetime_complete,false);

const txid='a'.repeat(64);
assert.equal(api.validTxid(txid),true);
assert.equal(api.validTxid('A'.repeat(64)),false);
assert.equal(api.validTxid('a'.repeat(63)),false);
assert.equal(api.validTxid(txid+' '),false);

assert.equal(api.parseTimestamp('2026-09-23T10:00:00Z').kind,'valid');
assert.equal(api.parseTimestamp(1_790_151_200).kind,'valid');
assert.equal(api.parseTimestamp(1_790_151_200_000).kind,'valid');
assert.equal(api.parseTimestamp('').kind,'missing');
assert.equal(api.parseTimestamp('not-a-date').kind,'invalid');

assert.equal(api.normalizeStatus('confirmed',42).kind,'confirmed');
assert.equal(api.normalizeStatus('confirmed',null).kind,'invalid');
assert.equal(api.normalizeStatus('pending',null).kind,'pending');
assert.equal(api.normalizeStatus('pending',42).kind,'invalid');
assert.equal(api.normalizeStatus('queued',null).kind,'unknown');
assert.equal(api.normalizeStatus('',null).kind,'invalid');

const active='faet-active';
const other='faet-other';
const base={
  txid,
  inputs:['prev:0'],
  status:'pending',
  confirmed_height:null,
  created_at:'2026-09-23T10:00:00Z',
  mempool_seq:1
};

const received=api.normalizeTransaction({
  ...base,
  from_address:other,
  outputs:[{address:active,amount_atoms:'5'}]
},active);
assert.equal(received.ok,true);
assert.equal(received.direction,'received');

const sent=api.normalizeTransaction({
  ...base,
  from_address:active,
  outputs:[
    {address:other,amount_atoms:'4'},
    {address:active,amount_atoms:'1'}
  ]
},active);
assert.equal(sent.ok,true);
assert.equal(sent.direction,'sent');
assert.equal(sent.has_change,true);

const self=api.normalizeTransaction({
  ...base,
  from_address:active,
  outputs:[{address:active,amount_atoms:'5'}]
},active);
assert.equal(self.ok,true);
assert.equal(self.direction,'self');

const unrelated=api.normalizeTransaction({
  ...base,
  from_address:other,
  outputs:[{address:other,amount_atoms:'5'}]
},active);
assert.equal(unrelated.ok,false);

const empty=api.normalizeHistoryPayload({transactions:[]},active);
assert.equal(empty.state,'empty_within_available_coverage');

const invalid=api.normalizeHistoryPayload({},active);
assert.equal(invalid.state,'invalid_payload');
assert.notEqual(invalid.state,empty.state);

const ready=api.normalizeHistoryPayload({transactions:[{
  ...base,
  from_address:other,
  outputs:[{address:active,amount_atoms:'5'}]
}]},active);
assert.equal(ready.state,'ready_recent');
assert.equal(ready.transactions.length,1);

const stale=api.historyFailure(ready,'network_unavailable');
assert.equal(stale.state,'stale');
assert.equal(stale.transactions.length,1);

const unavailable=api.historyFailure(null,'network_unavailable');
assert.equal(unavailable.state,'unavailable');

const receipt=api.acceptedReceipt({
  txid,
  address:active,
  network:'fairyelf-public-testnet-v4',
  acceptedAt:'2026-09-23T10:00:00Z'
});
assert.equal(receipt.version,1);
assert.equal(receipt.state,'accepted_unconfirmed');
assert.equal(receipt.txid,txid);
assert.equal(receipt.address,active);

assert.throws(()=>api.acceptedReceipt({
  txid:'bad',
  address:active,
  network:'fairyelf-public-testnet-v4',
  acceptedAt:'2026-09-23T10:00:00Z'
}));

console.log('WTX contract acceptance checks passed.');
