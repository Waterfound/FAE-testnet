import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const authority=JSON.parse(await readFile(new URL('../../docs/FAE_TOKENOMICS_AUTHORITY_20261006.json',import.meta.url),'utf8'));
assert.equal(authority.status,'AUTHORITATIVE_DESIGN__NOT_ACTIVE_CONSENSUS');

const A=authority.authoritative_now;
const D=authority.derived_atom_exact_schedule;
const ATOMS=BigInt(D.base_unit_atoms_per_fae);
const ERA=BigInt(A.era_blocks);
const initial=BigInt(A.initial_reward_fae)*ATOMS;
const retain=BigInt(A.subsidy_retention_per_era_pct);

function nextReward(atoms){return atoms*retain/100n}
function fmt(atoms){
  const whole=atoms/ATOMS, frac=(atoms%ATOMS).toString().padStart(8,'0');
  return whole+'.'+frac;
}
function pct(num,den){return Number(num*1000000n/den)/10000}

let reward=initial,total=0n,eras=[];
let era=0;
while(reward>0n){
  const issuance=reward*ERA;
  total+=issuance;
  const targets=[100,50,25].map(level=>{
    const target=initial*BigInt(level)/100n;
    const fee=target>reward?target-reward:0n;
    return{
      target_pct_of_era0_gross_budget:level,
      fee_atoms_per_block:fee.toString(),
      fee_fae_per_block:fmt(fee),
      fee_share_of_target_pct:target>0n?pct(fee,target):0
    };
  });
  eras.push({
    era,
    reward_atoms:reward.toString(),
    reward_fae:fmt(reward),
    reward_pct_of_initial:pct(reward,initial),
    cumulative_scheduled_issuance_fae:fmt(total),
    fee_backfill_targets:targets
  });
  reward=nextReward(reward); era++;
  if(era>100)throw new Error('unexpected nonterminating schedule');
}

assert.equal(eras.length,D.nonzero_reward_eras);
assert.equal(fmt(total),D.terminal_scheduled_issuance_fae);

const thresholds=[50,25,10,5,1].map(level=>{
  const found=eras.find(row=>row.reward_pct_of_initial<level);
  return{below_pct_of_initial:level,first_era:found?.era??null,reward_fae:found?.reward_fae??null};
});

const result={
  schema:'FAE_SECURITY_BUDGET_SUBSIDY_ENVELOPE_V1',
  status:'DETERMINISTIC_SUBSIDY_ENVELOPE_GREEN__MARKET_AND_FEE_SECURITY_MODEL_OPEN',
  authority_source:'docs/FAE_TOKENOMICS_AUTHORITY_20261006.json',
  authoritative_monetary_inputs:{
    initial_reward_fae:A.initial_reward_fae,
    era_blocks:A.era_blocks,
    retention_pct:A.subsidy_retention_per_era_pct,
    maximum_supply_fae:A.maximum_supply_fae
  },
  derived:{
    nonzero_reward_eras:eras.length,
    terminal_scheduled_issuance_fae:fmt(total),
    permanently_unissued_fae:D.permanently_unissued_below_ceiling_fae,
    thresholds,
    eras:eras.slice(0,12)
  },
  interpretation:[
    'Subsidy reductions are deterministic security-budget events in coin units.',
    'This envelope quantifies fee backfill needed to preserve 100%, 50% or 25% of era-0 gross FAE/block budget, but does not assume a FAE price or mining equilibrium.',
    'A majority-work safety conclusion cannot be derived from subsidy schedule alone.',
    'Final GREEN additionally needs fee-market assumptions/evidence, representative mining cost/work evidence, hash concentration/rentability assumptions, and explicit confirmation/reorg policy.'
  ],
  authority:{
    research_only:true,
    fee_policy_selected:false,
    consensus_change:false,
    economics_change:false,
    mainnet:false
  }
};
console.log(JSON.stringify(result,null,2));
