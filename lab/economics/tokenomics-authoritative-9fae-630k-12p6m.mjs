#!/usr/bin/env node
'use strict';

/*
FAE authoritative tokenomics derivation — 2026-10-06.
Documentation/evidence only. Does not activate consensus.

Authoritative monetary inputs:
- initial subsidy: 9 FAE/block
- reward retention: 55% per era (-45%)
- era length: 630,000 blocks
- hard monetary ceiling: 12,600,000 FAE
*/

const ATOMS = 100_000_000n;
const INITIAL = 9n * ATOMS;
const ERA_BLOCKS = 630_000n;
const RETAIN_NUM = 55n;
const RETAIN_DEN = 100n;
const CAP = 12_600_000n * ATOMS;

let reward = INITIAL;
let total = 0n;
let era = 0;
const rows = [];

while (reward > 0n) {
  const issuance = reward * ERA_BLOCKS;
  total += issuance;
  rows.push({
    era,
    start_block: era * Number(ERA_BLOCKS),
    end_block_exclusive: (era + 1) * Number(ERA_BLOCKS),
    reward_atoms: reward.toString(),
    reward_fae: Number(reward) / Number(ATOMS),
    issuance_fae: Number(issuance) / Number(ATOMS),
    cumulative_fae: Number(total) / Number(ATOMS)
  });
  reward = reward * RETAIN_NUM / RETAIN_DEN;
  era += 1;
}

const theoretical = 9 * 630000 / 0.45;
const secondsPerReferenceYear = 365.25 * 24 * 60 * 60;
const eraYearsAt300s = Number(ERA_BLOCKS) * 300 / secondsPerReferenceYear;
const eraDaysAt300s = Number(ERA_BLOCKS) * 300 / 86400;

if (theoretical !== 12_600_000) throw new Error('theoretical cap mismatch');
if (total > CAP) throw new Error('atom-exact schedule exceeds hard cap');
if (era !== 34) throw new Error(`unexpected nonzero era count: ${era}`);
if (rows.length * Number(ERA_BLOCKS) !== 21_420_000) throw new Error('subsidized block count mismatch');
if ((Number(total) / Number(ATOMS)).toFixed(8) !== '12599999.81100000') throw new Error('atom-exact total mismatch');

console.log(JSON.stringify({
  schema:'FAE_TOKENOMICS_9FAE_630K_12P6M_DERIVATION_V1',
  authority:{
    initial_reward_fae:9,
    era_blocks:630000,
    subsidy_reduction_per_era_pct:45,
    subsidy_retention_per_era_pct:55,
    maximum_supply_fae:12600000
  },
  results:{
    theoretical_geometric_supply_fae:theoretical,
    atom_exact_scheduled_supply_fae:(Number(total)/Number(ATOMS)).toFixed(8),
    permanently_unissued_remainder_fae:(Number(CAP-total)/Number(ATOMS)).toFixed(8),
    nonzero_reward_eras:era,
    total_subsidized_blocks:era * Number(ERA_BLOCKS),
    era_days_at_300s:eraDaysAt300s,
    era_years_at_300s:eraYearsAt300s,
    total_subsidy_years_at_300s:eraYearsAt300s * era
  },
  rows
}, null, 2));
