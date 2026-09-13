import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const output = resolve(process.env.FAE_PEER_ISOLATION_OUTPUT || mkdtempSync(join(tmpdir(), 'fae-peer-isolation-evidence-')));
mkdirSync(output, {recursive: true});
const frozenBase = '3e2ed24';
const git = args => {
  const result = spawnSync('git', args, {cwd: root, encoding: 'utf8'});
  if (result.status !== 0) throw new Error(`git_read_failed:${args[0]}`);
  return result.stdout.trim();
};
const digest = data => createHash('sha256').update(data).digest('hex');
const changed = new Set([
  ...git(['diff', '--name-only', frozenBase]).split('\n'),
  ...git(['ls-files', '--others', '--exclude-standard']).split('\n'),
].filter(Boolean));
const permitted = /^(sovereign-forge\/(node\/lab\/peer-isolation-[\w-]+\.mjs|tests\/(peer-isolation-[\w-]+|run-peer-isolation-lab)\.mjs|protocol\/PEER_ISOLATION_ECLIPSE_RESISTANCE_V001\.md|evidence\/PEER_ISOLATION_V001[\w.-]*)|\.github\/workflows\/peer-isolation-lab\.yml)$/;
for (const path of changed) assert.match(path, permitted, `out-of-scope change: ${path}`);
const sourcePaths = [
  ...[...changed].filter(path => /\.(mjs|yml)$/.test(path)),
  ...readdirSync(join(root, 'sovereign-forge/node/authoritative')).filter(path => path.endsWith('.mjs')).map(path => `sovereign-forge/node/authoritative/${path}`),
  'sovereign-forge/node/fae-node-v6-candidate.mjs',
  'sovereign-forge/tests/legacy-testnet-fixture.mjs',
  'sovereign-forge/protocol/PEER_ISOLATION_ECLIPSE_RESISTANCE_V001.md',
].sort();
const sources = Object.fromEntries(sourcePaths.map(path => [path, digest(readFileSync(join(root, path)))]));
const transportPath = join(output, 'loopback.json');
rmSync(transportPath, {force: true}); // A previous run cannot supply this run's transport evidence.
const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap',
  'sovereign-forge/tests/peer-isolation-policy.mjs', 'sovereign-forge/tests/peer-isolation-loopback.mjs'], {
  cwd: root, encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024,
  env: {...process.env, FAE_PEER_ISOLATION_EVIDENCE: transportPath},
});
writeFileSync(join(output, 'tests.tap'), (result.stdout || '') + (result.stderr || ''));
assert.equal(result.status, 0, `candidate tests failed: ${result.error?.message || result.stderr || result.stdout}`);
const count = key => Number(result.stdout.match(new RegExp(`^# ${key} (\\d+)$`, 'm'))?.[1]);
assert.ok(count('tests') >= 22); assert.equal(count('tests'), count('pass'));
for (const key of ['fail', 'cancelled', 'skipped', 'todo']) assert.equal(count(key), 0);
const transport = JSON.parse(readFileSync(transportPath, 'utf8'));
assert.equal(transport.format, 'fae-peer-isolation-loopback-evidence-v1');
assert.equal(transport.passed, true); assert.equal(transport.realSocketTransport, true);
for (const key of ['independentHosts', 'independentOperators', 'consensusAuthority', 'externalWanProof', 'eclipseResistanceProven']) assert.equal(transport[key], false);
assert.equal(transport.timeBasis, 'virtual-monotonic-policy-clock');
const expected = [
  ['configured-without-contact', 'ISOLATED', 0],
  ['verified-local-sync', 'DEGRADED', 3],
  ['anchor-unavailable', 'DEGRADED', 2],
  ['all-local-sources-unavailable', 'ISOLATED', 0],
  ['same-identity-reconnection', 'DEGRADED', 1],
  ['fresh-observer-bootstrap', 'DEGRADED', 1],
];
assert.equal(transport.phases.length, expected.length);
for (let index = 0; index < expected.length; index++) {
  const phase = transport.phases[index], [name, state, fresh] = expected[index];
  assert.equal(phase.name, name); assert.equal(phase.state, state); assert.equal(phase.freshObservations, fresh);
  assert.ok(phase.selectedTransportGroups <= 1);
  for (const key of ['consensusAuthority', 'externalWanProof', 'operatorIndependenceProven', 'eclipseResistanceProven']) assert.equal(phase[key], false);
}
const report = {
  format: 'fae-peer-isolation-v001-local-gate', verdict: 'PASS_LOCAL_CANDIDATE',
  recordedAt: new Date().toISOString(), frozenBase: git(['rev-parse', frozenBase]),
  testedHead: git(['rev-parse', 'HEAD']), worktreeDirty: git(['status', '--porcelain', '--untracked-files=normal']) !== '',
  runtime: process.version, tests: count('tests'), pass: count('pass'), fail: count('fail'),
  skipped: count('skipped'), sources,
  artifactSha256: {tap: digest(readFileSync(join(output, 'tests.tap'))), loopback: digest(readFileSync(transportPath))},
  productionIntegration: false, consensusAuthority: false, externalWanProof: false,
  independentOperatorProof: false, eclipseResistanceProven: false,
  nextGate: 'Review transport-aware discovery/sync integration before wider network evidence.',
};
writeFileSync(join(output, 'summary.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({verdict: report.verdict, tests: report.tests, pass: report.pass,
  output: relative(root, output), productionIntegration: false, eclipseResistanceProven: false}));
