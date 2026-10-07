import path from 'node:path';

const ID = /^[a-z0-9][a-z0-9._~/-]{2,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const GIT_COMMIT = /^[a-f0-9]{40}$/;
const SEVERITIES = new Set(['critical', 'high', 'medium', 'low']);
const DOMAINS = new Set([
  'consensus',
  'activation',
  'p2p',
  'difficulty_timestamp',
  'persistence',
  'coordinator',
  'wallet_client',
  'release_integrity',
  'availability',
  'meta'
]);
const EXECUTABLES = new Set(['node', 'npm', 'npm.cmd', 'python3']);

function fail(message) {
  throw new Error('Contract violation: ' + message);
}

function object(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(name + ' must be an object');
}

function string(value, name) {
  if (typeof value !== 'string' || value.length === 0) fail(name + ' must be a non-empty string');
}

function id(value, name) {
  string(value, name);
  if (!ID.test(value)) fail(name + ' has an invalid identifier');
}

function exactKeysUnique(items, field, name) {
  const seen = new Set();
  for (const item of items) {
    const value = item[field];
    if (seen.has(value)) fail(name + ' contains duplicate ' + field + ' ' + value);
    seen.add(value);
  }
}

function integerBetween(value, min, max, name) {
  if (!Number.isInteger(value) || value < min || value > max) {
    fail(name + ' must be an integer from ' + min + ' to ' + max);
  }
}

function validateArgv(argv, name) {
  if (!Array.isArray(argv) || argv.length === 0) fail(name + ' must be a non-empty argv array');
  argv.forEach((value, index) => string(value, name + '[' + index + ']'));
  if (!EXECUTABLES.has(argv[0])) fail(name + ' executable is not allowlisted: ' + argv[0]);
  const unsafeNodeFlags = ['-e', '--eval', '-p', '--print', '-r', '--require', '--import', '--loader', '--experimental-loader'];
  if (argv[0] === 'node' && argv.some((arg) =>
    unsafeNodeFlags.includes(arg) || unsafeNodeFlags.some((flag) => arg.startsWith(flag + '='))
  )) {
    fail(name + ' may not use dynamic node code-loading flags');
  }
  if (argv[0] === 'python3' && argv.some((arg) => arg === '-c')) fail(name + ' may not use python -c');
  for (const arg of argv.slice(1)) {
    if (path.isAbsolute(arg) || /(^|[\\/])\.\.([\\/]|$)/.test(arg)) {
      fail(name + ' contains an absolute or traversing argument');
    }
  }
}

export function validateAttack(attack, taxonomyClassIds) {
  object(attack, 'attack');
  id(attack.id, 'attack.id');
  if (attack.schema_version !== 'fae.red-team.attack.v0.0.1') fail('unsupported attack schema');
  if (attack.version !== '0.0.1') fail('unsupported attack version');
  string(attack.title, 'attack.title');
  if (!DOMAINS.has(attack.domain)) fail('attack.domain is not recognized');
  if (!SEVERITIES.has(attack.severity)) fail('attack.severity is not recognized');
  string(attack.failure_class, 'attack.failure_class');
  if (taxonomyClassIds && !taxonomyClassIds.has(attack.failure_class)) {
    fail('attack.failure_class is absent from frozen taxonomy: ' + attack.failure_class);
  }
  object(attack.executor, 'attack.executor');
  if (attack.executor.kind !== 'process') fail('only process executors are supported in v0.0.1');
  validateArgv(attack.executor.argv, 'attack.executor.argv');
  if (attack.executor.network !== 'deny') fail('v0.0.1 campaigns must declare network deny');
  if (attack.executor.stdin !== 'none' && attack.executor.stdin !== 'payload-json') {
    fail('attack.executor.stdin must be none or payload-json');
  }
  if (attack.executor.capture_excerpt !== undefined && attack.executor.capture_excerpt !== false) {
    fail('v0.0.1 forbids process-output excerpts');
  }
  string(attack.executor.cwd, 'attack.executor.cwd');
  integerBetween(attack.executor.timeout_ms, 100, 600000, 'attack.executor.timeout_ms');
  integerBetween(attack.executor.max_output_bytes, 1024, 10485760, 'attack.executor.max_output_bytes');
  object(attack.oracle, 'attack.oracle');
  if (attack.oracle.kind !== 'exit-code-defense') fail('unsupported oracle kind');
  integerBetween(attack.oracle.defended_exit_code, 0, 255, 'attack.oracle.defended_exit_code');
  if (!Array.isArray(attack.evidence_requirements) || attack.evidence_requirements.length === 0) {
    fail('attack.evidence_requirements must be non-empty');
  }
  attack.evidence_requirements.forEach((value, index) => string(value, 'attack.evidence_requirements[' + index + ']'));
  if (attack.lineage !== undefined) {
    object(attack.lineage, 'attack.lineage');
    if (attack.lineage.parent_id !== null) id(attack.lineage.parent_id, 'attack.lineage.parent_id');
    integerBetween(attack.lineage.generation, 0, 1000, 'attack.lineage.generation');
  }
  return attack;
}

export function validateTaxonomy(taxonomy) {
  object(taxonomy, 'taxonomy');
  if (taxonomy.schema_version !== 'fae.red-team.taxonomy.v0.0.1') fail('unsupported taxonomy schema');
  id(taxonomy.taxonomy_id, 'taxonomy.taxonomy_id');
  if (!Array.isArray(taxonomy.classes) || taxonomy.classes.length === 0) fail('taxonomy.classes must be non-empty');
  exactKeysUnique(taxonomy.classes, 'id', 'taxonomy.classes');
  for (const entry of taxonomy.classes) {
    string(entry.id, 'taxonomy class id');
    if (!DOMAINS.has(entry.domain)) fail('taxonomy class domain is not recognized');
    if (!SEVERITIES.has(entry.default_severity)) fail('taxonomy severity is not recognized');
  }
  return taxonomy;
}

export function validateScorePolicy(policy) {
  object(policy, 'score policy');
  if (policy.schema_version !== 'fae.red-team.score-policy.v0.0.1') fail('unsupported score policy schema');
  id(policy.policy_id, 'score policy id');
  for (const severity of SEVERITIES) {
    if (!(policy.severity_weights[severity] > 0)) fail('missing positive severity weight ' + severity);
  }
  for (const outcome of ['defended', 'inconclusive', 'collapsed', 'engine_error']) {
    const value = policy.outcome_values[outcome];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
      fail('invalid outcome value ' + outcome);
    }
  }
  for (const component of ['defense', 'evidence', 'reproducibility', 'novelty']) {
    const value = policy.components[component];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
      fail('invalid score component ' + component);
    }
  }
  const componentTotal = Object.values(policy.components).reduce((sum, value) => sum + value, 0);
  if (Math.abs(componentTotal - 1) > 1e-12) fail('score component weights must sum to one');
  if (policy.severity_weights.critical < policy.severity_weights.high ||
      policy.severity_weights.high < policy.severity_weights.medium ||
      policy.severity_weights.medium < policy.severity_weights.low) {
    fail('severity weights must be monotonic');
  }
  integerBetween(policy.minimum_repetitions_for_promotion, 2, 100, 'minimum_repetitions_for_promotion');
  return policy;
}

export function validateAttackLibrary(library, taxonomy) {
  object(library, 'attack library');
  if (library.schema_version !== 'fae.red-team.library.v0.0.1') fail('unsupported library schema');
  id(library.library_id, 'library.library_id');
  if (!Array.isArray(library.attacks) || library.attacks.length === 0) fail('library.attacks must be non-empty');
  exactKeysUnique(library.attacks, 'id', 'library.attacks');
  const classIds = new Set(taxonomy.classes.map((entry) => entry.id));
  library.attacks.forEach((attack) => validateAttack(attack, classIds));
  return library;
}

export function validateCampaign(campaign) {
  object(campaign, 'campaign');
  if (campaign.schema_version !== 'fae.red-team.campaign.v0.0.1') fail('unsupported campaign schema');
  id(campaign.campaign_id, 'campaign.campaign_id');
  object(campaign.target, 'campaign.target');
  if (campaign.target.kind !== 'git') fail('campaign.target.kind must be git');
  string(campaign.target.root, 'campaign.target.root');
  string(campaign.target.required_ref, 'campaign.target.required_ref');
  if (campaign.target.require_clean !== true) fail('v0.0.1 campaigns require a clean target');
  if (campaign.target.writable !== false) fail('v0.0.1 campaigns require a read-only intent');
  ['taxonomy_path', 'score_policy_path', 'attack_library_path'].forEach((key) => string(campaign[key], 'campaign.' + key));
  if (!Array.isArray(campaign.attack_ids) || campaign.attack_ids.length === 0) fail('campaign.attack_ids must be non-empty');
  campaign.attack_ids.forEach((value, index) => id(value, 'campaign.attack_ids[' + index + ']'));
  if (new Set(campaign.attack_ids).size !== campaign.attack_ids.length) fail('campaign.attack_ids contains duplicates');
  string(campaign.seed, 'campaign.seed');
  integerBetween(campaign.repetitions, 1, 10, 'campaign.repetitions');
  object(campaign.execution, 'campaign.execution');
  if (campaign.execution.order !== 'listed' && campaign.execution.order !== 'seeded') fail('invalid execution order');
  if (campaign.execution.max_parallel !== 1) fail('v0.0.1 execution is serial');
  if (typeof campaign.execution.fail_fast !== 'boolean') fail('campaign.execution.fail_fast must be boolean');
  object(campaign.authority_boundary, 'campaign.authority_boundary');
  for (const key of ['consensus_authority', 'testnet_mutation', 'wallet_keys', 'block_submission']) {
    if (campaign.authority_boundary[key] !== false) fail('authority boundary must keep ' + key + ' false');
  }
  object(campaign.blind, 'campaign.blind');
  if (campaign.blind.expected_answers_available_to_runner !== false) fail('blind answers must be unavailable to runner');
  return campaign;
}

export function isSha256(value) {
  return typeof value === 'string' && SHA256.test(value);
}

export function isGitCommit(value) {
  return typeof value === 'string' && GIT_COMMIT.test(value);
}

export function knownDomains() {
  return new Set(DOMAINS);
}
