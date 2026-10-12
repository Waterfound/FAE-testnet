#!/usr/bin/env node
'use strict';

/*
FAE issuance-era final comparison: 5 years vs 6 years.
Research-only. No consensus, activation, release, or mainnet authority.

Question frozen by Waterfound:
- initial reward candidate: 7 FAE/block
- subsidy reduction: 45% per era (55% retained)
- compare calendar era duration: 5 vs 6 years
- FAE objective: preserve Bitcoin-oriented finite deterministic issuance while
  extending meaningful primary issuance across generations of general-purpose hardware.

Important:
- Era duration is evaluated as a calendar policy parameter.
- 300s is used only to express an atom-exact block-count example.
- Final era-to-block translation must be recomputed if the selected block target changes.
*/

const ATOMS = 100_000_000n;
const INITIAL_REWARD_ATOMS = 7n * ATOMS;
const RETAIN_NUM = 55n;
const RETAIN_DEN = 100n;
const SECONDS_PER_YEAR = 365.25 * 24 * 60 * 60;
const EXAMPLE_BLOCK_SECONDS = 300;
const BLOCKS_PER_YEAR_300 = BigInt(Math.round(SECONDS_PER_YEAR / EXAMPLE_BLOCK_SECONDS));
const PRIOR_RESEARCH_SUPPLY = 12_040_000;

function rewardAfterEra(rewardAtoms) {
  return (rewardAtoms * RETAIN_NUM) / RETAIN_DEN;
}

function atomExactSchedule(yearsPerEra) {
  const blocksPerEra = BLOCKS_PER_YEAR_300 * BigInt(yearsPerEra);
  let rewardAtoms = INITIAL_REWARD_ATOMS;
  let totalAtoms = 0n;
  let era = 0;
  const rows = [];
  while (rewardAtoms > 0n) {
    const eraAtoms = rewardAtoms * blocksPerEra;
    totalAtoms += eraAtoms;
    rows.push({
      era,
      startYear: era * yearsPerEra,
      endYear: (era + 1) * yearsPerEra,
      rewardAtoms: rewardAtoms.toString(),
      rewardFAE: Number(rewardAtoms) / Number(ATOMS),
      eraIssuanceFAE: Number(eraAtoms) / Number(ATOMS),
      cumulativeFAE: Number(totalAtoms) / Number(ATOMS)
    });
    rewardAtoms = rewardAfterEra(rewardAtoms);
    era++;
  }
  return {
    yearsPerEra,
    exampleBlockSeconds: EXAMPLE_BLOCK_SECONDS,
    blocksPerEra: Number(blocksPerEra),
    nonZeroRewardEras: era,
    terminalEraBoundaryYear: era * yearsPerEra,
    totalAtoms: totalAtoms.toString(),
    totalFAE: Number(totalAtoms) / Number(ATOMS),
    rows
  };
}

function remainingFractionAtYear(year, yearsPerEra) {
  const q = 0.55;
  const cut = 0.45;
  const fullEras = Math.floor(year / yearsPerEra);
  const within = (year - fullEras * yearsPerEra) / yearsPerEra;
  return Math.pow(q, fullEras) * (1 - cut * within);
}

function timeToEmittedFraction(target, yearsPerEra) {
  const q = 0.55;
  const cut = 0.45;
  let emitted = 0;
  let era = 0;
  while (era < 1000) {
    const eraShare = cut * Math.pow(q, era);
    if (emitted + eraShare >= target) {
      const fractionWithinEra = (target - emitted) / eraShare;
      return yearsPerEra * (era + fractionWithinEra);
    }
    emitted += eraShare;
    era++;
  }
  throw new Error('milestone did not converge');
}

function rewardMultiplierAtYear(year, yearsPerEra) {
  return Math.pow(0.55, Math.floor(year / yearsPerEra));
}

function fixedSupplyInitialReward(totalSupply, yearsPerEra) {
  const blocksPerEra = Number(BLOCKS_PER_YEAR_300) * yearsPerEra;
  return totalSupply * 0.45 / blocksPerEra;
}

function firstEraAnnualShareOfTerminal(yearsPerEra) {
  return 0.45 / yearsPerEra;
}

function annualizedEquivalentDecay(yearsPerEra) {
  return 1 - Math.pow(0.55, 1 / yearsPerEra);
}

function equivalentHalfLife(yearsPerEra) {
  return yearsPerEra * Math.log(0.5) / Math.log(0.55);
}

function shockCountBefore(year, yearsPerEra) {
  // Strictly before a horizon avoids double-counting an event exactly at the endpoint.
  return Math.floor((year - Number.EPSILON) / yearsPerEra);
}

const five = atomExactSchedule(5);
const six = atomExactSchedule(6);

const checkpoints = [5, 6, 10, 12, 15, 18, 20, 24, 25, 30, 36, 40, 50];
const tails = checkpoints.map(year => ({
  year,
  fiveRemainingPct: remainingFractionAtYear(year, 5) * 100,
  sixRemainingPct: remainingFractionAtYear(year, 6) * 100,
  sixVsFiveRemainingRatio: remainingFractionAtYear(year, 6) / remainingFractionAtYear(year, 5),
  fiveRewardMultiplier: rewardMultiplierAtYear(year, 5),
  sixRewardMultiplier: rewardMultiplierAtYear(year, 6)
}));

const milestones = [0.50, 0.80, 0.90, 0.95, 0.99].map(target => ({
  emittedPct: target * 100,
  fiveYears: timeToEmittedFraction(target, 5),
  sixYears: timeToEmittedFraction(target, 6),
  extensionYears: timeToEmittedFraction(target, 6) - timeToEmittedFraction(target, 5)
}));

const genericDeviceLifetimes = [3, 4, 5, 6, 7, 8].map(life => ({
  usefulLifeYears: life,
  expectedSubsidyTransitionsFive: life / 5,
  expectedSubsidyTransitionsSix: life / 6,
  reductionInTransitionExposurePct: (1 - (life / 6) / (life / 5)) * 100
}));

const fixedSupply = {
  targetFAE: PRIOR_RESEARCH_SUPPLY,
  fiveInitialRewardFAE: fixedSupplyInitialReward(PRIOR_RESEARCH_SUPPLY, 5),
  sixInitialRewardFAE: fixedSupplyInitialReward(PRIOR_RESEARCH_SUPPLY, 6),
  sixVsFiveInitialRewardRatio:
    fixedSupplyInitialReward(PRIOR_RESEARCH_SUPPLY, 6) /
    fixedSupplyInitialReward(PRIOR_RESEARCH_SUPPLY, 5)
};

const invariants = {
  sixNeverHasMoreSubsidyCutsBySameCalendarDate: true,
  sixRewardNeverBelowFiveWithSameInitialReward: true,
  proofSketch:
    'For t>=0, floor(t/6)<=floor(t/5). Since 0<0.55<1, 0.55^floor(t/6)>=0.55^floor(t/5).',
  sixTerminalSupplyVsFiveRatioFixedInitialReward: six.totalFAE / five.totalFAE,
  sixTerminalSupplyBelowPrior1204mCandidate: six.totalFAE < PRIOR_RESEARCH_SUPPLY,
  fiveTerminalSupplyBelowPrior1204mCandidate: five.totalFAE < PRIOR_RESEARCH_SUPPLY
};

const result = {
  schema: 'FAE_ISSUANCE_ERA_FINAL_COMPARISON_V1',
  assumptions: {
    reductionPerEraPct: 45,
    retentionPerEraPct: 55,
    initialRewardFAE: 7,
    calendarEraCandidatesYears: [5, 6],
    exampleBlockSeconds: EXAMPLE_BLOCK_SECONDS,
    priorResearchSupplyFAE: PRIOR_RESEARCH_SUPPLY,
    authority: 'RESEARCH_ONLY'
  },
  schedules: { five, six },
  normalizedMetrics: {
    five: {
      firstEraShareOfTerminalPct: firstEraAnnualShareOfTerminal(5) * 100 * 5,
      firstEraAnnualShareOfTerminalPct: firstEraAnnualShareOfTerminal(5) * 100,
      annualizedEquivalentDecayPct: annualizedEquivalentDecay(5) * 100,
      equivalentSubsidyHalfLifeYears: equivalentHalfLife(5)
    },
    six: {
      firstEraShareOfTerminalPct: firstEraAnnualShareOfTerminal(6) * 100 * 6,
      firstEraAnnualShareOfTerminalPct: firstEraAnnualShareOfTerminal(6) * 100,
      annualizedEquivalentDecayPct: annualizedEquivalentDecay(6) * 100,
      equivalentSubsidyHalfLifeYears: equivalentHalfLife(6)
    }
  },
  tails,
  milestones,
  shockCountsStrictlyBeforeHorizon: [10, 20, 30, 40, 50].map(year => ({
    year,
    five: shockCountBefore(year, 5),
    six: shockCountBefore(year, 6)
  })),
  genericDeviceLifetimes,
  fixedSupplyNormalization: fixedSupply,
  invariants
};

if (!(six.totalFAE > five.totalFAE)) throw new Error('expected six-year fixed-R0 supply > five-year');
if (!(six.totalFAE < PRIOR_RESEARCH_SUPPLY)) throw new Error('six-year supply must remain below prior 12.04m candidate');
if (Math.abs(fixedSupply.sixVsFiveInitialRewardRatio - 5/6) > 1e-12) throw new Error('fixed-supply initial reward ratio mismatch');

for (let y = 0; y <= 100; y += 0.01) {
  if (rewardMultiplierAtYear(y, 6) + 1e-15 < rewardMultiplierAtYear(y, 5)) {
    throw new Error('six-year reward dominance failed');
  }
  if (remainingFractionAtYear(y, 6) + 1e-12 < remainingFractionAtYear(y, 5)) {
    throw new Error('six-year tail dominance failed');
  }
}

console.log(JSON.stringify(result, null, 2));
