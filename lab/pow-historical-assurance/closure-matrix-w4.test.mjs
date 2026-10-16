import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const matrix=JSON.parse(readFileSync(new URL('./CLOSURE_MATRIX.json',import.meta.url),'utf8'));

test('HPA-W4-01: W3 evidence cannot promote HP-06 or Mainnet',()=>{
  const hp06=matrix.rows.find(row=>row.id==='HP-06');
  assert.ok(hp06);
  assert.equal(hp06.candidate_status,'SOURCE_BOUND_EXACT_MODELS_GREEN__EMPIRICAL_PROFITABILITY_OPEN');
  assert.equal(hp06.mainnet_status,'OPEN');
  assert.ok(hp06.evidence.includes('PR #311 source head 4eae6d339cefed9368522336f6fe0d8232d85802'));
  assert.ok(hp06.evidence.some(item=>item.includes('50/50 PASS')));
  assert.match(hp06.residual,/propagation gamma/);
  assert.match(hp06.residual,/specialized-memory\/ASIC/);
  assert.deepEqual(matrix.aggregate.partial,['HP-06']);
  assert.equal(matrix.aggregate.mainnet_terminal_green_count,0);
  assert.equal(matrix.authority.consensus_change,false);
  assert.equal(matrix.authority.economics_change,false);
  assert.equal(matrix.authority.mainnet,false);
});

test('HPA-W4-02: all eight historical rows remain uniquely represented',()=>{
  const ids=matrix.rows.map(row=>row.id);
  assert.deepEqual(ids,['HP-01','HP-02','HP-03','HP-04','HP-05','HP-06','HP-07','HP-08']);
  assert.equal(new Set(ids).size,8);
});
