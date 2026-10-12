#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const manifestPath = path.join(root, 'lab/post-quantum-signatures/authority.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

function fail(message) {
  console.error('PQ-00 BOUNDARY FAIL:', message);
  process.exitCode = 1;
}

const falseFlags = [
  'activation_authorized',
  'consensus_change_authorized',
  'transaction_v2_change_authorized',
  'active_wallet_format_change_authorized',
  'active_address_change_authorized',
  'public_testnet_change_authorized',
  'candidate_to_authoritative',
  'mainnet_launch_authorized'
];

for (const key of falseFlags) {
  if (manifest[key] !== false) fail(`${key} must remain false`);
}
if (manifest.authority_ceiling !== 'RESEARCH_SHADOW_CANDIDATE_WRITE') {
  fail('unexpected authority ceiling');
}
if (manifest.active_runtime_may_import_lab_code !== false) {
  fail('active runtime must not import Lab code');
}
if (manifest.lab_may_read_active_reference_code !== true) {
  fail('Lab read-only parity access must remain explicit');
}

const activeFiles = [
  'wallet-crypto.js',
  'wallet.js',
  'core.js',
  'mining.js',
  'network-status.js',
  'sovereign-forge/node/authoritative/fae-v4-core.mjs'
];

for (const relative of activeFiles) {
  const text = await readFile(path.join(root, relative), 'utf8');
  for (const marker of manifest.active_runtime_must_not_reference) {
    if (text.includes(marker)) {
      fail(`active runtime ${relative} references forbidden Lab marker ${marker}`);
    }
  }
}

const baseIndex = process.argv.indexOf('--base');
if (baseIndex !== -1) {
  const base = process.argv[baseIndex + 1];
  const headIndex = process.argv.indexOf('--head');
  const head = headIndex !== -1 ? process.argv[headIndex + 1] : 'HEAD';
  if (!base) fail('--base requires a git revision');
  else if (!head) fail('--head requires a git revision when present');
  else {
    let changed = [];
    try {
      const output = execFileSync('git', ['diff', '--name-only', `${base}...${head}`], {
        cwd: root,
        encoding: 'utf8'
      });
      changed = output.split(/\r?\n/).filter(Boolean);
    } catch (error) {
      fail(`unable to inspect git diff from ${base} to ${head}: ${error.message}`);
    }
    for (const file of changed) {
      const allowed = manifest.allowed_write_prefixes.some(prefix =>
        prefix.endsWith('/') ? file.startsWith(prefix) : file.startsWith(prefix)
      );
      if (!allowed) fail(`changed path outside PQ authority: ${file}`);
    }
  }
}

if (!process.exitCode) {
  console.log('PQ-00 boundary guard PASS');
}
