#!/usr/bin/env node
'use strict';

/*
  FAE issuance-era study: 5y vs 6y
  Research-only. No consensus authority.

  Assumptions:
  - 300 s target block interval
  - 7 FAE initial subsidy
  - subsidy retention 55% per era (45% reduction)
  - 1 FAE = 100,000,000 atoms
  - 365.25-day reference year => 105,192 blocks/year
  - integer-atom recursive floor at each era transition
*/

const ATOMS = 100_000_000n;
const BLOCKS_PER_YEAR = 105_192n;
const INITIAL_REWARD = 7n * ATOMS;
const RETAIN_NUM = 55n;
const RETAIN_DEN = 100n;

function schedule(yearsPerEra) {
  const blocksPerEra = BLOCKS_PER_YEAR * BigInt(yearsPerEra);
  let reward = INITIAL_REWARD;
  let total = 0n;
  let era = 0;
  const rows = [];

  while (reward > 0n) {
    const eraIssuance = reward * blocksPerEra;
    total += eraIssuance;
    rows.push({
      era,
      rewardAtoms: reward.toString(),
      rewardFAE: Number(reward) / Number(ATOMS),
      eraIssuanceFAE: Number(eraIssuance) / Number(ATOMS),
      cumulativeFAE: Number(total) / Number(ATOMS),
    });
    reward = (reward * RETAIN_NUM) / RETAIN_DEN;
    era++;
  }

  return {
    yearsPerEra,
    blocksPerEra: Number(blocksPerEra),
    erasUntilZeroAtomReward: era,
    terminalYearAtEraBoundary: era * yearsPerEra,
    totalFAE: Number(total) / Number(ATOMS),
    rows,
  };
}

function remainingFractionAtYear(year, yearsPerEra) {
  const q = 0.55;
  const d = 0.45;
  const n = Math.floor(year / yearsPerEra);
  const f = (year - n * yearsPerEra) / yearsPerEra;
  return Math.pow(q, n) * (1 - d * f);
}

function timeToEmittedFraction(target, yearsPerEra) {
  const q = 0.55;
  const d = 0.45;
  let n = 0;
  let emitted = 0;
  while (true) {
    const eraShare = d * Math.pow(q, n);
    if (emitted + eraShare >= target) {
      const fractionOfEra = (target - emitted) / eraShare;
      return yearsPerEra * (n + fractionOfEra);
    }
    emitted += eraShare;
    n++;
  }
}

const five = schedule(5);
const six = schedule(6);

const checkpoints = [5, 6, 10, 12, 15, 18, 20, 24, 25, 30, 36, 40];
const tails = checkpoints.map((year) => ({
  year,
  fiveYearRemainingPct: remainingFractionAtYear(year, 5) * 100,
  sixYearRemainingPct: remainingFractionAtYear(year, 6) * 100,
}));

const milestones = [0.5, 0.8, 0.9, 0.95, 0.99].map((fraction) => ({
  emittedPct: fraction * 100,
  fiveYearCalendarYears: timeToEmittedFraction(fraction, 5),
  sixYearCalendarYears: timeToEmittedFraction(fraction, 6),
}));

console.log(JSON.stringify({ five, six, tails, milestones }, null, 2));
