import assert from 'node:assert/strict';
import { evaluateEvidenceBundle, wilsonUpper95 } from '../node/lab/economic-block-time-v2-evidence-gate.mjs';

function run(targetSeconds, p95, overrides = {}) {
  return {
    targetSeconds,
    nodeCount: 3,
    regionCount: 2,
    propagationSamples: 500,
    payloadPolicyId: 'comparable-throughput-v1',
    nominalTps: 1 / 15,
    propagationSeconds: {
      median: targetSeconds === 300 ? 0.50 : 0.70,
      mean: targetSeconds === 300 ? 0.80 : 1.00,
      p95,
    },
    steady: { blocks: 500, staleBlocks: 0 },
    stress: { blocks: 500, staleBlocks: 2 },
    ...overrides,
  };
}

function bundle(candidate) {
  return {
    schema: 'fae-economic-block-time-v2-measurement/1',
    harnessCommit: 'a'.repeat(40),
    environmentId: 'fixture-multihost-a',
    baseline: run(300, 1.5),
    candidate,
  };
}

assert.ok(wilsonUpper95(0, 500) < 0.01);
assert.ok(wilsonUpper95(2, 500) < 0.02);

const pass600 = evaluateEvidenceBundle(bundle(run(600, 2.0)));
assert.equal(pass600.admission.throughputComparable, true);
assert.equal(pass600.baselineReadiness.pass, true);
assert.equal(pass600.candidateReadiness.pass, true);
assert.equal(pass600.comparativeAdvantage.atLeast25PctLowerP95Race, true);
assert.equal(pass600.l2NetworkPromotionEvidencePass, true);
assert.equal(pass600.selectionAuthorized, false);
assert.equal(pass600.activationAuthorized, false);

const pass900 = evaluateEvidenceBundle(bundle(run(900, 2.5)));
assert.equal(pass900.l2NetworkPromotionEvidencePass, true);
assert.equal(pass900.activationAuthorized, false);

const noAdvantage = evaluateEvidenceBundle(bundle(run(600, 4.0)));
assert.equal(noAdvantage.candidateReadiness.pass, true);
assert.equal(noAdvantage.comparativeAdvantage.atLeast25PctLowerP95Race, false);
assert.equal(noAdvantage.l2NetworkPromotionEvidencePass, false);

const badStales = evaluateEvidenceBundle(bundle(run(600, 2.0, {
  steady: { blocks: 500, staleBlocks: 8 },
})));
assert.equal(badStales.candidateReadiness.stale.steadyUnder1Pct95, false);
assert.equal(badStales.l2NetworkPromotionEvidencePass, false);

const weakThroughput = evaluateEvidenceBundle(bundle(run(600, 2.0, { nominalTps: 0.05 })));
assert.equal(weakThroughput.admission.throughputComparable, false);
assert.equal(weakThroughput.l2NetworkPromotionEvidencePass, false);

assert.throws(() => evaluateEvidenceBundle(bundle(run(600, 2.0, {
  payloadPolicyId: 'different-payload',
}))), /payload policy mismatch/);

assert.throws(() => evaluateEvidenceBundle(bundle(run(600, 2.0, {
  propagationSamples: 499,
}))), /propagationSamples must be >= 500/);

console.log('economic-block-time-v2-evidence-gate: PASS');
