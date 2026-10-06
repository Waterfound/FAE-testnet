#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root = path.resolve(new URL('..', import.meta.url).pathname, '..');
const validator = path.join(root, 'scripts/system-preservation-contract.mjs');
const sourceMatrixPath = path.join(root, 'docs/system-preservation/FAE_EXPOSURE_MATRIX_V1.json');
const source = JSON.parse(fs.readFileSync(sourceMatrixPath, 'utf8'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fae-system-preservation-'));

function run(matrix) {
  const file = path.join(tmp, `case-${Math.random().toString(16).slice(2)}.json`);
  fs.writeFileSync(file, JSON.stringify(matrix, null, 2));
  return spawnSync(process.execPath, [validator, file], {encoding:'utf8'});
}

const valid = run(source);
assert.equal(valid.status, 0, valid.stderr);
assert.match(valid.stdout, /FAE_SYSTEM_PRESERVATION_CONTRACT_PASS/);

{
  const m = structuredClone(source);
  m.surfaces[0].classification = 'MAGIC';
  assert.notEqual(run(m).status, 0);
}
{
  const m = structuredClone(source);
  m.surfaces[0].evidence_refs = [];
  assert.notEqual(run(m).status, 0);
}
{
  const m = structuredClone(source);
  const u = m.surfaces.find(s => s.classification === 'UNKNOWN');
  u.action = 'PROVEN_CLOSED';
  assert.notEqual(run(m).status, 0);
}
{
  const m = structuredClone(source);
  m.authority_boundary.mainnet = true;
  assert.notEqual(run(m).status, 0);
}
{
  const m = structuredClone(source);
  const frozen = m.surfaces.find(s => s.classification === 'FROZEN_WAIT');
  frozen.action = 'optimize now';
  assert.notEqual(run(m).status, 0);
}

console.log('FAE_SYSTEM_PRESERVATION_CONTRACT_TESTS_PASS 6/6');
