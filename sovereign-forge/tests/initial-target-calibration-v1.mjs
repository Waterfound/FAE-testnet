import assert from 'node:assert/strict';
import { POW_LIMIT, targetHex } from '../node/candidate/difficulty-timestamp-v2-300.mjs';
import {
  targetForLaunchHashrate,
  expectedSecondsAtHashrate,
  createInitialTargetCalibration,
} from '../node/candidate/initial-target-calibration-v1.mjs';

const centerHps = 20_000n;
const target = targetForLaunchHashrate({ launchHashrateHps: centerHps, targetSeconds: 300 });
assert.ok(target > 0n && target <= POW_LIMIT);
const centerSeconds = expectedSecondsAtHashrate(target, centerHps);
assert.ok(centerSeconds >= 299.9 && centerSeconds <= 300.1);

const easy = targetForLaunchHashrate({ launchHashrateHps: 1n, targetSeconds: 300 });
assert.equal(easy, POW_LIMIT, 'very low launch hashrate must clamp to pow-limit');

const packetA = createInitialTargetCalibration({
  evidenceLabel: 'Sustained browser-miner launch calibration A',
  launchHashrateLowHps: 12_000,
  launchHashrateCenterHps: 20_000,
  launchHashrateHighHps: 32_000,
  populationModel: 'One equivalent launch miner; explicit low/center/high aggregate hashrate envelope.',
  measurementSummary: 'Synthetic invariant fixture only; not launch evidence.',
});
const packetB = createInitialTargetCalibration({
  evidenceLabel: 'Sustained browser-miner launch calibration A',
  launchHashrateLowHps: 12_000,
  launchHashrateCenterHps: 20_000,
  launchHashrateHighHps: 32_000,
  populationModel: 'One equivalent launch miner; explicit low/center/high aggregate hashrate envelope.',
  measurementSummary: 'Synthetic invariant fixture only; not launch evidence.',
});
assert.equal(packetA.derivedInitialTargetHex, targetHex(target));
assert.equal(packetA.calibrationEvidenceSha256, packetB.calibrationEvidenceSha256, 'same evidence packet must hash deterministically');
assert.ok(packetA.expectedBlockSeconds.lowHashrate > packetA.expectedBlockSeconds.centerHashrate);
assert.ok(packetA.expectedBlockSeconds.centerHashrate > packetA.expectedBlockSeconds.highHashrate);
assert.equal(packetA.activationAuthorized, false);
assert.equal(packetA.publicConsensusChanged, false);

assert.throws(() => createInitialTargetCalibration({
  evidenceLabel: 'bad order',
  launchHashrateLowHps: 30_000,
  launchHashrateCenterHps: 20_000,
  launchHashrateHighHps: 10_000,
  populationModel: 'invalid',
  measurementSummary: 'invalid',
}), /launch_hashrate_order_invalid/);

console.log('initial-target-calibration-v1: PASS');
