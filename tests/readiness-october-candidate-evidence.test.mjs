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

test('near-done closure addendum retains strict distinction between actual CI and canonical readiness',()=>{
 const a=snapshot.closure_wave_addendum_october_11;
 assert.equal(a.snapshot_date,'2026-10-11');
 assert.equal(a.authority,'CANDIDATE_ADDITIVE_ONLY');
 assert.equal(a.snapshot_is_not_canonical_promotion,true);
 assert.equal(a.canonical_gate_count_unchanged,24);
 assert.equal(a.canonical_gate_state_changes,0);
 assert.equal(snapshot.gates.length,24);
 assert.equal(snapshot.last_reconciled_at,'2026-10-06');
 assert.equal(a.previous_october_11_snapshot_preserved,true);
 assert.equal(a.mainnet_authorized,false);
 assert.equal(a.production_parameters_frozen,false);
 assert.equal(a.physical_evidence_replaced,false);
 assert.equal(a.master_merged,false);
 assert.equal(wave.evidence.length,7);
 assert.equal(wave.evidence.at(-1).pr,303);
 assert.equal(wave.evidence.at(-1).status,'CANDIDATE_EVIDENCE_IN_PROGRESS');
});

test('closure addendum is a unique exact-head supplemental receipt set with positive workflow evidence',()=>{
 const entries=snapshot.closure_wave_addendum_october_11.evidence;
 assert.deepEqual(entries.map(e=>e.pr),[303,305,306,289]);
 const expected={
  303:'4c56b3f3f5edd39d8ea8029960e093b438e6658e',
  305:'c149d6272043b0d2a06d3a880b2c8fcbb9451ca2',
  306:'b70078f9ccfcab0c66f0c903feca3b5456d50235',
  289:'90e3132e4e9e68f9860b48392f70c6ecccb5bc2f'
 };
 const runs=new Set();
 for(const e of entries){
  assert.equal(e.head_sha,expected[e.pr]);
  assert.equal(e.status,'DONE_TECHNICAL_CANDIDATE');
  assert.ok(e.remaining.length>24);
  assert.ok(Array.isArray(e.ci_receipts) && e.ci_receipts.length>=5);
  for(const r of e.ci_receipts){
   assert.ok(Number.isSafeInteger(r.run_id) && r.run_id>0);
   assert.equal(r.conclusion,'success');
   assert.ok(r.workflow.length>6);
   assert.equal(runs.has(r.run_id),false);
   runs.add(r.run_id);
  }
 }
 assert.equal(runs.size,22);
});

test('release/rehearsal drafts and canonical launch blockers may not be promoted via new evidence',()=>{
 const a=snapshot.closure_wave_addendum_october_11;
 assert.equal(a.evidence.find(x=>x.pr===305).owner_pr,303);
 assert.equal(a.evidence.find(x=>x.pr===306).owner_pr,297);
 assert.equal(a.evidence.find(x=>x.pr===289).owner_pr,null);
 const g=Object.fromEntries(snapshot.gates.map(x=>[x.gate_id,x]));
 assert.equal(g.mainnet_authorization.state,'BLOCKED');
 assert.equal(g.final_production_freeze.state,'UNRESOLVED');
 assert.equal(g.representative_device_evidence.state,'EXTERNAL_EVIDENCE');
 assert.ok(a.evidence.find(x=>x.pr===306).remaining.includes('not deployed fee policy'));
 assert.ok(a.evidence.find(x=>x.pr===305).remaining.includes('actual encrypted IndexedDB'));
 assert.ok(a.evidence.find(x=>x.pr===289).remaining.includes('clean-room full GitHub restoration'));
});

test('no historical rewrites or false seed/passphrase and release conclusions',()=>{
 assert.deepEqual(wave.evidence.map(x=>x.pr),[294,298,299,300,301,302,303]);
 assert.equal(wave.candidate_merge_completed,false);
 assert.equal(wave.iPad_physical_evidence_closed,false);
 assert.equal(snapshot.authority_snapshot.consensus_change_authorized,false);
 assert.equal(snapshot.authority_snapshot.mainnet_launch_authorized,false);
 assert.ok(snapshot.final_production_values_unset.includes('genesis_timestamp_ms'));
 assert.ok(snapshot.final_production_values_unset.includes('release_source_commit'));
});
