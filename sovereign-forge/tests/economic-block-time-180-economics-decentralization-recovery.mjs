import assert from 'node:assert/strict';
import test from 'node:test';
import {runMiningEconomics} from '../node/lab/economic-block-time-180-mining-economics.mjs';
import {raceProbability,runDecentralizationSensitivity} from '../node/lab/economic-block-time-180-decentralization.mjs';
import {runOutageRecovery} from '../node/lab/economic-block-time-180-outage-recovery.mjs';

test('F180-06 preserves active economics and shows lower event variance at 180s',()=>{
  const r=runMiningEconomics();
  assert.equal(r.actual_and_research_packages['180-active'].targetSeconds,180);
  assert.equal(r.actual_and_research_packages['180-active'].rewardFae,10);
  assert.equal(r.actual_and_research_packages['180-active'].networkIssuanceFaePerDay,4800);
  assert.ok(r.equal_expected_issuance_normalization['300'].sigmaRatioVs180>1);
  assert.ok(r.equal_expected_issuance_normalization['600'].sigmaRatioVs180>r.equal_expected_issuance_normalization['300'].sigmaRatioVs180);
  assert.equal(r.selectionAuthorized,false);
});

test('F180-07 first-order race sensitivity increases as target shortens',()=>{
  const r=runDecentralizationSensitivity();
  assert.ok(raceProbability(5,180)>raceProbability(5,300));
  assert.ok(raceProbability(5,300)>raceProbability(5,600));
  assert.ok(r.table['180'].relativeAcceptedEventAdvantageFast0_1sVsSlow.slow5s>r.table['300'].relativeAcceptedEventAdvantageFast0_1sVsSlow.slow5s);
  assert.equal(r.activationAuthorized,false);
});

test('F180-08 preserves the 208s historical failure and does not infer causality',()=>{
  const r=runOutageRecovery();
  assert.equal(r.historical208sCase.reportedRunOutcome,'FAIL');
  assert.equal(r.historical208sCase.frozenGateSeconds,180);
  assert.ok(r.historical208sCase.modelAt180.probabilityAtLeastOneBlock>0.68);
  assert.ok(r.historical208sCase.modelAt180.probabilityAtLeastOneBlock<0.69);
  assert.equal(r.activationAuthorized,false);
});
