import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { parsePublicMetadata, serializePublicMetadata } from '../../wave-e/pq06/shadow-wallet.mjs';
import { verifyHybridTransaction, shadowTxid, stableStringify } from '../../wave-e/pq05/hybrid-transaction.mjs';

const input=process.argv[2]; if(!input)throw new Error('public state path required');
const state=JSON.parse(await readFile(input,'utf8'));
assert.equal(state.schema,'FAE_PQ10_PUBLIC_SHADOW_STATE_V1');
assert.equal(state.secret_material_persisted,false);assert.equal(state.rpc_used,false);assert.equal(state.active_state_mutated,false);

function reconstruct(){
  const mp={format:'FAE_PQ10_SHADOW_MEMPOOL_V1',order:[],transactions:{}};
  for(const e of state.entries){
    const meta=parsePublicMetadata(e.public_metadata);
    assert.equal(serializePublicMetadata(meta),JSON.stringify(Object.fromEntries(Object.keys(meta).sort().map(k=>[k,meta[k]]))));
    assert.equal(meta.mldsa_parameter_set,e.parameter_set);
    assert.equal(meta.legacy_public_key_spki,e.transaction.ed25519_public_key_spki);
    assert.equal(meta.mldsa_public_key,e.transaction.mldsa_public_key);
    const v=verifyHybridTransaction(e.transaction);assert.equal(v.ok,true,e.parameter_set+' restart verify');
    assert.equal(shadowTxid(e.transaction),e.txid);
    if(mp.transactions[e.txid])throw new Error('duplicate_txid');
    mp.transactions[e.txid]=structuredClone(e.transaction);mp.order.push(e.txid);
  }
  return mp;
}
const first=reconstruct(),second=reconstruct();
assert.equal(stableStringify(first),stableStringify(second),'restart reconstruction deterministic');
assert.deepEqual(first.order,state.mempool.order);
assert.equal(first.order.length,state.mempool.count);
assert.throws(()=>{if(first.transactions[state.entries[0].txid])throw new Error('duplicate_txid')},/duplicate_txid/);
for(const e of state.entries){const x=structuredClone(e.transaction);delete x.ed25519_signature;const before=stableStringify(first);assert.equal(verifyHybridTransaction(x).ok,false);assert.equal(stableStringify(first),before)}
const pq07Out=execFileSync(process.execPath,['lab/post-quantum-signatures/wave-f/pq07/test.mjs'],{cwd:process.cwd(),encoding:'utf8',env:process.env,maxBuffer:32*1024*1024});
const pq07=JSON.parse(pq07Out);assert.equal(pq07.result,'PASS');assert.equal(pq07.case_count,114);assert.deepEqual(pq07.failed_case_ids,[]);
console.log(JSON.stringify({schema:'FAE_PQ10_RESTART_PHASE_EVIDENCE_V1',result:'PASS',parameter_sets:state.parameter_sets,reconstructed_entries:first.order.length,
public_metadata_reverified:'PASS',transactions_reverified:'PASS',txids_reverified:'PASS',restart_reconstruction:'PASS',duplicate_rejection:'PASS',
stripped_rejection_before_mutation:'PASS',pq07_regression_replay:{result:'PASS',case_count:pq07.case_count,failed_case_ids:pq07.failed_case_ids},
private_material_emitted:false,rpc_used:false,active_state_mutated:false,activation_authorized:false},null,2));
