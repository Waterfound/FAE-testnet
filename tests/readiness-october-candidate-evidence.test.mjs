import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const path=new URL('../docs/FAE_MAINNET_READINESS_STATE.json',import.meta.url);
const snapshot=JSON.parse(readFileSync(path,'utf8'));
const wave=snapshot.candidate_evidence_snapshot_october_11;

test('canonical 24 gates, authority and historical snapshot are preserved',()=>{
 assert.equal(snapshot.schema,'FAE_MAINNET_READINESS_STATE_V1');
 assert.equal(snapshot.gates.length,24);
 assert.equal(snapshot.last_reconciled_at,'2026-10-06');
 assert.equal(wave.canonical_registry_last_reconciled_at,'2026-10-06');
 assert.equal(snapshot.authority_snapshot.consensus_change_authorized,false);
 assert.equal(snapshot.authority_snapshot.mainnet_launch_authorized,false);
 assert.equal(snapshot.authority_snapshot.mainnet_ready_claimed,false);
 assert.equal(wave.mainnet_launch_authorized,false);
 assert.equal(wave.production_publication_authorized,false);
 assert.equal(wave.candidate_merge_completed,false);
 assert.equal(wave.iPad_physical_evidence_closed,false);
 assert.deepEqual(new Set(snapshot.gates.map(g=>g.gate_id)).size,24);
});
test('all seven sourced entries are exact PR and commit references with no canonical promotion',()=>{
 assert.equal(wave.evidence.length,7);
 assert.deepEqual(wave.evidence.map(g=>g.pr),[294,298,299,300,301,302,303]);
 for(const c of wave.evidence){
   assert.match(c.commit,/^[0-9a-f]{40}$/);
   assert.ok(c.element_ids.length>0);
   assert.ok(c.claim.length>40);
   assert.ok(c.remaining.length>10);
   assert.ok(['DONE_TECHNICAL_CANDIDATE','CANDIDATE_EVIDENCE_IN_PROGRESS'].includes(c.status));
   assert.notEqual(c.status,'DONE_CANONICAL');
 }
 assert.equal(wave.evidence.at(-1).status,'CANDIDATE_EVIDENCE_IN_PROGRESS');
});
test('final production decisions and physical evidence are still explicitly held',()=>{
 const g=Object.fromEntries(snapshot.gates.map(x=>[x.gate_id,x]));
 assert.equal(g.final_production_freeze.state,'UNRESOLVED');
 assert.equal(g.mainnet_authorization.state,'BLOCKED');
 assert.equal(g.representative_device_evidence.state,'EXTERNAL_EVIDENCE');
 assert.equal(g.mining_tip_stale_work_recovery.state,'HUMAN_GATE');
 for(const field of ['production_genesis','final_fee_and_security_budget','final_block_time_maturity_DAA'])
   assert.equal(wave.remaining_gates[field],'UNRESOLVED');
 assert.equal(wave.remaining_gates.physical_iPad,'EXTERNAL_EVIDENCE');
});
test('future monetary design is authority only for monetary schedule, not testnet',()=>{
 assert.equal(snapshot.authority_snapshot.current_live_public_testnet.initial_subsidy_fae,10);
 assert.equal(snapshot.authority_snapshot.current_live_public_testnet.halving_era_blocks,600000);
 const t=snapshot.authority_snapshot.authoritative_future_tokenomics_design;
 assert.equal(t.initial_subsidy_fae.value,9);
 assert.equal(t.era_blocks,630000);
 assert.equal(t.subsidy_retention_per_era_pct,55);
 assert.equal(t.final_block_target_seconds.authoritative,false);
});
