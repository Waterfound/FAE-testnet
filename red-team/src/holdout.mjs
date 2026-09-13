import { digestJson, verifyDigest, withDigest } from './canonical.mjs';

function byId(items, name) {
  const map = new Map();
  for (const item of items) {
    if (map.has(item.case_id)) throw new Error(name + ' contains duplicate case ' + item.case_id);
    map.set(item.case_id, item);
  }
  return map;
}

export function createHoldoutCommitments(privateSet) {
  if (!privateSet || !Array.isArray(privateSet.cases) || privateSet.cases.length === 0) {
    throw new Error('Private holdout set must contain cases');
  }
  const cases = privateSet.cases.map((item) => {
    if (!item.expected_private) throw new Error('Private holdout case lacks expected_private');
    if (typeof item.commitment_nonce !== 'string' || item.commitment_nonce.length < 32) {
      throw new Error('Private holdout case requires a secret commitment_nonce of at least 32 characters');
    }
    return {
      case_id: item.case_id,
      domain: item.domain,
      severity: item.severity,
      commitment: digestJson(item),
      input_public: structuredClone(item.input_public)
    };
  });
  byId(cases, 'Commitment set');
  return withDigest({
    schema_version: 'fae.red-team.holdout-commitments.v0.0.1',
    set_id: privateSet.set_id,
    status: 'active',
    cases
  }, 'set_digest');
}

export function createBlindRequest(commitments) {
  if (!verifyDigest(commitments, 'set_digest')) throw new Error('Holdout commitment-set digest mismatch');
  if (commitments.status !== 'active') throw new Error('Blind requests require an active commitment set');
  return {
    schema_version: 'fae.red-team.blind-request.v0.0.1',
    set_id: commitments.set_id,
    cases: commitments.cases.map((item) => ({
      case_id: item.case_id,
      domain: item.domain,
      commitment: item.commitment,
      input_public: structuredClone(item.input_public)
    }))
  };
}

export function scoreHoldoutReveal(commitments, privateSet, submission) {
  if (!verifyDigest(commitments, 'set_digest')) throw new Error('Holdout commitment-set digest mismatch');
  if (commitments.status !== 'active' && commitments.status !== 'retired') {
    throw new Error('Holdout set has invalid status');
  }
  if (privateSet.set_id !== commitments.set_id || submission.set_id !== commitments.set_id) {
    throw new Error('Holdout set IDs do not match');
  }
  const publicById = byId(commitments.cases, 'Commitment set');
  const privateById = byId(privateSet.cases, 'Private set');
  const submissionById = byId(submission.answers, 'Submission');
  const rows = [];
  for (const [caseId, publicCase] of publicById) {
    const privateCase = privateById.get(caseId);
    const answer = submissionById.get(caseId);
    if (!privateCase || digestJson(privateCase) !== publicCase.commitment) {
      throw new Error('Holdout reveal does not match commitment for ' + caseId);
    }
    if (!answer) throw new Error('Submission lacks answer for ' + caseId);
    const expected = privateCase.expected_private.acceptable_verdicts || [];
    rows.push({
      case_id: caseId,
      correct: expected.includes(answer.verdict),
      submitted_verdict: answer.verdict
    });
  }
  if (privateById.size !== publicById.size || submissionById.size !== publicById.size) {
    throw new Error('Holdout reveal or submission has extra cases');
  }
  const correct = rows.filter((row) => row.correct).length;
  return {
    schema_version: 'fae.red-team.holdout-score.v0.0.1',
    set_id: commitments.set_id,
    score: rows.length === 0 ? 0 : correct / rows.length,
    correct,
    total: rows.length,
    rows,
    promotion_allowed: commitments.status === 'retired'
  };
}

export function retireHoldout(commitments, review) {
  if (!verifyDigest(commitments, 'set_digest')) throw new Error('Holdout commitment-set digest mismatch');
  if (commitments.status !== 'active') throw new Error('Only an active holdout can be retired');
  if (!review || review.decision !== 'retire' || typeof review.reviewer !== 'string' || review.reviewer.trim() === '') {
    throw new Error('Explicit retirement review is required');
  }
  const retired = structuredClone(commitments);
  delete retired.set_digest;
  retired.status = 'retired';
  retired.retirement = {
    reviewer: review.reviewer,
    retired_at: review.retired_at || new Date().toISOString(),
    reason: review.reason || 'retired-after-evaluation'
  };
  return withDigest(retired, 'set_digest');
}
