import { digestJson } from './canonical.mjs';

function round(value) {
  return Math.round(value * 1000000) / 1000000;
}

function groupBy(items, key) {
  const groups = new Map();
  for (const item of items) {
    const value = item[key];
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(item);
  }
  return groups;
}

function reproducibilityScore(results) {
  const groups = groupBy(results, 'attack_id');
  let total = 0;
  for (const values of groups.values()) {
    if (values.length === 1) {
      total += 0.5;
      continue;
    }
    const counts = new Map();
    for (const value of values) {
      const signature = digestJson({
        outcome: value.outcome,
        reason: value.reason,
        exit_code: value.evidence.exit_code,
        signal: value.evidence.signal,
        semantic_sha256: value.evidence.semantic_sha256 || null
      });
      counts.set(signature, (counts.get(signature) || 0) + 1);
    }
    total += Math.max(...counts.values()) / values.length;
  }
  return groups.size === 0 ? 0 : total / groups.size;
}

export function scoreRun(results, policy, options = {}) {
  let weightedDefense = 0;
  let weightTotal = 0;
  for (const result of results) {
    if (!Object.prototype.hasOwnProperty.call(policy.outcome_values, result.outcome)) {
      throw new Error('Unknown run outcome: ' + result.outcome);
    }
    const weight = policy.severity_weights[result.severity];
    weightTotal += weight;
    weightedDefense += weight * policy.outcome_values[result.outcome];
  }
  const defense = weightTotal === 0 ? 0 : weightedDefense / weightTotal;
  const evidence = results.length === 0 ? 0 : results.filter((item) => item.evidence_complete).length / results.length;
  const reproducibility = reproducibilityScore(results);
  const uniqueAttacks = new Set(results.map((item) => item.evidence.attack_digest)).size;
  const attackCount = new Set(results.map((item) => item.attack_id)).size;
  const novelty = attackCount === 0 ? 0 : uniqueAttacks / attackCount;
  const total =
    defense * policy.components.defense +
    evidence * policy.components.evidence +
    reproducibility * policy.components.reproducibility +
    novelty * policy.components.novelty;

  let gate = 'HOLD';
  const reasons = [];
  if (results.length === 0) reasons.push('empty_campaign');
  if (options.targetMutated) reasons.push('target_mutated');
  if (results.some((item) => !item.evidence_complete)) reasons.push('evidence_incomplete');
  if (results.some((item) => item.outcome === 'engine_error')) reasons.push('engine_error');
  if (reasons.length > 0) {
    gate = 'INVALID';
  } else if (results.some((item) => item.severity === 'critical' && item.outcome === 'collapsed')) {
    gate = 'COLLAPSE';
    reasons.push('critical_collapse');
  } else if (results.some((item) => item.severity === 'critical' && item.outcome === 'inconclusive')) {
    gate = 'HOLD';
    reasons.push('critical_inconclusive');
  } else {
    reasons.push('research_only_no_activation_authority');
  }
  return {
    gate,
    gate_reasons: [...new Set(reasons)],
    total: round(total),
    components: {
      defense: round(defense),
      evidence: round(evidence),
      reproducibility: round(reproducibility),
      novelty: round(novelty)
    },
    counts: Object.fromEntries(['defended', 'collapsed', 'inconclusive', 'engine_error'].map((outcome) => [
      outcome,
      results.filter((item) => item.outcome === outcome).length
    ]))
  };
}

export function assertScoreMonotonicity(policy) {
  const baseEvidence = {
    target_commit: 'a'.repeat(40),
    attack_digest: 'b'.repeat(64),
    stdout_sha256: 'c'.repeat(64),
    stderr_sha256: 'd'.repeat(64),
    exit_code: 0,
    signal: null,
    duration_ms: 1
  };
  const make = (severity, outcome) => ({
    attack_id: severity + '-' + outcome,
    severity,
    outcome,
    reason: outcome,
    evidence_complete: true,
    evidence: {...baseEvidence, attack_digest: digestJson({ severity, outcome })}
  });
  const defended = scoreRun([make('critical', 'defended')], policy).total;
  const collapsed = scoreRun([make('critical', 'collapsed')], policy);
  if (!(collapsed.total < defended) || collapsed.gate !== 'COLLAPSE') {
    throw new Error('Score policy is not monotonic for critical collapse');
  }
  const lowCollapse = scoreRun([make('low', 'collapsed')], policy).total;
  const criticalCollapse = collapsed.total;
  if (criticalCollapse > lowCollapse) throw new Error('Critical collapse scored better than low collapse');
  const incomplete = make('critical', 'defended');
  incomplete.evidence_complete = false;
  if (scoreRun([incomplete], policy).gate !== 'INVALID') throw new Error('Incomplete evidence did not invalidate score');
  if (scoreRun([], policy).gate !== 'INVALID') throw new Error('Empty campaign did not invalidate score');
  return true;
}
