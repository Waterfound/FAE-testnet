import assert from 'node:assert/strict';
import {
  BASE_SUPPLY_FAE,
  nearestExactSupplyNeutral,
  raceProbability,
  staticCandidate,
  simulateAsertProxy,
  buildReport,
} from '../node/lab/economic-block-time-v2-lab.mjs';

const c300 = staticCandidate(300);
const c600 = staticCandidate(600);
const c900 = staticCandidate(900);

assert.equal(BASE_SUPPLY_FAE, 12_040_000);
assert.equal(c300.heightFrozen.maturityHours, 16 + 40 / 60);
assert.equal(c600.heightFrozen.maturityHours, 33 + 20 / 60);
assert.equal(c900.heightFrozen.maturityHours, 50);

assert.equal(c600.calendarSupplyNeutral.halvingBlocks, 215_000);
assert.equal(c600.calendarSupplyNeutral.rewardFae, 28);
assert.equal(c600.calendarSupplyNeutral.rewardAtoms, '2800000000');
assert.equal(c600.calendarSupplyNeutral.maxSupplyFae, BASE_SUPPLY_FAE);

assert.equal(c900.calendarSupplyNeutral.halvingBlocks, 143_360);
assert.equal(c900.calendarSupplyNeutral.rewardAtoms, '4199218750');
assert.equal(c900.calendarSupplyNeutral.rewardFae, 41.9921875);
assert.equal(c900.calendarSupplyNeutral.maxSupplyFae, BASE_SUPPLY_FAE);
assert.equal(nearestExactSupplyNeutral(900).calendarErrorSeconds, 24_000);

assert.equal(c600.wallClockNeutral.maturityBlocks, 100);
assert.equal(c900.wallClockNeutral.maturityBlocks, 67);
assert.equal(c900.wallClockNeutral.maturityErrorSeconds, 300);
assert.equal(c600.wallClockNeutral.maxTxPerBlock, 40);
assert.equal(c900.wallClockNeutral.maxTxPerBlock, 60);
assert.equal(c600.wallClockNeutral.confirmationsForBaselineThirtyMinutes, 3);
assert.equal(c900.wallClockNeutral.confirmationsForBaselineThirtyMinutes, 2);

const baselineRace = raceProbability(5, 300);
assert.ok(Math.abs(c600.staleProxy.throughputNeutralRaceProbability - baselineRace) < 1e-12);
assert.ok(Math.abs(c900.staleProxy.throughputNeutralRaceProbability - baselineRace) < 1e-12);
assert.ok(c600.staleProxy.fixedPayloadRaceProbability < baselineRace);
assert.ok(c900.staleProxy.fixedPayloadRaceProbability < c600.staleProxy.fixedPayloadRaceProbability);

for (const targetSeconds of [300, 600, 900]) {
  for (const scenario of ['stable', 'loss80', 'gain80', 'browserCycle']) {
    const r = simulateAsertProxy({ targetSeconds, scenario, durationSeconds: 72 * 3600, seed: 0x12345678 });
    assert.ok(r.blocks > 0);
    assert.ok(Number.isFinite(r.meanIntervalSeconds));
    assert.ok(Number.isFinite(r.log2TargetStdDev));
    assert.ok(r.meanIntervalSeconds > 0);
  }
}

const report = buildReport();
assert.equal(report.authority, 'research-only-candidate-not-active-consensus');
assert.equal(report.l2.baselineDisposition, 'HOLD-300-AS-INCUMBENT');
assert.equal(report.l2.activationRule, 'L3_REQUIRED_BEFORE_ANY_TESTNET_ACTIVATION');
assert.equal(report.staticMetrics.length, 3);
assert.equal(report.daaProxy.length, 12);

console.log('economic-block-time-v2-lab: PASS');
