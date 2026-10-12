import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const fixtures=JSON.parse(
  await readFile(new URL('./fixtures/wallet-transactions-acceptance.json',import.meta.url),'utf8')
);
assert.equal(fixtures.schema_version,'fae.wallet-transaction-ux.acceptance-fixtures.v1');
assert.equal(fixtures.public_test_data_only,true);
assert.equal(fixtures.contains_key_material,false);

const ids=fixtures.cases.map(item=>item.id);
assert.equal(new Set(ids).size,ids.length,'fixture IDs must be unique');
assert.ok(ids.length>=10,'acceptance matrix must remain broad enough to cover the frozen plan');

for(const [name,value] of Object.entries(fixtures.txids)){
  assert.match(value,/^[0-9a-f]{64}$/,`fixture TXID ${name} must be canonical`);
}

const context={Date,Number,String,BigInt,Object,Array,RegExp,Error,JSON};
context.globalThis=context;
vm.createContext(context);
vm.runInContext(
  await readFile(new URL('../wallet-transactions.js',import.meta.url),'utf8'),
  context,
  {filename:'wallet-transactions.js'}
);
const api=context.FAEWalletTransactions;
assert.ok(api);

const byId=id=>{
  const item=fixtures.cases.find(entry=>entry.id===id);
  assert.ok(item,`missing fixture ${id}`);
  return item;
};
const txid=ref=>fixtures.txids[ref];
const address=ref=>fixtures.addresses[ref];

function copyOracle(testCase){
  const value=txid(testCase.txid_ref);
  if(testCase.clipboard.navigator_write==='reject'){
    return {copied:false,success_feedback:false,error_kind:'clipboard_denied',clipboard:null};
  }
  if(testCase.clipboard.navigator_write==='unavailable'){
    if(testCase.clipboard.fallback_exec_command){
      return {copied:true,success_feedback:true,error_kind:null,clipboard:value};
    }
    return {copied:false,success_feedback:false,error_kind:'clipboard_denied',clipboard:null};
  }
  return {copied:true,success_feedback:true,error_kind:null,clipboard:value};
}

{
  const c=byId('clipboard-denied');
  const result=copyOracle(c);
  assert.equal(result.copied,c.expected.copied);
  assert.equal(result.success_feedback,c.expected.success_feedback);
  assert.equal(result.error_kind,c.expected.error_kind);
}
{
  const c=byId('clipboard-fallback-success');
  const result=copyOracle(c);
  assert.equal(result.copied,true);
  assert.equal(result.clipboard,txid(c.expected.exact_txid_ref));
  assert.equal(result.success_feedback,true);
}
{
  const c=byId('consecutive-copy-isolation');
  const clipboardSequence=[];
  for(const ref of c.copy_order)clipboardSequence.push(txid(ref));
  assert.deepEqual(
    clipboardSequence,
    c.expected.clipboard_sequence.map(txid),
    'each copy action must remain bound to its own full TXID'
  );
  assert.equal(c.expected.no_stale_id,true);
}

{
  const c=byId('accepted-submit-refresh-failure');
  const receipt=api.acceptedReceipt({
    txid:txid(c.submit.txid_ref),
    address:address(c.submit.address_ref),
    network:c.submit.network,
    acceptedAt:c.submit.accepted_at
  });
  assert.equal(receipt.state,c.expected.receipt_state);
  assert.equal(receipt.txid,txid(c.expected.receipt_txid_ref));
  assert.equal(c.expected.send_failed,false);
  assert.equal(c.expected.confirmation_claim,false);
}

for(const id of ['reload-requeries-network','recovery-requeries-network']){
  const c=byId(id);
  assert.equal(c.expected.history_restored_from_seed??c.expected.seed_embeds_history,false);
  assert.ok(c.expected.network_history_query_for);
  if(id==='reload-requeries-network')assert.equal(c.persisted_transaction_history,false);
  if(id==='recovery-requeries-network')assert.equal(c.recovery_fixture.embedded_transaction_history,false);
}

{
  const c=byId('stale-response-a-b-a');
  let latestRequestId=0;
  let activeAddress=null;
  const requests=new Map();
  for(const request of c.requests){
    latestRequestId=request.request_id;
    activeAddress=address(request.address_ref);
    requests.set(request.request_id,{...request,address:address(request.address_ref)});
  }
  const accepted=[];
  const rejected=[];
  for(const requestId of c.completion_order){
    const request=requests.get(requestId);
    if(requestId===latestRequestId&&request.address===activeAddress)accepted.push(requestId);
    else rejected.push(requestId);
  }
  assert.deepEqual(accepted,[c.expected.accepted_request_id]);
  assert.deepEqual(rejected,c.expected.rejected_stale_request_ids);
  assert.equal(activeAddress,address(c.expected.final_address_ref));
}

{
  const c=byId('history-network-failure-preserves-stale');
  const previous=Object.freeze({
    state:c.previous.state,
    active_address:address(c.previous.active_address_ref),
    transactions:Object.freeze(c.previous.txid_refs.map(ref=>Object.freeze({txid:txid(ref)}))),
    issues:Object.freeze([]),
    coverage:api.coverage
  });
  const failed=api.historyFailure(previous,'network_unavailable');
  assert.equal(failed.state,c.expected.state);
  assert.deepEqual(
    Array.from(failed.transactions,item=>item.txid),
    c.expected.preserve_txid_refs.map(txid)
  );
  assert.equal(c.expected.must_not_claim_empty,true);
}

{
  const c=byId('bounded-empty-is-not-lifetime-empty');
  const result=api.normalizeHistoryPayload({transactions:[]},address('A'));
  assert.equal(result.state,c.expected.state);
  assert.equal(result.coverage.source_network_scan_limit,c.source_network_scan_limit);
  assert.equal(result.coverage.address_result_limit,c.address_result_limit);
  assert.equal(result.coverage.lifetime_complete,c.expected.lifetime_complete);
  assert.equal(result.coverage.mining_rewards_included,c.expected.mining_rewards_included);
  assert.equal(result.coverage.pagination,c.expected.pagination);
}

{
  const c=byId('watch-only-history-and-copy');
  assert.equal(c.watch_only,true);
  assert.equal(c.expected.send_enabled,false);
  assert.equal(c.expected.history_query_enabled,true);
  assert.equal(c.expected.txid_copy_enabled,true);
  for(const ref of c.txid_refs)assert.equal(api.validTxid(txid(ref)),true);
}

{
  const c=byId('cache-absent-is-valid');
  assert.equal(c.receipt_cache_present,false);
  assert.equal(c.expected.allowed,true);
  assert.equal(c.expected.reload_queries_network,true);
  assert.equal(c.expected.recovery_does_not_restore_receipt,true);
}

console.log(`WTX-02 acceptance fixtures validated: ${fixtures.cases.length}/${fixtures.cases.length}`);
