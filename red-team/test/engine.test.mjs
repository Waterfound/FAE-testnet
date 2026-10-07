import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { canonicalize, digestJson, verifyDigest, withDigest } from '../src/canonical.mjs';
import { validateAttack } from '../src/contracts.mjs';
import { executeAttack } from '../src/executor.mjs';
import { freezeCampaign, verifyFrozenLock } from '../src/freeze.mjs';
import { validateGenealogy } from '../src/genealogy.mjs';
import { createHoldoutCommitments, createBlindRequest, retireHoldout, scoreHoldoutReveal } from '../src/holdout.mjs';
import { promoteLearningProposal, proposeLearning } from '../src/learning.mjs';
import { buildLedgerEvent, verifyLedger } from '../src/ledger.mjs';
import { runMetaRedTeam } from '../src/meta.mjs';
import { mutateAttack } from '../src/mutation.mjs';
import { lexicalInside } from '../src/path-safety.mjs';
import { scoreRun } from '../src/scoring.mjs';
import { readJson } from '../src/canonical.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(packageRoot, '..');

function rootAttack() {
  return {
    schema_version: 'fae.red-team.attack.v0.0.1',
    id: 'meta/test-root',
    version: '0.0.1',
    title: 'Mutation root',
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
    payload: { height: 10, enabled: true, peers: ['one'] },
    lineage: { parent_id: null, generation: 0 }
  };
}

test('canonical JSON is key-order invariant and rejects non-finite values', () => {
  assert.equal(canonicalize({ b: 2, a: 1 }), canonicalize({ a: 1, b: 2 }));
  assert.equal(digestJson({ b: 2, a: 1 }), digestJson({ a: 1, b: 2 }));
  assert.throws(() => canonicalize({ value: Number.NaN }), /non-finite/);
  assert.throws(() => canonicalize({ constructor: 'pollute' }), /forbidden key/);
});

test('freeze binds a complete immutable lock to the clean target commit', async () => {
  const campaign = path.join(packageRoot, 'campaigns', 'fae-regression-smoke.v0.0.1.json');
  const first = await freezeCampaign(campaign, { now: '2026-09-12T00:00:00.000Z' });
  const second = await freezeCampaign(campaign, { now: '2026-09-12T00:00:00.000Z' });
  assert.equal(first.lock_digest, second.lock_digest);
  assert.equal(first.target.writable, false);
  assert.equal(first.authority_boundary.consensus_authority, false);
  assert.equal(first.attacks.length, 8);
  assert.equal(verifyFrozenLock(first), true);
  assert.equal(JSON.stringify(first).includes(repositoryRoot), false, 'lock must not contain host-specific absolute path');
  const tampered = structuredClone(first);
  tampered.campaign.seed = 'post-hoc-edit';
  assert.throws(() => verifyFrozenLock(tampered), /digest mismatch/);
});

test('contracts reject shell and eval execution surfaces', () => {
  const attack = rootAttack();
  attack.executor.argv = ['node', '--eval', 'process.exit(0)'];
  assert.throws(() => validateAttack(attack, new Set(['RED_TEAM_PROCESS_FAILURE'])), /dynamic node/);
  attack.executor.argv = ['sh', '-c', 'true'];
  assert.throws(() => validateAttack(attack, new Set(['RED_TEAM_PROCESS_FAILURE'])), /allowlisted/);
  attack.executor.argv = ['node', '--require', 'malicious-module', 'safe.mjs'];
  assert.throws(() => validateAttack(attack, new Set(['RED_TEAM_PROCESS_FAILURE'])), /dynamic node/);
  attack.executor.argv = ['node', '../outside.mjs'];
  assert.throws(() => validateAttack(attack, new Set(['RED_TEAM_PROCESS_FAILURE'])), /traversing/);
});

test('path safety rejects traversal outside the target', () => {
  assert.equal(lexicalInside(repositoryRoot, 'red-team'), packageRoot);
  assert.throws(() => lexicalInside(repositoryRoot, '..'), /escapes trusted root/);
});

test('defensive process execution is bounded, offline-intent and evidence hashed', async () => {
  const attack = rootAttack();
  attack.id = 'meta/fixture-defense';
  attack.executor.argv = ['node', 'test/fixtures/defense.mjs'];
  attack.executor.cwd = 'red-team';
  attack.attack_digest = digestJson(attack);
  attack.evidence_requirements = ['target_commit', 'attack_digest', 'stdout_sha256', 'stderr_sha256', 'exit_code', 'duration_ms'];
  const result = await executeAttack(attack, {
    targetRoot: repositoryRoot,
    targetCommit: 'a'.repeat(40),
    seed: 'test-seed',
    repetition: 1
  });
  assert.equal(result.outcome, 'defended');
  assert.equal(result.evidence_complete, true);
  assert.equal(result.stdout_excerpt, null, 'raw process output must not be copied into reports');
  assert.match(result.evidence.stdout_sha256, /^[a-f0-9]{64}$/);
});

test('payload stdin, timeout and combined output bounds are enforced', async () => {
  const payloadAttack = rootAttack();
  payloadAttack.id = 'meta/payload-defense';
  payloadAttack.executor.argv = ['node', 'test/fixtures/payload-defense.mjs'];
  payloadAttack.executor.cwd = 'red-team';
  payloadAttack.executor.stdin = 'payload-json';
  payloadAttack.attack_digest = digestJson(payloadAttack);
  const payloadResult = await executeAttack(payloadAttack, {
    targetRoot: repositoryRoot,
    targetCommit: 'a'.repeat(40),
    seed: 'test-seed',
    repetition: 1
  });
  assert.equal(payloadResult.outcome, 'defended');

  const floodAttack = rootAttack();
  floodAttack.id = 'meta/output-flood';
  floodAttack.executor.argv = ['node', 'test/fixtures/output-flood.mjs'];
  floodAttack.executor.cwd = 'red-team';
  floodAttack.executor.max_output_bytes = 1024;
  floodAttack.attack_digest = digestJson(floodAttack);
  const floodResult = await executeAttack(floodAttack, {
    targetRoot: repositoryRoot,
    targetCommit: 'a'.repeat(40),
    seed: 'test-seed',
    repetition: 1
  });
  assert.equal(floodResult.outcome, 'engine_error');
  assert.equal(floodResult.reason, 'output_limit');

  const hangAttack = rootAttack();
  hangAttack.id = 'meta/timeout';
  hangAttack.executor.argv = ['node', 'test/fixtures/hang.mjs'];
  hangAttack.executor.cwd = 'red-team';
  hangAttack.executor.timeout_ms = 100;
  hangAttack.attack_digest = digestJson(hangAttack);
  const hangResult = await executeAttack(hangAttack, {
    targetRoot: repositoryRoot,
    targetCommit: 'a'.repeat(40),
    seed: 'test-seed',
    repetition: 1
  });
  assert.equal(hangResult.outcome, 'inconclusive');
  assert.equal(hangResult.reason, 'timeout');
});

test('seeded mutations are deterministic and preserve an acyclic genealogy', () => {
  const descriptors = [
    { operator: 'boundary-number', path: '/payload/height', values: [-1, 0, 1] },
    { operator: 'flip-boolean', path: '/payload/enabled' },
    { operator: 'duplicate-array-element', path: '/payload/peers' }
  ];
  const first = mutateAttack(rootAttack(), descriptors, { seed: 'same-seed', count: 3 });
  const second = mutateAttack(rootAttack(), descriptors, { seed: 'same-seed', count: 3 });
  assert.deepEqual(first, second);
  assert.equal(validateGenealogy([rootAttack(), ...first]), true);
  const cyclicRoot = rootAttack();
  cyclicRoot.lineage = { parent_id: 'meta/test-child', generation: 1, mutation: { operator: 'x' } };
  const cyclicChild = rootAttack();
  cyclicChild.id = 'meta/test-child';
  cyclicChild.lineage = { parent_id: cyclicRoot.id, generation: 2, mutation: { operator: 'x' } };
  assert.throws(() => validateGenealogy([cyclicRoot, cyclicChild]), /cycle/);
  assert.throws(() => mutateAttack(rootAttack(), [{ operator: 'nullify', path: '/executor/cwd' }]), /only the attack payload/);
  const blindRoot = rootAttack();
  blindRoot.blind_status = 'active';
  assert.throws(() => mutateAttack(blindRoot, descriptors), /Active blind/);
});

test('score gate cannot average away a critical collapse', async () => {
  const policy = await readJson(path.join(packageRoot, 'policies', 'score-policy.v0.0.1.json'));
  const evidence = {
    target_commit: 'a'.repeat(40),
    attack_digest: 'b'.repeat(64),
    stdout_sha256: 'c'.repeat(64),
    stderr_sha256: 'd'.repeat(64),
    exit_code: 1,
    signal: null,
    duration_ms: 1
  };
  const results = [
    { attack_id: 'critical-one', severity: 'critical', outcome: 'collapsed', reason: 'nonzero_exit', evidence_complete: true, evidence },
    ...Array.from({ length: 20 }, (_, index) => ({
      attack_id: 'low-' + index,
      severity: 'low',
      outcome: 'defended',
      reason: 'ok',
      evidence_complete: true,
      evidence: { ...evidence, attack_digest: digestJson({ index }), exit_code: 0 }
    }))
  ];
  const score = scoreRun(results, policy);
  assert.equal(score.gate, 'COLLAPSE');
  assert.ok(score.total > 0.5, 'test must prove a superficially high total still collapses');
});

test('blind request excludes expected answers and active holdouts cannot promote', async () => {
  const privateSet = {
    set_id: 'private-test',
    cases: [{
      case_id: 'case-001',
      domain: 'consensus',
      severity: 'critical',
      input_public: { vector: 'opaque' },
      commitment_nonce: '0123456789abcdef0123456789abcdef',
      expected_private: { acceptable_verdicts: ['collapsed'] }
    }]
  };
  const commitments = createHoldoutCommitments(privateSet);
  assert.equal(verifyDigest(commitments, 'set_digest'), true);
  const request = createBlindRequest(commitments);
  assert.equal(JSON.stringify(request).includes('expected_private'), false);
  assert.equal(JSON.stringify(request).includes('collapsed'), false);
  const score = scoreHoldoutReveal(commitments, privateSet, {
    set_id: 'private-test',
    answers: [{ case_id: 'case-001', verdict: 'collapsed' }]
  });
  assert.equal(score.score, 1);
  assert.equal(score.promotion_allowed, false);
  const retired = retireHoldout(commitments, {
    reviewer: 'independent-reviewer',
    decision: 'retire',
    retired_at: '2026-09-12T00:00:00.000Z'
  });
  assert.equal(retired.status, 'retired');
  assert.equal(verifyDigest(retired, 'set_digest'), true);
  const retiredScore = scoreHoldoutReveal(retired, privateSet, {
    set_id: 'private-test',
    answers: [{ case_id: 'case-001', verdict: 'collapsed' }]
  });
  assert.equal(retiredScore.promotion_allowed, true);
  const tamperedCommitments = structuredClone(commitments);
  tamperedCommitments.cases[0].domain = 'p2p';
  assert.throws(() => createBlindRequest(tamperedCommitments), /digest mismatch/);

  const proposal = withDigest({
    schema_version: 'fae.red-team.learning-proposal.v0.0.1',
    status: 'proposed',
    source: { blind_status: 'active' },
    classification: {},
    evidence: {},
    reproducibility: { confirmed_runs: 3 }
  }, 'proposal_digest');
  const policy = await readJson(path.join(packageRoot, 'policies', 'score-policy.v0.0.1.json'));
  assert.throws(() => promoteLearningProposal(proposal, { reviewer: 'reviewer', decision: 'approve', confirmed_runs: 3 }, policy), /Active blind/);
});

test('learning is proposal-only and ledger tampering is detected', () => {
  const report = withDigest({
    schema_version: 'fae.red-team.report.v0.0.1',
    run_id: 'run-one',
    results: [{
      attack_id: 'fae/test',
      domain: 'meta',
      failure_class: 'RED_TEAM_PROCESS_FAILURE',
      severity: 'critical',
      outcome: 'collapsed',
      reason: 'nonzero_exit',
      evidence: {
        attack_digest: 'a'.repeat(64),
        stdout_sha256: 'b'.repeat(64),
        stderr_sha256: 'c'.repeat(64),
        exit_code: 1,
        signal: null,
        target_commit: 'd'.repeat(40)
      }
    }]
  }, 'report_digest');
  const proposals = proposeLearning(report);
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].automatic_promotion, false);
  assert.equal(verifyDigest(proposals[0], 'proposal_digest'), true);

  const first = buildLedgerEvent({ proposal: proposals[0] }, null, { sequence: 1, now: '2026-09-12T00:00:00.000Z' });
  const second = buildLedgerEvent({ decision: 'review' }, first.event_hash, { sequence: 2, now: '2026-09-12T00:01:00.000Z' });
  assert.equal(verifyLedger([first, second]), true);
  second.payload.decision = 'silently-changed';
  assert.throws(() => verifyLedger([first, second]), /digest mismatch/);
});

test('meta-red-team attacks the engine boundary and remains non-authoritative', async () => {
  const report = await runMetaRedTeam({ root: packageRoot });
  assert.equal(report.gate, 'HOLD');
  assert.equal(report.checks.every((item) => item.status === 'ok'), true, JSON.stringify(report));
});
