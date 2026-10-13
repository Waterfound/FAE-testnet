/** Read-only W4 gate: each historical critical issue must remain evidence-scoped. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const matrix=JSON.parse(readFileSync(new URL('./CLOSURE_MATRIX_EXACT_HEAD_RECONCILIATION_20261011.json',import.meta.url),'utf8'));
const rows=new Map(matrix.rows.map(r=>[r.id,r]));
test('HPA-W4-01: eight distinct historical risk classes are present in intended source order',()=>{
  assert.deepEqual(matrix.rows.map(r=>r.id),['HP-01','HP-02','HP-03','HP-04','HP-05','HP-06','HP-07','HP-08']);
  assert.equal(rows.size,8);
  assert.equal(matrix.interpretation.eight_classes_accounted_for,true);
  assert.equal(matrix.audit.rows_expected,8);
});
test('HPA-W4-02: source HEADs are exact immutable Git SHAs and mapped to prior PR evidence',()=>{
  for(const k of ['historical_pr297','w2_pr310','w3_pr311','dp6_pr312','w4_pr297_previous_verified_head'])
    assert.match(matrix.source[k],/^[0-9a-f]{40}$/,k);
  assert.ok(new Set([matrix.source.w2_pr310,matrix.source.w3_pr311,matrix.source.dp6_pr312]).size===3);
  for(const id of ['HP-01','HP-03','HP-06']){
    const evidence=rows.get(id).evidence.join(' ');
    assert.ok(evidence.includes(id==='HP-01'?matrix.source.dp6_pr312:
      id==='HP-03'?matrix.source.w2_pr310:matrix.source.w3_pr311),'evidence must refer to its own exact source head');
  }
});
test('HPA-W4-03: every class preserves a bounded acceptance gap and no mainnet-green promotion',()=>{
  assert.equal(matrix.interpretation.mainnet_terminal_green_count,0);
  assert.equal(matrix.interpretation.all_risks_resolved,false);
  assert.equal(matrix.interpretation.mainnet_allowed,false);
  assert.equal(matrix.interpretation.candidate_terminal_verified,false);
  for(const r of matrix.rows){
    assert.ok(Array.isArray(r.evidence)&&r.evidence.length>0,r.id);
    assert.ok(Array.isArray(r.remaining)&&r.remaining.length>0,r.id);
    assert.ok(!['GREEN','PASS_VERIFIED','DONE','DONE_CANONICAL'].includes(r.mainnet),r.id);
  }
});
test('HPA-W4-04: narrow current-v4 miner fee revenue collapse is retained',()=>{
  const fee=rows.get('HP-05');
  assert.equal(fee.candidate,'COLLAPSE_CURRENT_V4_MINER_FEE_REVENUE_PREMISE');
  assert.equal(fee.not_entire_pow_collapse,true);
  assert.equal(fee.mainnet,'HOLD');
});
test('HPA-W4-05: no ASIC-economic or BWH-FAW profitability inference from software candidates',()=>{
  assert.equal(rows.get('HP-01').economic_asic_resistance_proven,false);
  assert.equal(rows.get('HP-06').attack_profitability_proven,false);
  assert.equal(matrix.interpretation.specialized_economic_bound,'EXTERNAL_EVIDENCE_GATE');
  assert.equal(matrix.audit.allow_inference_of_actual_specialization_resistance,false);
  assert.equal(matrix.audit.evidence_is_snapshot_only,true);
});
test('HPA-W4-06: authority flags cannot silently activate mainnet/fee/consensus via an evidence matrix',()=>{
  assert.equal(matrix.authority.research_document_only,true);
  for(const k of ['change_consensus','activate_fee','activate_pplns','merge_main','release_mainnet'])
    assert.equal(matrix.authority[k],false,k);
  assert.equal(matrix.interpretation.percent_progress_last_formal,80);
  assert.equal(matrix.interpretation.percent_progress_recalculation,
    'PRIVATE_OWNER_80_PERCENT_WEIGHTED_CANDIDATE_INDICATOR__NOT_MAINNET');
});

test('HPA-W4-07: this October continuation pins W2, W3, DP6 exact newest checked SHAs separately',()=>{
  const w=matrix.latest_wave;
  assert.equal(w.parent_matrix_head,'df64885ed2712f66c3815b2d9d96007f7eec8f99');
  for(const k of ['w3_pr313','w3_pr314'])
    assert.match(matrix.source[k],/^[0-9a-f]{40}$/,k);
  assert.equal(w.w2.head,matrix.source.w2_pr310);
  assert.equal(w.w3.anchored_head,matrix.source.w3_pr313);
  assert.equal(w.w3.signed_head,matrix.source.w3_pr314);
  assert.equal(w.dp6.head,matrix.source.dp6_pr312);
  assert.ok(rows.get('HP-06').evidence.some(e=>e.includes(w.w3.signed_head)));
  assert.ok(rows.get('HP-03').evidence.some(e=>e.includes(w.w2.head)));
  assert.ok(rows.get('HP-01').evidence.some(e=>e.includes(w.dp6.head)));
});
test('HPA-W4-08: software PASS and signed witness cannot silently certify independent observation, revenue or ASIC economics',()=>{
  const w=matrix.latest_wave;
  assert.equal(w.w3.signed_workflows_success,5);
  assert.equal(w.w3.independent_witness_observed,false);
  assert.equal(w.w3.real_pool_enabled,false);
  assert.equal(w.w2.production_policy_enabled,false);
  assert.equal(w.w2.initial_failure_preserved,true);
  assert.equal(w.dp6.hardware_cost_proven,false);
  assert.equal(w.boundary.witnessed_external_identity,'EXTERNAL_EVIDENCE_GATE');
  assert.equal(w.boundary.fee_revenue_current_v4,'COLLAPSE');
  assert.equal(w.boundary.independent_asic_economics,'EXTERNAL_EVIDENCE_GATE');
  assert.equal(w.boundary.mainnet_green_classes,0);
  assert.equal(w.boundary.percentage_weighted_candidate,80);
});

test('HPA-W4-09: a real PoW mined fee-consensus negative does not erase the active v4 miner fee collapse',()=>{
 const a=matrix.latest_wave.w2_fee_adversarial;
 assert.match(a.head,/^[0-9a-f]{40}$/);
 assert.equal(a.head,matrix.source.w2_fee_adversarial_pr315);
 assert.equal(a.source_laboratory_test_count,50);
 assert.equal(a.source_laboratory_test_pass,50);
 assert.equal(a.exact_head_ci_pass,5);
 assert.equal(a.exact_head_ci_total,5);
 assert.equal(a.valid_source_pow_overcredit_rejected,true);
 assert.equal(a.duplicate_signed_tx_fee_overcredit_rejected,true);
 assert.equal(a.actual_v4_miner_fee_revenue_still_collapse,true);
 assert.equal(a.production_activation,false);
 assert.ok(rows.get('HP-05').evidence.some(e=>e.includes(a.head)));
 assert.equal(rows.get('HP-05').candidate,'COLLAPSE_CURRENT_V4_MINER_FEE_REVENUE_PREMISE');
 assert.equal(rows.get('HP-05').mainnet,'HOLD');
});
