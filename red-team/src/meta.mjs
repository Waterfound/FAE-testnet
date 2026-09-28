import path from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { readJson } from './canonical.mjs';
import {
  knownDomains,
  validateAttackLibrary,
  validateCampaign,
  validateScorePolicy,
  validateTaxonomy
} from './contracts.mjs';
import { validateGenealogy } from './genealogy.mjs';
import { createHoldoutCommitments, createBlindRequest, scoreHoldoutReveal } from './holdout.mjs';
import { buildLedgerEvent, verifyLedger } from './ledger.mjs';
import { mutateAttack } from './mutation.mjs';
import { assertScoreMonotonicity } from './scoring.mjs';

async function listFiles(root, options = {}) {
  const output = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'state' || entry.name === 'reports') continue;
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute);
      if (relative === path.join('holdout', 'private') || relative.startsWith(path.join('holdout', 'private') + path.sep)) {
        if (options.includePrivate) output.push(absolute);
        continue;
      }
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) output.push(absolute);
    }
  }
  await visit(root);
  return output;
}

function sensitiveKeys(value, location = '$', found = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => sensitiveKeys(item, location + '[' + index + ']', found));
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (['expected_private', 'commitment_nonce', 'private_key', 'seed_phrase', 'mnemonic', 'reveal_key'].includes(key)) {
        found.push(location + '.' + key);
      }
      sensitiveKeys(item, location + '.' + key, found);
    }
  }
  return found;
}

async function assertNoPrivateHoldoutFiles(root) {
  const privateRoot = path.join(root, 'holdout', 'private');
  try {
    const entries = await readdir(privateRoot);
    if (entries.length > 0) throw new Error('holdout/private is not empty');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const dataRoots = ['attacks', 'campaigns', 'holdout', 'policies', 'taxonomy', 'transfers'];
  for (const dataRoot of dataRoots) {
    const absolute = path.join(root, dataRoot);
    const files = await listFiles(absolute);
    for (const file of files.filter((item) => item.endsWith('.json'))) {
      const value = await readJson(file);
      const found = sensitiveKeys(value);
      if (found.length > 0) throw new Error('Public data contains private holdout material at ' + path.relative(root, file));
    }
  }
}

async function assertAuthorityIsolation(root) {
  const authoritative = path.resolve(root, '..', 'sovereign-forge', 'node', 'authoritative');
  const files = await listFiles(authoritative);
  for (const file of files.filter((item) => item.endsWith('.mjs') || item.endsWith('.js'))) {
    const text = await readFile(file, 'utf8');
    if (/from\s+['"][^'"]*red-team|import\s*\([^)]*red-team/.test(text)) {
      throw new Error('Authoritative source imports red-team code: ' + file);
    }
  }
}

function syntheticRootAttack() {
  return {
    schema_version: 'fae.red-team.attack.v0.0.1',
    id: 'meta/mutation-root',
    version: '0.0.1',
    title: 'Meta mutation root',
    domain: 'meta',
    failure_class: 'RED_TEAM_PROCESS_FAILURE',
    severity: 'critical',
    executor: {
      kind: 'process',
      argv: ['node', '--version'],
      cwd: '.',
      timeout_ms: 1000,
      max_output_bytes: 4096,
      network: 'deny',
      stdin: 'none'
    },
    oracle: { kind: 'exit-code-defense', defended_exit_code: 0 },
    evidence_requirements: ['target_commit'],
    payload: { height: 10, enabled: true, label: 'normal', peers: ['one'] },
    lineage: { parent_id: null, generation: 0 }
  };
}

function assertMutationReplay() {
  const descriptors = [
    { operator: 'boundary-number', path: '/payload/height', values: [-1, 0, 1, 11] },
    { operator: 'flip-boolean', path: '/payload/enabled' },
    { operator: 'string-edge', path: '/payload/label' },
    { operator: 'duplicate-array-element', path: '/payload/peers' }
  ];
  const first = mutateAttack(syntheticRootAttack(), descriptors, { seed: 'meta-seed', count: 4 });
  const second = mutateAttack(syntheticRootAttack(), descriptors, { seed: 'meta-seed', count: 4 });
  if (JSON.stringify(first) !== JSON.stringify(second)) throw new Error('Mutation replay is nondeterministic');
  validateGenealogy([syntheticRootAttack(), ...first]);
}

function assertHoldoutSeparation() {
  const privateSet = {
    set_id: 'meta-holdout',
    cases: [{
      case_id: 'meta-case',
      domain: 'meta',
      severity: 'critical',
      input_public: { prompt: 'opaque' },
      commitment_nonce: '0123456789abcdef0123456789abcdef',
      expected_private: { acceptable_verdicts: ['defended'] }
    }]
  };
  const commitments = createHoldoutCommitments(privateSet);
  const request = createBlindRequest(commitments);
  if (JSON.stringify(request).includes('expected_private') || JSON.stringify(request).includes('defended')) {
    throw new Error('Blind request leaked expected outcome');
  }
  const scored = scoreHoldoutReveal(commitments, privateSet, {
    set_id: privateSet.set_id,
    answers: [{ case_id: 'meta-case', verdict: 'defended' }]
  });
  if (scored.score !== 1 || scored.promotion_allowed !== false) throw new Error('Active holdout scoring boundary failed');
}

function assertLedgerTamperDetection() {
  const first = buildLedgerEvent({ kind: 'finding', id: 'one' }, null, { sequence: 1, now: '2026-09-12T00:00:00.000Z' });
  const second = buildLedgerEvent({ kind: 'promotion', id: 'two' }, first.event_hash, { sequence: 2, now: '2026-09-12T00:00:01.000Z' });
  verifyLedger([first, second]);
  const tampered = structuredClone(second);
  tampered.payload.id = 'changed';
  let detected = false;
  try {
    verifyLedger([first, tampered]);
  } catch {
    detected = true;
  }
  if (!detected) throw new Error('Learning ledger tampering was not detected');
}

export async function runMetaRedTeam(options = {}) {
  const root = options.root
    ? path.resolve(options.root)
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const checks = [];
  async function check(id, operation) {
    try {
      await operation();
      checks.push({ id, status: 'ok' });
    } catch (error) {
      checks.push({ id, status: 'failed', error: error.message });
    }
  }

  let taxonomy;
  let policy;
  let library;
  let campaign;
  await check('contract-corpus', async () => {
    taxonomy = validateTaxonomy(await readJson(path.join(root, 'taxonomy', 'failure-taxonomy.v0.0.1.json')));
    policy = validateScorePolicy(await readJson(path.join(root, 'policies', 'score-policy.v0.0.1.json')));
    library = validateAttackLibrary(await readJson(path.join(root, 'attacks', 'fae-attack-library.v0.0.1.json')), taxonomy);
    campaign = validateCampaign(await readJson(path.join(root, 'campaigns', 'fae-regression-smoke.v0.0.1.json')));
    const libraryIds = new Set(library.attacks.map((attack) => attack.id));
    const missing = campaign.attack_ids.filter((id) => !libraryIds.has(id));
    if (missing.length > 0) throw new Error('Campaign has unresolved attacks: ' + missing.join(', '));
  });
  await check('versioned-schema-json', async () => {
    const schemaFiles = await listFiles(path.join(root, 'schemas'));
    for (const file of schemaFiles.filter((item) => item.endsWith('.json'))) await readJson(file);
  });
  await check('genealogy-dag', async () => validateGenealogy(library.attacks));
  await check('score-monotonicity', async () => assertScoreMonotonicity(policy));
  await check('deterministic-mutation-replay', assertMutationReplay);
  await check('blind-holdout-separation', assertHoldoutSeparation);
  await check('learning-ledger-tamper-detection', assertLedgerTamperDetection);
  await check('private-holdout-leakage', async () => assertNoPrivateHoldoutFiles(root));
  await check('consensus-authority-isolation', async () => assertAuthorityIsolation(root));
  await check('cross-domain-map', async () => {
    const transfer = await readJson(path.join(root, 'transfers', 'cross-domain-primitives.v0.0.1.json'));
    const ids = new Set();
    const domains = knownDomains();
    for (const primitive of transfer.primitives) {
      if (ids.has(primitive.id)) throw new Error('Duplicate transfer primitive ' + primitive.id);
      ids.add(primitive.id);
      for (const domain of [...primitive.source_domains, ...primitive.target_domains]) {
        if (!domains.has(domain)) throw new Error('Unknown transfer domain ' + domain);
      }
    }
  });
  const failures = checks.filter((item) => item.status === 'failed');
  return {
    schema_version: 'fae.red-team.meta-report.v0.0.1',
    engine_version: '0.0.1',
    gate: failures.length === 0 ? 'HOLD' : 'INVALID',
    reason: failures.length === 0 ? 'research-only-no-certification-authority' : 'meta-red-team-failure',
    checks
  };
}
