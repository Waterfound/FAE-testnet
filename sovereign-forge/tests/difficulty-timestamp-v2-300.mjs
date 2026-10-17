import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  DAA_V2_300,
  asertTarget300,
  medianTimePast,
  validateTimestamp300,
  targetFromHex,
  targetHex,
  daa300Manifest,
} from '../node/candidate/difficulty-timestamp-v2-300.mjs';

const vectors = JSON.parse(await readFile(new URL('../protocol/DIFFICULTY_TIMESTAMP_V2_300_VECTORS.json', import.meta.url), 'utf8'));

assert.equal(vectors.status, 'candidate-not-active-consensus');
assert.equal(vectors.parameters.target_seconds, 300);
assert.equal(DAA_V2_300.targetSeconds, 300);
assert.equal(DAA_V2_300.halfLifeSeconds, 21_600);
assert.equal(DAA_V2_300.mtpWindow, 11);
assert.equal(DAA_V2_300.futureDriftMs, 90_000);

const a = vectors.asert;
const anchorTarget = targetFromHex(a.anchor_target_hex);
for (const vector of a.vectors) {
  const result = asertTarget300({
    anchorTarget,
    anchorHeight: a.anchor_height,
    anchorParentTimeSeconds: a.anchor_parent_time_seconds,
    evaluationHeight: a.evaluation_height,
    evaluationTimeSeconds: vector.evaluation_time_seconds,
    halfLifeSeconds: vectors.parameters.half_life_seconds,
  });
  assert.equal(targetHex(result), vector.expected_target_hex, vector.name);
}

const chain = vectors.timestamp.recent_chain_timestamps_ms.map((timestamp_ms, i) => ({ height: i + 1, timestamp_ms }));
assert.equal(medianTimePast(chain), vectors.timestamp.expected_mtp_ms);
for (const vector of vectors.timestamp.vectors) {
  const result = validateTimestamp300(chain, vector.timestamp_ms, { nowMs: vectors.timestamp.now_ms });
  assert.equal(result.ok, vector.ok, vector.name);
  if (!vector.ok) assert.equal(result.error, vector.error, vector.name);
}

const manifest = daa300Manifest();
assert.equal(manifest.authority, 'candidate-not-active-consensus');
assert.equal(manifest.targetSeconds, 300);
assert.equal(manifest.activationAuthorized, false);

// The frozen on-schedule time must encode 101 target intervals after the anchor parent.
assert.equal(a.on_schedule_time_seconds - a.anchor_parent_time_seconds, 300 * (a.evaluation_height - a.anchor_height + 1));

console.log('difficulty-timestamp-v2-300: PASS');
