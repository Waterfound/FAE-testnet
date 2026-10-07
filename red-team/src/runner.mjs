import { digestJson, withDigest } from './canonical.mjs';
import { executeAttack } from './executor.mjs';
import { inspectGitTarget } from './git-target.mjs';
import { scoreRun } from './scoring.mjs';
import { verifyFrozenLock } from './freeze.mjs';

export const REPORT_SCHEMA = 'fae.red-team.report.v0.0.1';

export async function runFrozenCampaign(lock, options) {
  verifyFrozenLock(lock);
  const before = await inspectGitTarget(options.targetRoot);
  if (!before.clean) throw new Error('Refusing to run against a dirty target');
  if (before.commit !== lock.target.git_commit) {
    throw new Error('Target drift: frozen ' + lock.target.git_commit + ', current ' + before.commit);
  }
  const startedAt = options.now || new Date().toISOString();
  const results = [];
  let stop = false;
  for (const attack of lock.attacks) {
    for (let repetition = 1; repetition <= lock.campaign.repetitions; repetition += 1) {
      const result = await executeAttack(attack, {
        targetRoot: before.repository_root,
        targetCommit: before.commit,
        seed: lock.campaign.seed,
        repetition
      });
      results.push(result);
      const checkpoint = await inspectGitTarget(before.repository_root);
      if (!checkpoint.clean || checkpoint.commit !== before.commit) {
        result.outcome = 'engine_error';
        result.reason = 'target_mutated_during_attack';
        result.evidence_complete = false;
        result.evidence.semantic_sha256 = digestJson({
          outcome: result.outcome,
          reason: result.reason,
          exit_code: result.evidence.exit_code,
          signal: result.evidence.signal
        });
        stop = true;
        break;
      }
      if (lock.campaign.execution.fail_fast && result.outcome !== 'defended') {
        stop = true;
        break;
      }
    }
    if (stop) break;
  }
  const after = await inspectGitTarget(before.repository_root);
  const targetMutated = !after.clean || after.commit !== before.commit;
  const score = scoreRun(results, lock.score_policy, { targetMutated });
  const report = {
    schema_version: REPORT_SCHEMA,
    engine_version: lock.engine_version,
    run_id: digestJson({ lock_digest: lock.lock_digest, started_at: startedAt }).slice(0, 24),
    lock_digest: lock.lock_digest,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    target: {
      git_commit_before: before.commit,
      git_commit_after: after.commit,
      clean_before: before.clean,
      clean_after: after.clean,
      mutated: targetMutated
    },
    authority_boundary: structuredClone(lock.authority_boundary),
    blind: structuredClone(lock.blind),
    results,
    score
  };
  return withDigest(report, 'report_digest');
}
