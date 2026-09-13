import {
  asertTargetCandidate,
  candidateNextTarget as baseCandidateNextTarget,
  medianTimePast,
  validateCandidateTimestamp,
  targetFromHex,
  targetHex,
  hashMeetsTarget,
  POW_LIMIT,
  MAX_HASH,
} from '../authoritative/difficulty-timestamp-candidate.mjs';

export const DAA_V2_300 = Object.freeze({
  authority: 'candidate-not-active-consensus',
  targetSeconds: 300,
  halfLifeSeconds: 6 * 60 * 60,
  mtpWindow: 11,
  futureDriftMs: 90_000,
  targetRepresentation: 'uint256-full-target',
  arithmetic: 'integer-only',
  powLimit: POW_LIMIT,
});

export { medianTimePast, targetFromHex, targetHex, hashMeetsTarget, POW_LIMIT, MAX_HASH };

export function asertTarget300({
  anchorTarget,
  anchorHeight,
  anchorParentTimeSeconds,
  evaluationHeight,
  evaluationTimeSeconds,
  halfLifeSeconds = DAA_V2_300.halfLifeSeconds,
  powLimit = DAA_V2_300.powLimit,
}) {
  return asertTargetCandidate({
    anchorTarget,
    anchorHeight,
    anchorParentTimeSeconds,
    evaluationHeight,
    evaluationTimeSeconds,
    targetSeconds: DAA_V2_300.targetSeconds,
    halfLifeSeconds,
    powLimit,
  });
}

export function candidateNextTarget300(chain, { anchor, halfLifeSeconds = DAA_V2_300.halfLifeSeconds, powLimit = DAA_V2_300.powLimit } = {}) {
  return baseCandidateNextTarget(chain, {
    anchor,
    targetSeconds: DAA_V2_300.targetSeconds,
    halfLifeSeconds,
    powLimit,
  });
}

export function validateTimestamp300(chain, timestampMs, { nowMs = Date.now() } = {}) {
  return validateCandidateTimestamp(chain, timestampMs, {
    nowMs,
    window: DAA_V2_300.mtpWindow,
    futureDriftMs: DAA_V2_300.futureDriftMs,
  });
}

export function daa300Manifest() {
  return {
    authority: DAA_V2_300.authority,
    targetSeconds: DAA_V2_300.targetSeconds,
    halfLifeSeconds: DAA_V2_300.halfLifeSeconds,
    mtpWindow: DAA_V2_300.mtpWindow,
    futureDriftMs: DAA_V2_300.futureDriftMs,
    targetRepresentation: DAA_V2_300.targetRepresentation,
    arithmetic: DAA_V2_300.arithmetic,
    activationAuthorized: false,
  };
}
