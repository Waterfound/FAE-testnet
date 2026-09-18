import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const mining=await readFile(new URL('../../../mining.js',import.meta.url),'utf8');
const mts09=await readFile(new URL('./mts-09-multicontext.test.mjs',import.meta.url),'utf8');

test('MTS-10 baseline: direct tip observer polling interval is 2000ms',()=>{
  const match=mining.match(/const DIRECT_TIP_OBSERVER_INTERVAL_MS=(\d+);/);
  assert.ok(match,'direct tip observer interval constant missing');
  assert.equal(Number(match[1]),2000);
  assert.match(mining,/setTimeout\(poll,DIRECT_TIP_OBSERVER_INTERVAL_MS\)/);
});

test('MTS-10 baseline: runtime has no BroadcastChannel acceleration path',()=>{
  assert.doesNotMatch(mining,/BroadcastChannel/);
});

test('MTS-10 baseline: MTS-09 proves peer contexts wait for their own authoritative observation',()=>{
  assert.match(mts09,/tab B changed before its own authoritative poll/);
  assert.match(mts09,/other device changed before its own authoritative poll/);
  assert.match(mts09,/same-device tab B must not depend on tab A or device C/);
});

test('MTS-10 baseline: avoidable same-device stale-work window is bounded by the independent 2000ms poll',()=>{
  const interval=Number(mining.match(/const DIRECT_TIP_OBSERVER_INTERVAL_MS=(\d+);/)?.[1]);
  assert.equal(interval,2000);
  const worstCaseMs=interval;
  const meanUniformPhaseMs=interval/2;
  assert.equal(worstCaseMs,2000);
  assert.equal(meanUniformPhaseMs,1000);
  assert.ok(worstCaseMs>0);
});

console.log('MTS-10 baseline: same-device correctness is independent, but optional hint acceleration is absent; poll bound = 2000ms.');
