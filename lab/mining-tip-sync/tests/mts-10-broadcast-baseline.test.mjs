import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const evidence=JSON.parse(await readFile(new URL('../evidence/mts-10-baseline.json',import.meta.url),'utf8'));

test('MTS-10 frozen baseline evidence is GREEN',()=>{
  assert.equal(evidence.status,'GREEN');
  assert.equal(evidence.lab_workflow?.conclusion,'success');
  assert.equal(evidence.canonical_workflow?.conclusion,'success');
});

test('MTS-10 frozen baseline records the 2000ms independent polling bound',()=>{
  assert.equal(evidence.observed_baseline?.direct_tip_poll_interval_ms,2000);
  assert.equal(evidence.observed_baseline?.worst_case_avoidable_poll_wait_ms,2000);
  assert.equal(evidence.observed_baseline?.mean_uniform_phase_wait_ms,1000);
});

test('MTS-10 baseline distinguishes optimization from correctness',()=>{
  assert.equal(evidence.observed_baseline?.same_device_peer_requires_own_authoritative_observation,true);
  assert.equal(evidence.optimization_gate?.measurable_latency_exists,true);
  assert.equal(evidence.optimization_gate?.correctness_defect,false);
  assert.equal(evidence.optimization_gate?.network_status_remains_authority,true);
});

console.log('MTS-10 frozen baseline evidence verified.');
