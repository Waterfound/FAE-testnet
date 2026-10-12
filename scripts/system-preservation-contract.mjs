#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const DEFAULT_MATRIX = 'docs/system-preservation/FAE_EXPOSURE_MATRIX_V1.json';
const matrixPath = process.argv[2] || DEFAULT_MATRIX;
const allowedClassifications = new Set(['MINIMAL','BOUNDED','ELEVATED','UNKNOWN','FROZEN_WAIT']);
const authorityKeys = ['consensus','economics','release','mainnet','new_spend','provider_mutation','credential_mutation','soak_v3_mutation'];

function fail(message) {
  console.error(`SYSTEM_PRESERVATION_CONTRACT_FAIL: ${message}`);
  process.exit(1);
}

let matrix;
try {
  matrix = JSON.parse(fs.readFileSync(path.resolve(matrixPath), 'utf8'));
} catch (error) {
  fail(`cannot parse matrix: ${error.message}`);
}

if (matrix.schema_version !== 'fae.system-preservation-exposure-matrix.v1') {
  fail('unexpected schema_version');
}
if (!/^[0-9a-f]{40}$/.test(matrix.bound_source_revision || '')) {
  fail('bound_source_revision must be an exact lowercase Git SHA');
}
if (!Array.isArray(matrix.surfaces) || matrix.surfaces.length === 0) {
  fail('surfaces must be non-empty');
}

const ids = new Set();
for (const surface of matrix.surfaces) {
  if (!surface || typeof surface !== 'object') fail('surface entry must be an object');
  if (typeof surface.id !== 'string' || !surface.id) fail('surface id missing');
  if (ids.has(surface.id)) fail(`duplicate surface id: ${surface.id}`);
  ids.add(surface.id);

  if (!allowedClassifications.has(surface.classification)) {
    fail(`${surface.id}: invalid classification ${surface.classification}`);
  }
  if (!Array.isArray(surface.evidence_refs) || surface.evidence_refs.length === 0 ||
      surface.evidence_refs.some(ref => typeof ref !== 'string' || !ref.trim())) {
    fail(`${surface.id}: evidence_refs must be non-empty strings`);
  }
  if (typeof surface.action !== 'string' || !surface.action.trim()) {
    fail(`${surface.id}: action is required`);
  }
  if (surface.classification === 'UNKNOWN' && /\b(DONE|CLOSED|PASS|PROVEN)\b/i.test(surface.action)) {
    fail(`${surface.id}: UNKNOWN surface cannot claim closure`);
  }
  if (surface.classification === 'FROZEN_WAIT' && !/DO_NOT_MUTATE|DO NOT MUTATE/i.test(surface.action)) {
    fail(`${surface.id}: FROZEN_WAIT must explicitly prohibit mutation`);
  }
}

if (!matrix.authority_boundary || typeof matrix.authority_boundary !== 'object') {
  fail('authority_boundary is required');
}
for (const key of authorityKeys) {
  if (matrix.authority_boundary[key] !== false) {
    fail(`authority boundary ${key} must remain false in this candidate`);
  }
}

console.log(JSON.stringify({
  verdict: 'FAE_SYSTEM_PRESERVATION_CONTRACT_PASS',
  matrix: matrixPath,
  bound_source_revision: matrix.bound_source_revision,
  surfaces: matrix.surfaces.length,
  classifications: Object.fromEntries(
    [...allowedClassifications].map(c => [c, matrix.surfaces.filter(s => s.classification === c).length])
  ),
  authority_created: false
}, null, 2));
