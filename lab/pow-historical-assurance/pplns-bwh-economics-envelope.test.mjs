import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceShareWindow,bwhConditionalPayoff,sourceWindowRolloff,fawConditionalExternalOpportunity,
  efawConditionalPortfolio}
  from './pplns-bwh-economics-envelope.mjs';
const R=1_000_000_000n;
test('HPA-W3-09: true 2048-window 25% infiltration retains payout weight but 100% withheld full-blocks reduces own expected reward',()=>{
  const {ledger}=sourceShareWindow({windowSize:2048,attackerShares:512});
  const benign=bwhConditionalPayoff({ledger,withholdBasisPoints:0,rewardAtoms:R});
  const partial=bwhConditionalPayoff({ledger,withholdBasisPoints:5000,rewardAtoms:R});
  const full=bwhConditionalPayoff({ledger,withholdBasisPoints:10000,rewardAtoms:R});
  assert.equal(benign.honest_reference_payout_atoms,'250000000');
  assert.equal(benign.withheld_reference_payout_atoms,'250000000');
  assert.equal(partial.withheld_reference_payout_atoms,'218750000');
  assert.equal(full.withheld_reference_payout_atoms,'187500000');
  assert.equal(full.minimum_external_benefit_to_break_even_atoms,'62500000');
  assert.equal(full.external_benefit_known,false);
  assert.equal(full.attack_profitability_proven,false);
  console.log(JSON.stringify({source_window:2048,
    infiltration_bps:2500,full_withholding_external_break_even_atoms:full.minimum_external_benefit_to_break_even_atoms,
    conditional_assurance_only:true}));
});
test('HPA-W3-10: 512 new honest shares roll 25% attacker stake to 18.75%; full window clears it',()=>{
  const {ledger}=sourceShareWindow({windowSize:2048,attackerShares:512});
  const first=sourceWindowRolloff(ledger,{newHonestShares:512});
  assert.equal(first.attacker_shares,384);
  assert.equal(first.honest_shares,1664);
  const trial=bwhConditionalPayoff({ledger,withholdBasisPoints:10000,rewardAtoms:R});
  assert.equal(trial.honest_reference_payout_atoms,'187500000');
  assert.equal(trial.withheld_reference_payout_atoms,'152343750');
  assert.equal(trial.minimum_external_benefit_to_break_even_atoms,'35156250');
  const final=sourceWindowRolloff(ledger,{newHonestShares:2048});
  assert.equal(final.attacker_shares,0);
  assert.equal(bwhConditionalPayoff({ledger,rewardAtoms:R}).minimum_external_benefit_to_break_even_atoms,'0');
});
test('HPA-W3-11: real source ledger adversarial grid never demonstrates unilateral BWH profit without an external payoff',()=>{
  for(const attackerShares of [0,102,256,512,819,1536,2048]){
    const {ledger}=sourceShareWindow({windowSize:2048,attackerShares});
    let last=R+1n;
    for(const withholdBasisPoints of [0,1000,5000,10000]){
      const p=bwhConditionalPayoff({ledger,withholdBasisPoints,rewardAtoms:R});
      const actual=BigInt(p.withheld_reference_payout_atoms);
      assert.ok(actual<=last,'source-window own payout cannot rise with withholding');
      assert.ok(actual<=BigInt(p.honest_reference_payout_atoms));
      assert.equal(p.attack_profitability_proven,false);
      assert.equal(p.external_benefit_known,false);
      last=actual;
    }
  }
});
test('HPA-W3-12: reject assumption violations without silently claiming final FAE security economics',()=>{
  assert.throws(()=>sourceShareWindow({windowSize:0,attackerShares:0}),/invalid_bwh_share_window/);
  assert.throws(()=>sourceShareWindow({windowSize:2048,attackerShares:2049}),/invalid_bwh_share_window/);
  const {ledger}=sourceShareWindow({windowSize:2048,attackerShares:512});
  assert.throws(()=>bwhConditionalPayoff({ledger,withholdBasisPoints:10001}),/invalid_bwh_economic_assumptions/);
  assert.throws(()=>bwhConditionalPayoff({ledger,rewardAtoms:0n}),/invalid_bwh_economic_assumptions/);
  assert.throws(()=>sourceWindowRolloff(ledger,{newHonestShares:2049}),/invalid_rolloff/);
});

test('HPA-W3-13: conditional one-opportunity fork win threshold, explicitly NOT a measured FAW profit',()=>{
  const {ledger}=sourceShareWindow({windowSize:2048,attackerShares:512});
  const base={ledger,poolRewardAtoms:R,externalRewardAtoms:R,
    assumedOpportunities:1,withholdBasisPoints:10000};
  const zero=fawConditionalExternalOpportunity({...base,assumedForkWinBasisPoints:0});
  const exact=fawConditionalExternalOpportunity({...base,assumedForkWinBasisPoints:625});
  const speculative=fawConditionalExternalOpportunity({...base,assumedForkWinBasisPoints:1000});
  assert.equal(zero.ownPoolWithholdingCostAtoms,'62500000');
  assert.equal(zero.expectedNetGainAtoms,'-62500000');
  assert.equal(exact.requiredForkWinBasisPointsCeil,'625');
  assert.equal(exact.expectedNetGainAtoms,'0');
  assert.equal(exact.conditionalScenarioAdvantageous,false);
  assert.equal(speculative.expectedNetGainAtoms,'37500000');
  assert.equal(speculative.conditionalScenarioAdvantageous,true);
  assert.equal(speculative.actualAttackerProfitabilityVerified,false);
  assert.equal(speculative.empiricalForkWinProbabilityVerified,false);
  assert.equal(speculative.forkOpportunityRateVerified,false);
});
test('HPA-W3-14: explicit opportunity cost tightens multi-pool threshold; missing chance is no evidence',()=>{
  const {ledger}=sourceShareWindow({windowSize:2048,attackerShares:512});
  const x=fawConditionalExternalOpportunity({ledger,poolRewardAtoms:R,
    externalRewardAtoms:R,assumedOpportunities:1,assumedForkWinBasisPoints:1000,
    extraAttackCostAtoms:50000000n});
  assert.equal(x.requiredForkWinBasisPointsCeil,'1125');
  assert.equal(x.expectedNetGainAtoms,'-12500000');
  assert.equal(x.conditionalScenarioAdvantageous,false);
  assert.equal(x.realNetworkHashAndLatencyVerified,false);
});
test('HPA-W3-15: arbitrary or ill-typed fake pool opportunity evidence fails closed',()=>{
  const {ledger}=sourceShareWindow({windowSize:2048,attackerShares:512});
  const b={ledger,poolRewardAtoms:R,externalRewardAtoms:R,
    assumedOpportunities:1,assumedForkWinBasisPoints:1000};
  for(const delta of [{externalRewardAtoms:0n},{externalRewardAtoms:1},
    {assumedOpportunities:0},{assumedOpportunities:1.1},{assumedForkWinBasisPoints:-1},
    {assumedForkWinBasisPoints:10001},{extraAttackCostAtoms:-1n},
    {extraAttackCostAtoms:1}]){
    assert.throws(()=>fawConditionalExternalOpportunity({...b,...delta}),/invalid_faw_external_assumptions/);
  }
});

test('HPA-W3-32: 100% imaginary fork-win ceiling can falsify profitability in a real 2048-share ledger scenario',()=>{
  const {ledger}=sourceShareWindow({windowSize:2048,attackerShares:512});
  const trial=fawConditionalExternalOpportunity({ledger,withholdBasisPoints:10000,
    poolRewardAtoms:R,externalRewardAtoms:50_000_000n,assumedOpportunities:1,
    assumedForkWinBasisPoints:10000,extraAttackCostAtoms:10_000_000n});
  assert.equal(trial.ownPoolWithholdingCostAtoms,'62500000');
  assert.equal(trial.minimumHypotheticalBenefitRequiredAtoms,'72500000');
  assert.equal(trial.maximumHypotheticalExternalAtoms,'50000000');
  assert.equal(trial.requiredForkWinBasisPointsCeil,'14500');
  assert.equal(trial.anyConditionalWinRateCanProfit,false);
  assert.equal(trial.noProfitableForkWinRateUnderDeclaredInputs,true);
  assert.equal(trial.conditionalScenarioAdvantageous,false);
  assert.equal(trial.actualAttackerProfitabilityVerified,false);
});
test('HPA-W3-33: an optimistic hypothetical scenario cannot certify a real BWH/FAW attack',()=>{
  const {ledger}=sourceShareWindow({windowSize:2048,attackerShares:512});
  const trial=fawConditionalExternalOpportunity({ledger,withholdBasisPoints:10000,
    poolRewardAtoms:R,externalRewardAtoms:R,assumedOpportunities:1,
    assumedForkWinBasisPoints:1000});
  assert.equal(trial.anyConditionalWinRateCanProfit,true);
  assert.equal(trial.noProfitableForkWinRateUnderDeclaredInputs,false);
  assert.equal(trial.conditionalScenarioAdvantageous,true);
  assert.equal(trial.empiricalForkWinProbabilityVerified,false);
  assert.equal(trial.externalPoolPayoutVerified,false);
  assert.equal(trial.actualAttackerProfitabilityVerified,false);
});
test('HPA-W3-34: exact break-even is not positive attack profit',()=>{
  const {ledger}=sourceShareWindow({windowSize:2048,attackerShares:512});
  const trial=fawConditionalExternalOpportunity({ledger,withholdBasisPoints:10000,
    poolRewardAtoms:R,externalRewardAtoms:62_500_000n,assumedOpportunities:1,
    assumedForkWinBasisPoints:10000});
  assert.equal(trial.expectedNetGainAtoms,'0');
  assert.equal(trial.requiredForkWinBasisPointsCeil,'10000');
  assert.equal(trial.noProfitableForkWinRateUnderDeclaredInputs,true);
  assert.equal(trial.conditionalScenarioAdvantageous,false);
});

test('HPA-W3-35: EFAW portfolio conserves one attacker allocation across multiple pools',()=>{
  const {ledger}=sourceShareWindow({windowSize:2048,attackerShares:512});
  const trial=efawConditionalPortfolio({ledger,withholdBasisPoints:10000,poolRewardAtoms:R,
    externalPools:[
      {rewardAtoms:R,assumedOpportunities:1,assumedForkWinBasisPoints:1000,allocationBasisPoints:6000},
      {rewardAtoms:R,assumedOpportunities:1,assumedForkWinBasisPoints:2000,allocationBasisPoints:4000}
    ]});
  assert.equal(trial.totalAllocationBasisPoints,10000);
  assert.equal(trial.unallocatedBasisPoints,0);
  assert.equal(trial.maximumHypotheticalExternalAtoms,'1000000000');
  assert.equal(trial.expectedExternalAtoms,'140000000');
  assert.equal(trial.ownPoolWithholdingCostAtoms,'62500000');
  assert.equal(trial.expectedNetGainAtoms,'77500000');
  assert.equal(trial.conditionalPortfolioAdvantageous,true);
  assert.equal(trial.actualAttackerProfitabilityVerified,false);
});
test('HPA-W3-36: duplicated full attacker allocation across EFAW pools fails closed',()=>{
  const {ledger}=sourceShareWindow({windowSize:2048,attackerShares:512});
  assert.throws(()=>efawConditionalPortfolio({ledger,poolRewardAtoms:R,externalPools:[
    {rewardAtoms:R,assumedOpportunities:1,assumedForkWinBasisPoints:1000,allocationBasisPoints:10000},
    {rewardAtoms:R,assumedOpportunities:1,assumedForkWinBasisPoints:1000,allocationBasisPoints:1}
  ]}),/efaw_allocation_budget_exceeded/);
});
test('HPA-W3-37: declared EFAW portfolio ceiling can falsify profit without claiming empirical security',()=>{
  const {ledger}=sourceShareWindow({windowSize:2048,attackerShares:512});
  const trial=efawConditionalPortfolio({ledger,withholdBasisPoints:10000,poolRewardAtoms:R,
    extraAttackCostAtoms:10_000_000n,externalPools:[
      {rewardAtoms:50_000_000n,assumedOpportunities:1,assumedForkWinBasisPoints:10000,allocationBasisPoints:5000},
      {rewardAtoms:50_000_000n,assumedOpportunities:1,assumedForkWinBasisPoints:10000,allocationBasisPoints:5000}
    ]});
  assert.equal(trial.maximumHypotheticalExternalAtoms,'50000000');
  assert.equal(trial.minimumHypotheticalBenefitRequiredAtoms,'72500000');
  assert.equal(trial.noProfitablePortfolioUnderDeclaredInputs,true);
  assert.equal(trial.conditionalPortfolioAdvantageous,false);
  assert.equal(trial.opportunityRatesVerified,false);
  assert.equal(trial.actualAttackerProfitabilityVerified,false);
});
test('HPA-W3-38: malformed EFAW allocations and fake evidence types are rejected',()=>{
  const {ledger}=sourceShareWindow({windowSize:2048,attackerShares:512});
  const good={rewardAtoms:R,assumedOpportunities:1,assumedForkWinBasisPoints:1000,allocationBasisPoints:5000};
  for(const externalPools of [[],[null],[{...good,rewardAtoms:0n}],
    [{...good,assumedOpportunities:0}],[{...good,assumedForkWinBasisPoints:10001}],
    [{...good,allocationBasisPoints:0}],[{...good,allocationBasisPoints:1.5}]]){
    assert.throws(()=>efawConditionalPortfolio({ledger,poolRewardAtoms:R,externalPools}),
      /invalid_efaw_portfolio_assumptions/);
  }
  assert.throws(()=>efawConditionalPortfolio({ledger,poolRewardAtoms:R,
    externalPools:[good],extraAttackCostAtoms:1}),/invalid_efaw_portfolio_assumptions/);
});
