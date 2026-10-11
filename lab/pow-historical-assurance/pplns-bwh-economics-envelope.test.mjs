import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceShareWindow,bwhConditionalPayoff,sourceWindowRolloff}
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
