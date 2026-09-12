import { raceProbability, staticCandidate } from './economic-block-time-v2-lab.mjs';

const BASE_TARGET = 300;
const BASE_DELAY = 5;
const BASE_RACE = raceProbability(BASE_DELAY, BASE_TARGET);
const TARGETS = [300, 600, 900];
const ALPHAS = [0, 0.25, 0.5, 0.75, 1];

function maxDelayForRace(targetSeconds, race) {
  return -targetSeconds * Math.log(1 - race);
}

function propagationRow(targetSeconds, alpha) {
  const scale = targetSeconds / BASE_TARGET;
  const delaySeconds = BASE_DELAY * scale ** alpha;
  const race = raceProbability(delaySeconds, targetSeconds);
  return {
    targetSeconds,
    payloadScale: scale,
    propagationScalingExponent: alpha,
    delaySeconds,
    raceProbability: race,
    relativeTo300Race: race / BASE_RACE,
  };
}

function miningVariance(targetSeconds) {
  const c = staticCandidate(targetSeconds);
  const base = staticCandidate(BASE_TARGET);
  const rewardRatio = c.calendarSupplyNeutral.rewardFae / base.calendarSupplyNeutral.rewardFae;
  const blockRateRatio = BASE_TARGET / targetSeconds;
  const relativeMeanPayoutRate = rewardRatio * blockRateRatio;
  const relativeVarianceRate = rewardRatio ** 2 * blockRateRatio;
  return {
    targetSeconds,
    rewardFae: c.calendarSupplyNeutral.rewardFae,
    rewardRatio,
    blockRateRatio,
    relativeMeanPayoutRate,
    relativeVarianceRate,
    relativeStdDevOverFixedHorizon: Math.sqrt(relativeVarianceRate),
    relativeWorkPerBlockAtEqualHashrate: targetSeconds / BASE_TARGET,
    relativeBlocksPerUnitTime: blockRateRatio,
    relativeExpectedWorkPerUnitTime: 1,
  };
}

const propagationSensitivity = TARGETS.flatMap((t) => ALPHAS.map((a) => propagationRow(t, a)));
const empiricalDelayGates = TARGETS.map((targetSeconds) => ({
  targetSeconds,
  breakEvenDelaySeconds: maxDelayForRace(targetSeconds, BASE_RACE),
  delayFor25PctRaceReductionSeconds: maxDelayForRace(targetSeconds, BASE_RACE * 0.75),
  delayFor50PctRaceReductionSeconds: maxDelayForRace(targetSeconds, BASE_RACE * 0.50),
}));

const report = {
  schema: 'fae-economic-block-time-v2-sensitivity/1',
  authority: 'research-only-candidate-not-active-consensus',
  assumptions: {
    baselineTargetSeconds: BASE_TARGET,
    baselinePropagationDelaySeconds: BASE_DELAY,
    baselineRaceProbability: BASE_RACE,
    propagationModel: 'delay = baselineDelay * payloadScale^alpha',
    miningModel: 'Poisson block wins; calendar+supply-neutral reward branch; equal miner hash share',
    workModel: 'equal network hashrate implies expected work/block proportional to target interval and expected work/time invariant',
  },
  propagationSensitivity,
  empiricalDelayGates,
  miningPayoutVariance: TARGETS.map(miningVariance),
  interpretationGuard: {
    keyPropagationGate: 'A longer target earns stale credit only if measured propagation remains below its break-even delay at comparable throughput.',
    keyMiningCost: 'With approximately supply-neutral reward scaling, payout variance over a fixed wall-clock horizon rises with target interval even when expected payout rate stays approximately constant.',
    keySecurityNormalization: 'Compare confirmation security by expected chainwork/time, not raw confirmation count.',
    activationRule: 'L3_REQUIRED_BEFORE_ANY_TESTNET_ACTIVATION',
  },
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
