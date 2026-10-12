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
  assert.equal(matrix.interpretation.percent_progress_last_formal,63);
  assert.equal(matrix.interpretation.percent_progress_recalculation,'NOT_AUDITED_AGAINST_WEIGHTED_GATE_ACCEPTANCE');
});
