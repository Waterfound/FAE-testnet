const BASE = Object.freeze({
  targetSeconds: 300,
  rewardFae: 14,
  halvingBlocks: 430_000,
  maturityBlocks: 200,
  maxTxPerBlock: 20,
  daaHalfLifeSeconds: 6 * 3600,
  confirmationsReference: 6,
});

const CANDIDATES = Object.freeze([300, 600, 900]);
const SECONDS_PER_YEAR = 365.2425 * 24 * 3600;

export function theoreticalSupply(rewardFae, halvingBlocks) {
  return 2 * rewardFae * halvingBlocks;
}

export const BASE_SUPPLY_FAE = theoreticalSupply(BASE.rewardFae, BASE.halvingBlocks);

export function raceProbability(delaySeconds, targetSeconds) {
  return 1 - Math.exp(-delaySeconds / targetSeconds);
}

export function yearsForBlocks(blocks, targetSeconds) {
  return (blocks * targetSeconds) / SECONDS_PER_YEAR;
}

export function staticCandidate(targetSeconds) {
  const scale = targetSeconds / BASE.targetSeconds;
  const blocksPerYear = SECONDS_PER_YEAR / targetSeconds;
  const heightFrozen = {
    rewardFae: BASE.rewardFae,
    halvingBlocks: BASE.halvingBlocks,
    halvingYears: yearsForBlocks(BASE.halvingBlocks, targetSeconds),
    maxSupplyFae: BASE_SUPPLY_FAE,
    firstEraIssuanceFaePerYear: blocksPerYear * BASE.rewardFae,
    maturityBlocks: BASE.maturityBlocks,
    maturityHours: (BASE.maturityBlocks * targetSeconds) / 3600,
    maxTxPerBlock: BASE.maxTxPerBlock,
    nominalTps: BASE.maxTxPerBlock / targetSeconds,
  };

  const calendarHalvingBlocks = Math.max(1, Math.round(BASE.halvingBlocks / scale));
  const calendarNeutralRewardFrozen = {
    rewardFae: BASE.rewardFae,
    halvingBlocks: calendarHalvingBlocks,
    halvingYears: yearsForBlocks(calendarHalvingBlocks, targetSeconds),
    maxSupplyFae: theoreticalSupply(BASE.rewardFae, calendarHalvingBlocks),
  };

  const supplyNeutralRewardFae = BASE_SUPPLY_FAE / (2 * calendarHalvingBlocks);
  const calendarSupplyNeutral = {
    rewardFae: supplyNeutralRewardFae,
    halvingBlocks: calendarHalvingBlocks,
    halvingYears: yearsForBlocks(calendarHalvingBlocks, targetSeconds),
    maxSupplyFae: theoreticalSupply(supplyNeutralRewardFae, calendarHalvingBlocks),
  };

  const wallClockMaturityBlocks = Math.max(1, Math.round((BASE.maturityBlocks * BASE.targetSeconds) / targetSeconds));
  const throughputNeutralMaxTx = Math.max(1, Math.round(BASE.maxTxPerBlock * scale));
  const timeNeutralConfirmations = Math.max(1, Math.round((BASE.confirmationsReference * BASE.targetSeconds) / targetSeconds));

  const baseDelaySeconds = 5;
  const fixedPayloadRace = raceProbability(baseDelaySeconds, targetSeconds);
  const throughputScaledDelay = baseDelaySeconds * (throughputNeutralMaxTx / BASE.maxTxPerBlock);
  const throughputNeutralRace = raceProbability(throughputScaledDelay, targetSeconds);

  return {
    targetSeconds,
    scale,
    blocksPerYear,
    daaObservationsPerSixHourHalfLife: BASE.daaHalfLifeSeconds / targetSeconds,
    heightFrozen,
    calendarNeutralRewardFrozen,
    calendarSupplyNeutral,
    wallClockNeutral: {
      maturityBlocks: wallClockMaturityBlocks,
      maturityHours: (wallClockMaturityBlocks * targetSeconds) / 3600,
      maxTxPerBlock: throughputNeutralMaxTx,
      nominalTps: throughputNeutralMaxTx / targetSeconds,
      confirmationsForBaselineThirtyMinutes: timeNeutralConfirmations,
      confirmationMinutes: (timeNeutralConfirmations * targetSeconds) / 60,
    },
    staleProxy: {
      propagationDelaySeconds: baseDelaySeconds,
      fixedPayloadRaceProbability: fixedPayloadRace,
      throughputNeutralPropagationDelaySeconds: throughputScaledDelay,
      throughputNeutralRaceProbability: throughputNeutralRace,
    },
  };
}

function xorshift32(seed) {
  let x = seed >>> 0;
  if (x === 0) x = 0x9e3779b9;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 0x1_0000_0000;
  };
}

function expSample(mean, rnd) {
  const u = Math.max(Number.EPSILON, 1 - rnd());
  return -Math.log(u) * mean;
}

function hashRatioAt(elapsedSeconds, scenario) {
  const shockAt = 12 * 3600;
  if (scenario === 'stable') return 1;
  if (scenario === 'loss80') return elapsedSeconds < shockAt ? 1 : 0.2;
  if (scenario === 'gain80') return elapsedSeconds < shockAt ? 1 : 1.8;
  if (scenario === 'browserCycle') {
    const hour = (elapsedSeconds % 86400) / 3600;
    if (hour < 8) return 0.45;
    if (hour < 18) return 1.4;
    return 1.0666666666666667;
  }
  throw new Error(`unknown scenario: ${scenario}`);
}

function quantile(sorted, q) {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  const w = pos - lo;
  return sorted[lo] * (1 - w) + sorted[hi] * w;
}

function mean(values) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stdev(values) {
  const m = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
}

export function simulateAsertProxy({
  targetSeconds,
  halfLifeSeconds = BASE.daaHalfLifeSeconds,
  scenario = 'stable',
  durationSeconds = 7 * 86400,
  seed = 1,
}) {
  const rnd = xorshift32(seed);
  const intervals = [];
  const log2Targets = [];
  let elapsed = 0;
  let blocks = 0;
  let targetFactor = 1;
  let recoverySeconds = null;
  const shockAt = 12 * 3600;

  while (elapsed < durationSeconds) {
    const h = hashRatioAt(elapsed, scenario);
    const expectedInterval = targetSeconds / (h * targetFactor);
    const dt = expSample(expectedInterval, rnd);
    elapsed += dt;
    if (elapsed > durationSeconds) break;

    intervals.push(dt);
    blocks += 1;

    // Research proxy only: continuous anchored-ASERT response.
    // Consensus implementation remains integer-only and separately gated.
    const exponent = (elapsed - blocks * targetSeconds) / halfLifeSeconds;
    targetFactor = 2 ** Math.max(-20, Math.min(20, exponent));
    log2Targets.push(Math.log2(targetFactor));

    if (recoverySeconds === null && elapsed >= shockAt) {
      if (scenario === 'loss80') {
        const postShockExpected = targetSeconds / (0.2 * targetFactor);
        if (postShockExpected <= 2 * targetSeconds) recoverySeconds = elapsed - shockAt;
      } else if (scenario === 'gain80') {
        const postShockExpected = targetSeconds / (1.8 * targetFactor);
        if (postShockExpected >= 0.5 * targetSeconds) recoverySeconds = elapsed - shockAt;
      }
    }
  }

  const sortedIntervals = [...intervals].sort((a, b) => a - b);
  return {
    targetSeconds,
    scenario,
    blocks,
    meanIntervalSeconds: mean(intervals),
    p50IntervalSeconds: quantile(sortedIntervals, 0.50),
    p95IntervalSeconds: quantile(sortedIntervals, 0.95),
    p99IntervalSeconds: quantile(sortedIntervals, 0.99),
    maxIntervalSeconds: sortedIntervals.at(-1),
    log2TargetStdDev: stdev(log2Targets),
    recoverySeconds,
  };
}

export function monteCarloSummary({ targetSeconds, scenario, runs = 64, durationSeconds = 7 * 86400 }) {
  const results = [];
  for (let i = 0; i < runs; i += 1) {
    results.push(simulateAsertProxy({
      targetSeconds,
      scenario,
      durationSeconds,
      seed: 0x5f3759df ^ ((i + 1) * 0x9e3779b1),
    }));
  }
  const meanIntervals = results.map((r) => r.meanIntervalSeconds).sort((a, b) => a - b);
  const targetNoise = results.map((r) => r.log2TargetStdDev).sort((a, b) => a - b);
  const recoveries = results.filter((r) => r.recoverySeconds !== null).map((r) => r.recoverySeconds).sort((a, b) => a - b);

  return {
    targetSeconds,
    scenario,
    runs,
    medianMeanIntervalSeconds: quantile(meanIntervals, 0.5),
    p95MeanIntervalSeconds: quantile(meanIntervals, 0.95),
    medianLog2TargetStdDev: quantile(targetNoise, 0.5),
    p95Log2TargetStdDev: quantile(targetNoise, 0.95),
    recoveryCoverage: recoveries.length / runs,
    medianRecoveryHours: recoveries.length ? quantile(recoveries, 0.5) / 3600 : null,
    p95RecoveryHours: recoveries.length ? quantile(recoveries, 0.95) / 3600 : null,
  };
}

export function buildReport() {
  const staticMetrics = CANDIDATES.map(staticCandidate);
  const scenarios = ['stable', 'loss80', 'gain80', 'browserCycle'];
  const daa = [];
  for (const targetSeconds of CANDIDATES) {
    for (const scenario of scenarios) {
      daa.push(monteCarloSummary({ targetSeconds, scenario }));
    }
  }

  return {
    schema: 'fae-economic-block-time-v2-lab/1',
    authority: 'research-only-candidate-not-active-consensus',
    baselineTargetSeconds: BASE.targetSeconds,
    candidates: CANDIDATES,
    base: BASE,
    baselineTheoreticalSupplyFae: BASE_SUPPLY_FAE,
    staticMetrics,
    daaProxy: daa,
    l2: {
      baselineDisposition: 'HOLD-300-AS-INCUMBENT',
      activationRule: 'L3_REQUIRED_BEFORE_ANY_TESTNET_ACTIVATION',
      challengerRule: '600/900 must beat 300 after economics, maturity, capacity, mining-latency, DAA-noise and stale/propagation coupling are charged.',
      keyFinding: 'If tx/block and propagation delay scale linearly to preserve throughput, the first-order stale-race advantage of 600/900 disappears because delay/target remains constant.',
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(`${JSON.stringify(buildReport(), null, 2)}\n`);
}
