import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ALLOWED_TARGETS = new Set([300, 600, 900]);
const Z95 = 1.959963984540054;

export function raceProbability(delaySeconds, targetSeconds) {
  return 1 - Math.exp(-delaySeconds / targetSeconds);
}

export function wilsonUpper95(successes, trials) {
  if (!Number.isInteger(successes) || !Number.isInteger(trials) || successes < 0 || trials <= 0 || successes > trials) {
    throw new Error('invalid binomial sample');
  }
  const p = successes / trials;
  const z2 = Z95 ** 2;
  const denom = 1 + z2 / trials;
  const center = p + z2 / (2 * trials);
  const margin = Z95 * Math.sqrt((p * (1 - p) + z2 / (4 * trials)) / trials);
  return (center + margin) / denom;
}

function finitePositive(value, label) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be finite and > 0`);
}

function validateRun(run, label) {
  if (!run || typeof run !== 'object') throw new Error(`${label} missing`);
  if (!ALLOWED_TARGETS.has(run.targetSeconds)) throw new Error(`${label}.targetSeconds invalid`);
  if (!Number.isInteger(run.nodeCount) || run.nodeCount < 3) throw new Error(`${label}.nodeCount must be >= 3`);
  if (!Number.isInteger(run.regionCount) || run.regionCount < 2) throw new Error(`${label}.regionCount must be >= 2`);
  if (!Number.isInteger(run.propagationSamples) || run.propagationSamples < 500) throw new Error(`${label}.propagationSamples must be >= 500`);
  if (typeof run.payloadPolicyId !== 'string' || run.payloadPolicyId.length < 1) throw new Error(`${label}.payloadPolicyId missing`);
  finitePositive(run.nominalTps, `${label}.nominalTps`);

  const p = run.propagationSeconds;
  if (!p || typeof p !== 'object') throw new Error(`${label}.propagationSeconds missing`);
  finitePositive(p.median, `${label}.propagationSeconds.median`);
  finitePositive(p.mean, `${label}.propagationSeconds.mean`);
  finitePositive(p.p95, `${label}.propagationSeconds.p95`);
  if (p.median > p.p95 || p.mean > p.p95 * 2) throw new Error(`${label}.propagationSeconds inconsistent`);

  for (const phase of ['steady', 'stress']) {
    const s = run[phase];
    if (!s || typeof s !== 'object') throw new Error(`${label}.${phase} missing`);
    if (!Number.isInteger(s.blocks) || s.blocks < 1) throw new Error(`${label}.${phase}.blocks invalid`);
    if (!Number.isInteger(s.staleBlocks) || s.staleBlocks < 0 || s.staleBlocks > s.blocks) {
      throw new Error(`${label}.${phase}.staleBlocks invalid`);
    }
  }
}

function absoluteReadiness(run) {
  const steadyUpper95 = wilsonUpper95(run.steady.staleBlocks, run.steady.blocks);
  const stressUpper95 = wilsonUpper95(run.stress.staleBlocks, run.stress.blocks);
  const propagation = {
    medianUnder1s: run.propagationSeconds.median < 1,
    meanUnder2s: run.propagationSeconds.mean < 2,
    p95Under5s: run.propagationSeconds.p95 < 5,
  };
  const stale = {
    steadyUpper95,
    stressUpper95,
    steadyUnder1Pct95: steadyUpper95 < 0.01,
    stressUnder2Pct95: stressUpper95 < 0.02,
  };
  return {
    propagation,
    stale,
    pass: Object.values(propagation).every(Boolean) && stale.steadyUnder1Pct95 && stale.stressUnder2Pct95,
  };
}

export function evaluateEvidenceBundle(bundle) {
  if (!bundle || typeof bundle !== 'object') throw new Error('bundle missing');
  if (bundle.schema !== 'fae-economic-block-time-v2-measurement/1') throw new Error('schema mismatch');
  if (typeof bundle.harnessCommit !== 'string' || !/^[0-9a-f]{40}$/.test(bundle.harnessCommit)) {
    throw new Error('harnessCommit must be a 40-character lowercase git SHA');
  }
  if (typeof bundle.environmentId !== 'string' || bundle.environmentId.length < 1) throw new Error('environmentId missing');

  validateRun(bundle.baseline, 'baseline');
  validateRun(bundle.candidate, 'candidate');
  if (bundle.baseline.targetSeconds !== 300) throw new Error('baseline target must be 300 seconds');
  if (![600, 900].includes(bundle.candidate.targetSeconds)) throw new Error('candidate target must be 600 or 900 seconds');
  if (bundle.baseline.payloadPolicyId !== bundle.candidate.payloadPolicyId) throw new Error('payload policy mismatch');

  const tpsRatio = bundle.candidate.nominalTps / bundle.baseline.nominalTps;
  const throughputComparable = tpsRatio >= 0.95 && tpsRatio <= 1.05;
  const baselineReadiness = absoluteReadiness(bundle.baseline);
  const candidateReadiness = absoluteReadiness(bundle.candidate);

  const baseP95Race = raceProbability(bundle.baseline.propagationSeconds.p95, bundle.baseline.targetSeconds);
  const candidateP95Race = raceProbability(bundle.candidate.propagationSeconds.p95, bundle.candidate.targetSeconds);
  const raceRatio = candidateP95Race / baseP95Race;
  const comparativeAdvantage = {
    baselineP95RaceProbability: baseP95Race,
    candidateP95RaceProbability: candidateP95Race,
    candidateToBaselineRaceRatio: raceRatio,
    atLeast25PctLowerP95Race: raceRatio <= 0.75,
    atLeast50PctLowerP95Race: raceRatio <= 0.50,
  };

  const evidencePass = throughputComparable && baselineReadiness.pass && candidateReadiness.pass && comparativeAdvantage.atLeast25PctLowerP95Race;

  return {
    schema: 'fae-economic-block-time-v2-evidence-evaluation/1',
    authority: 'evidence-only-no-consensus-authority',
    harnessCommit: bundle.harnessCommit,
    environmentId: bundle.environmentId,
    baselineTargetSeconds: 300,
    candidateTargetSeconds: bundle.candidate.targetSeconds,
    admission: {
      minimumNodesPerRun: 3,
      minimumRegionsPerRun: 2,
      minimumPropagationSamplesPerRun: 500,
      payloadPolicyMatched: true,
      throughputRatio: tpsRatio,
      throughputComparable,
    },
    baselineReadiness,
    candidateReadiness,
    comparativeAdvantage,
    l2NetworkPromotionEvidencePass: evidencePass,
    selectionAuthorized: false,
    activationAuthorized: false,
    nextBoundary: evidencePass
      ? 'May be considered with the rest of L2 evidence; candidate selection still requires an explicit decision. L3 is mandatory before any testnet activation.'
      : 'Remain in L2 research; do not select or activate this challenger.',
  };
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] === thisFile) {
  const path = process.argv[2];
  if (!path) {
    console.error('usage: node economic-block-time-v2-evidence-gate.mjs <measurement.json>');
    process.exit(2);
  }
  try {
    const bundle = JSON.parse(fs.readFileSync(path, 'utf8'));
    process.stdout.write(`${JSON.stringify(evaluateEvidenceBundle(bundle), null, 2)}\n`);
  } catch (error) {
    console.error(`evidence gate: FAIL-CLOSED: ${error.message}`);
    process.exit(1);
  }
}
