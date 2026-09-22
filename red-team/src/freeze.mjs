import path from 'node:path';
import { realpath } from 'node:fs/promises';
import { digestJson, readJson, verifyDigest, withDigest } from './canonical.mjs';
import {
  isGitCommit,
  isSha256,
  validateAttack,
  validateAttackLibrary,
  validateCampaign,
  validateScorePolicy,
  validateTaxonomy
} from './contracts.mjs';
import { inspectGitTarget, resolveGitRef } from './git-target.mjs';
import { realInside } from './path-safety.mjs';
import { seededShuffle } from './rng.mjs';

export const ENGINE_VERSION = '0.0.1';
export const LOCK_SCHEMA = 'fae.red-team.lock.v0.0.1';

export async function freezeCampaign(campaignPath, options = {}) {
  const absoluteCampaign = await realpath(path.resolve(campaignPath));
  const packageRoot = await realpath(path.resolve(options.packageRoot || path.dirname(absoluteCampaign), '..'));
  const campaign = validateCampaign(await readJson(absoluteCampaign));
  const taxonomyPath = await realInside(packageRoot, campaign.taxonomy_path);
  const scorePolicyPath = await realInside(packageRoot, campaign.score_policy_path);
  const libraryPath = await realInside(packageRoot, campaign.attack_library_path);
  const taxonomy = validateTaxonomy(await readJson(taxonomyPath));
  const scorePolicy = validateScorePolicy(await readJson(scorePolicyPath));
  const library = validateAttackLibrary(await readJson(libraryPath), taxonomy);

  const targetRoot = await realpath(path.resolve(packageRoot, campaign.target.root));
  const target = await inspectGitTarget(targetRoot);
  if (campaign.target.require_clean && !target.clean) {
    throw new Error('Refusing to freeze a dirty target: ' + target.status_lines.join(', '));
  }
  if (campaign.target.required_ref !== 'CURRENT') {
    const requiredCommit = await resolveGitRef(target.repository_root, campaign.target.required_ref);
    if (requiredCommit !== target.commit) {
      throw new Error('Target HEAD does not match required ref ' + campaign.target.required_ref);
    }
  }

  const byId = new Map(library.attacks.map((attack) => [attack.id, attack]));
  const missing = campaign.attack_ids.filter((attackId) => !byId.has(attackId));
  if (missing.length > 0) throw new Error('Campaign references missing attacks: ' + missing.join(', '));
  let resolvedAttacks = campaign.attack_ids.map((attackId) => {
    const attack = structuredClone(byId.get(attackId));
    attack.attack_digest = digestJson(attack);
    return attack;
  });
  if (campaign.execution.order === 'seeded') {
    resolvedAttacks = seededShuffle(resolvedAttacks, campaign.seed);
  }

  const lock = {
    schema_version: LOCK_SCHEMA,
    engine_version: ENGINE_VERSION,
    frozen_at: options.now || new Date().toISOString(),
    campaign: {
      campaign_id: campaign.campaign_id,
      title: campaign.title,
      seed: campaign.seed,
      repetitions: campaign.repetitions,
      execution: campaign.execution,
      exclusions: campaign.exclusions || []
    },
    target: {
      kind: 'git',
      label: campaign.target.label || 'fae-target',
      git_commit: target.commit,
      require_clean: true,
      writable: false
    },
    authority_boundary: structuredClone(campaign.authority_boundary),
    blind: structuredClone(campaign.blind),
    taxonomy,
    score_policy: scorePolicy,
    attacks: resolvedAttacks,
    source_digests: {
      campaign: digestJson(campaign),
      taxonomy: digestJson(taxonomy),
      score_policy: digestJson(scorePolicy),
      attack_library: digestJson(library)
    }
  };
  return withDigest(lock, 'lock_digest');
}

export function verifyFrozenLock(lock) {
  if (!lock || lock.schema_version !== LOCK_SCHEMA) throw new Error('Unsupported frozen-lock schema');
  if (lock.engine_version !== ENGINE_VERSION) throw new Error('Frozen lock targets another engine version');
  if (!verifyDigest(lock, 'lock_digest')) throw new Error('Frozen-lock digest mismatch');
  if (!isGitCommit(lock.target && lock.target.git_commit)) throw new Error('Frozen lock has invalid target commit');
  if (lock.target.require_clean !== true || lock.target.writable !== false) throw new Error('Frozen target boundary is unsafe');
  for (const key of ['consensus_authority', 'testnet_mutation', 'wallet_keys', 'block_submission']) {
    if (!lock.authority_boundary || lock.authority_boundary[key] !== false) {
      throw new Error('Frozen authority boundary changed: ' + key);
    }
  }
  if (!lock.blind || lock.blind.expected_answers_available_to_runner !== false) {
    throw new Error('Frozen blind boundary exposes expected answers');
  }
  for (const [name, digest] of Object.entries(lock.source_digests || {})) {
    if (!isSha256(digest)) throw new Error('Invalid source digest: ' + name);
  }
  validateTaxonomy(lock.taxonomy);
  validateScorePolicy(lock.score_policy);
  const classIds = new Set(lock.taxonomy.classes.map((entry) => entry.id));
  const ids = new Set();
  for (const attack of lock.attacks || []) {
    if (ids.has(attack.id)) throw new Error('Frozen lock contains duplicate attack ' + attack.id);
    ids.add(attack.id);
    const copy = structuredClone(attack);
    const digest = copy.attack_digest;
    delete copy.attack_digest;
    if (!isSha256(digest) || digest !== digestJson(copy)) throw new Error('Attack digest mismatch: ' + attack.id);
    validateAttack(copy, classIds);
  }
  if (ids.size === 0) throw new Error('Frozen lock contains no attacks');
  return true;
}
