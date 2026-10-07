import { hashHex } from '../authoritative/crypto.mjs';
import { POW_LIMIT, targetHex } from './difficulty-timestamp-v2-300.mjs';

export const INITIAL_TARGET_CALIBRATION_FORMAT = 'FAE_V5_300_INITIAL_TARGET_CALIBRATION_V1';
export const HASH_SPACE = 1n << 256n;

function positiveInteger(value, field) {
  const n = typeof value === 'bigint' ? value : BigInt(value);
  if (n <= 0n) throw new Error(`${field}_must_be_positive`);
  return n;
}

function safePositiveInteger(value, field) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error(`${field}_must_be_positive_safe_integer`);
  return n;
}

function cleanText(value, field, max = 500) {
  const text = String(value ?? '').trim();
  if (!text || text.length > max) throw new Error(`invalid_${field}`);
  return text;
}

export function targetForLaunchHashrate({
  launchHashrateHps,
  targetSeconds = 300,
  powLimit = POW_LIMIT,
} = {}) {
  const hps = positiveInteger(launchHashrateHps, 'launch_hashrate_hps');
  const seconds = BigInt(safePositiveInteger(targetSeconds, 'target_seconds'));
  const limit = positiveInteger(powLimit, 'pow_limit');
  const desiredHashes = hps * seconds;
  let target = HASH_SPACE / desiredHashes;
  target = target > 0n ? target - 1n : 1n;
  if (target < 1n) target = 1n;
  if (target > limit) target = limit;
  return target;
}

export function expectedHashesForTarget(target) {
  const t = positiveInteger(target, 'target');
  return (HASH_SPACE + t) / (t + 1n);
}

export function expectedSecondsAtHashrate(target, hashrateHps) {
  const hps = positiveInteger(hashrateHps, 'hashrate_hps');
  const hashes = expectedHashesForTarget(target);
  return Number(hashes) / Number(hps);
}

export function createInitialTargetCalibration({
  evidenceLabel,
  launchHashrateLowHps,
  launchHashrateCenterHps,
  launchHashrateHighHps,
  targetSeconds = 300,
  populationModel,
  measurementSummary,
} = {}) {
  const low = positiveInteger(launchHashrateLowHps, 'launch_hashrate_low_hps');
  const center = positiveInteger(launchHashrateCenterHps, 'launch_hashrate_center_hps');
  const high = positiveInteger(launchHashrateHighHps, 'launch_hashrate_high_hps');
  if (!(low <= center && center <= high)) throw new Error('launch_hashrate_order_invalid');
  const seconds = safePositiveInteger(targetSeconds, 'target_seconds');
  if (seconds !== 300) throw new Error('calibration_target_seconds_must_be_300');

  const target = targetForLaunchHashrate({ launchHashrateHps: center, targetSeconds: seconds });
  const packet = Object.freeze({
    format: INITIAL_TARGET_CALIBRATION_FORMAT,
    authority: 'candidate-calibration-evidence-only',
    evidenceLabel: cleanText(evidenceLabel, 'evidence_label', 160),
    targetSeconds: seconds,
    launchHashrateHps: Object.freeze({
      low: low.toString(),
      center: center.toString(),
      high: high.toString(),
    }),
    populationModel: cleanText(populationModel, 'population_model'),
    measurementSummary: cleanText(measurementSummary, 'measurement_summary', 1000),
    derivedInitialTargetHex: targetHex(target),
    expectedBlockSeconds: Object.freeze({
      lowHashrate: expectedSecondsAtHashrate(target, low),
      centerHashrate: expectedSecondsAtHashrate(target, center),
      highHashrate: expectedSecondsAtHashrate(target, high),
    }),
    activationAuthorized: false,
    publicConsensusChanged: false,
  });

  return Object.freeze({
    ...packet,
    calibrationEvidenceSha256: hashHex(packet),
  });
}
