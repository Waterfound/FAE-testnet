#!/usr/bin/env node
'use strict';

/*
FAE authoritative tokenomics derivation — 2026-10-04.
Documentation/evidence only. Does not activate consensus.

Authoritative economic inputs:
- initial subsidy: 10 FAE/block
- hard monetary ceiling: 14,026,000 FAE
- reward retention: 55% per era (-45%)
- calendar era intent: 6 years

300 seconds remains a research incumbent, not authoritative here.
*/

const ATOMS = 100_000_000n;
const INITIAL_REWARD = 10n * ATOMS;
const CAP = 14_026_000n * ATOMS;
const RETAIN_NUM = 55n;
const RETAIN_DEN = 100n;
const STRICT_SIX_YEAR_BLOCKS_AT_300S = 631_152n;

function scheduledAtoms(blocksPerEra) {
  let reward = INITIAL_REWARD;
  let total = 0n;
  let eras = 0;
  while (reward > 0n) {
    total += reward * blocksPerEra;
    reward = reward * RETAIN_NUM / RETAIN_DEN;
    eras += 1;
  }
  return { total, eras };
}

const strict = scheduledAtoms(STRICT_SIX_YEAR_BLOCKS_AT_300S);

let lo = 0n;
let hi = 1_000_000n;
while (lo + 1n < hi) {
  const mid = (lo + hi) / 2n;
  if (scheduledAtoms(mid).total <= CAP) lo = mid;
  else hi = mid;
}
const capAligned = scheduledAtoms(lo);
const next = scheduledAtoms(lo + 1n);

if (lo !== 631_170n) throw new Error(`unexpected cap-aligned era blocks: ${lo}`);
if (capAligned.total > CAP) throw new Error('cap-aligned schedule exceeds cap');
if (next.total <= CAP) throw new Error('cap-aligned era blocks are not maximal');

const secondsPerReferenceYear = 365.25 * 24 * 60 * 60;
const nominalYearsAt300s = Number(lo) * 300 / secondsPerReferenceYear;
const exactSixYearBlockSeconds = 6 * secondsPerReferenceYear / Number(lo);

const result = {
  schema: 'FAE_TOKENOMICS_10FAE_14P026M_DERIVATION_V1',
  authority: {
    initial_reward_fae: 10,
    maximum_supply_fae: 14_026_000,
    reduction_per_era_pct: 45,
    retention_per_era_pct: 55,
    calendar_era_years: 6
  },
  strict_six_year_at_300s: {
    blocks_per_era: Number(STRICT_SIX_YEAR_BLOCKS_AT_300S),
    scheduled_issuance_fae: (Number(strict.total) / Number(ATOMS)).toFixed(8),
    unissued_remainder_fae: (Number(CAP - strict.total) / Number(ATOMS)).toFixed(8)
  },
  cap_aligned_constant_era_candidate: {
    blocks_per_era: Number(lo),
    scheduled_issuance_fae: (Number(capAligned.total) / Number(ATOMS)).toFixed(8),
    unissued_remainder_fae: (Number(CAP - capAligned.total) / Number(ATOMS)).toFixed(8),
    next_block_count_would_exceed_cap: true,
    nominal_years_at_300s: nominalYearsAt300s,
    exact_six_year_implied_block_target_seconds: exactSixYearBlockSeconds,
    status: 'DERIVED_CANDIDATE_NOT_ACTIVE_CONSENSUS'
  }
};

console.log(JSON.stringify(result, null, 2));
