import { digestJson, verifyDigest, withDigest } from './canonical.mjs';

export function proposeLearning(report) {
  if (!verifyDigest(report, 'report_digest')) throw new Error('Cannot learn from a tampered report');
  const proposals = [];
  for (const result of report.results) {
    if (result.outcome === 'defended') continue;
    const proposal = {
      schema_version: 'fae.red-team.learning-proposal.v0.0.1',
      status: 'proposed',
      source: {
        run_id: report.run_id,
        report_digest: report.report_digest,
        attack_id: result.attack_id,
        attack_digest: result.evidence.attack_digest,
        blind_status: report.blind && report.blind.active_set ? 'active' : 'not-blind'
      },
      classification: {
        domain: result.domain,
        failure_class: result.failure_class,
        severity: result.severity,
        outcome: result.outcome,
        reason: result.reason
      },
      evidence: {
        stdout_sha256: result.evidence.stdout_sha256,
        stderr_sha256: result.evidence.stderr_sha256,
        exit_code: result.evidence.exit_code,
        signal: result.evidence.signal,
        target_commit: result.evidence.target_commit
      },
      reproducibility: {
        required: true,
        confirmed_runs: 1
      },
      automatic_promotion: false
    };
    proposals.push(withDigest(proposal, 'proposal_digest'));
  }
  return proposals;
}

export function promoteLearningProposal(proposal, review, scorePolicy) {
  if (!verifyDigest(proposal, 'proposal_digest')) throw new Error('Learning proposal digest mismatch');
  if (proposal.status !== 'proposed') throw new Error('Only proposed findings may be promoted');
  if (proposal.source.blind_status === 'active') {
    throw new Error('Active blind findings cannot enter regression corpus');
  }
  if (!['not-blind', 'retired'].includes(proposal.source.blind_status)) {
    throw new Error('Only non-blind or retired findings can enter regression corpus');
  }
  if (!review || typeof review.reviewer !== 'string' || review.reviewer.trim() === '') {
    throw new Error('Explicit reviewer identity is required');
  }
  if (review.decision !== 'approve') throw new Error('Promotion review is not approved');
  const confirmedRuns = review.confirmed_runs || proposal.reproducibility.confirmed_runs;
  if (confirmedRuns < scorePolicy.minimum_repetitions_for_promotion) {
    throw new Error('Finding has not met the frozen reproducibility threshold');
  }
  const entry = {
    schema_version: 'fae.red-team.regression-entry.v0.0.1',
    regression_id: 'regression/' + digestJson({
      proposal_digest: proposal.proposal_digest,
      reviewer: review.reviewer,
      confirmed_runs: confirmedRuns
    }).slice(0, 20),
    promoted_from: proposal.proposal_digest,
    reviewer: review.reviewer,
    reviewed_at: review.reviewed_at || new Date().toISOString(),
    confirmed_runs: confirmedRuns,
    classification: structuredClone(proposal.classification),
    evidence: structuredClone(proposal.evidence),
    active_blind_origin: false
  };
  return withDigest(entry, 'entry_digest');
}
