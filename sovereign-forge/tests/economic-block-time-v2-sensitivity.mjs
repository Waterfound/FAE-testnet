import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const raw = execFileSync(process.execPath, ['sovereign-forge/node/lab/economic-block-time-v2-sensitivity.mjs'], { encoding: 'utf8' });
const r = JSON.parse(raw);

assert.equal(r.authority, 'research-only-candidate-not-active-consensus');

const gates = Object.fromEntries(r.empiricalDelayGates.map((x) => [x.targetSeconds, x]));
assert.ok(Math.abs(gates[300].breakEvenDelaySeconds - 5) < 1e-12);
assert.ok(Math.abs(gates[600].breakEvenDelaySeconds - 10) < 1e-12);
assert.ok(Math.abs(gates[900].breakEvenDelaySeconds - 15) < 1e-12);

const mining = Object.fromEntries(r.miningPayoutVariance.map((x) => [x.targetSeconds, x]));
assert.ok(Math.abs(mining[600].relativeMeanPayoutRate - 1) < 1e-12);
assert.ok(Math.abs(mining[600].relativeVarianceRate - 2) < 1e-12);
assert.ok(Math.abs(mining[600].relativeStdDevOverFixedHorizon - Math.sqrt(2)) < 1e-12);
assert.ok(mining[900].relativeMeanPayoutRate > 0.999 && mining[900].relativeMeanPayoutRate < 1);
assert.ok(mining[900].relativeVarianceRate > 2.99 && mining[900].relativeVarianceRate < 3);

for (const x of r.miningPayoutVariance) {
  assert.equal(x.relativeExpectedWorkPerUnitTime, 1);
}

console.log('economic-block-time-v2-sensitivity: PASS');
