#!/usr/bin/env node
import assert from 'node:assert/strict';
import {chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, statSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  generateNodeIdentity,
  loadNodeIdentity,
  saveNodeIdentity,
  signEnvelope,
  verifyEnvelope
} from '../sovereign-forge/node/authoritative/node-identity.mjs';

const root = mkdtempSync(path.join(os.tmpdir(), 'fae-preservation-identity-'));
const firstDir = path.join(root, 'runtime-a');
const secondDir = path.join(root, 'runtime-b');
const firstPath = path.join(firstDir, 'node-identity.json');
const secondPath = path.join(secondDir, 'node-identity.json');

try {
  const generated = generateNodeIdentity();
  saveNodeIdentity(firstPath, generated);
  assert.equal(statSync(firstPath).mode & 0o777, 0o600);

  const first = loadNodeIdentity(firstPath);
  const publicIdentity = first.id;

  mkdirSync(secondDir, {recursive:true});
  copyFileSync(firstPath, secondPath);
  chmodSync(secondPath, 0o600);

  const restored = loadNodeIdentity(secondPath);
  assert.equal(restored.id, publicIdentity, 'restored identity must preserve public identity');

  const payload = {purpose:'system-preservation-recovery-rehearsal', sequence:1};
  const envelope = signEnvelope(restored, 'system-preservation-recovery-test', payload);
  const verified = verifyEnvelope(envelope, {
    kind:'system-preservation-recovery-test',
    expectedSignerId:publicIdentity,
    maxAgeMs:60_000
  });
  assert.deepEqual(verified, payload, 'restored private material must still authenticate as the same public identity');

  const substitute = generateNodeIdentity();
  assert.notEqual(substitute.id, publicIdentity, 'negative control must use a distinct identity');
  const substitutedEnvelope = signEnvelope(substitute, 'system-preservation-recovery-test', payload);
  assert.throws(
    () => verifyEnvelope(substitutedEnvelope, {
      kind:'system-preservation-recovery-test',
      expectedSignerId:publicIdentity,
      maxAgeMs:60_000
    }),
    /different peer identity/
  );

  console.log(JSON.stringify({
    verdict:'FAE_SYSTEM_PRESERVATION_IDENTITY_RECOVERY_PASS',
    public_identity:publicIdentity,
    continuity:true,
    negative_substitution_rejected:true,
    retained_private_material:false,
    test_only_ephemeral_identity:true
  }, null, 2));
} finally {
  rmSync(root, {recursive:true, force:true});
}
