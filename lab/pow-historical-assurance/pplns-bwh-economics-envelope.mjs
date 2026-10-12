/**
 * HPA-UC-001 W3 — SOURCE-BOUND, BOUNDED, CONDITIONAL BWH payoff envelope.
 * Does NOT assert profitability of real FAE attacks, attacker hashes, latency,
 * future security budget or network fee demand. Not a pool release rule.
 */
import {ShareLedger} from '../../sovereign-forge/node/authoritative/share-coordinator.mjs';
const BASIS=10000n;
export function sourceShareWindow({windowSize=2048,attackerShares}={}){
  if(!Number.isSafeInteger(windowSize)||windowSize<1||windowSize>100000||
     !Number.isSafeInteger(attackerShares)||attackerShares<0||attackerShares>windowSize)
    throw new Error('invalid_bwh_share_window');
  const ledger=new ShareLedger({windowSize});
  for(let i=0;i<windowSize;i++){
    // Uniformly interleave real source-ledger entries; no invented payout logic.
    const attacker=Math.floor((i+1)*attackerShares/windowSize)>Math.floor(i*attackerShares/windowSize);
    ledger.append({jobId:'window-'+i,address:attacker?'attacker':'honest',
      nonce:i,hash:'0'.repeat(64),shareDifficultyBits:12,blockDifficultyBits:18,
      height:1,previousBlockHash:'0'.repeat(64)});
  }
  const records=ledger.weights('honest');
  const n=Number(records.find(x=>x.address==='attacker')?.weight??0n);
  if(n!==attackerShares||ledger.window().length!==windowSize)throw new Error('source_share_weight_mismatch');
  return {ledger,windowSize,attackerShares:n};
}
export function bwhConditionalPayoff({ledger,withholdBasisPoints=10000,
  rewardAtoms=100000000n}={}){
  if(!(ledger instanceof ShareLedger)||!Number.isSafeInteger(withholdBasisPoints)||
    withholdBasisPoints<0||withholdBasisPoints>10000||typeof rewardAtoms!=='bigint'||rewardAtoms<1n)
    throw new Error('invalid_bwh_economic_assumptions');
  const weights=ledger.weights('honest'),total=weights.reduce((s,x)=>s+x.weight,0n),
    attacker=weights.find(x=>x.address==='attacker')?.weight??0n;
  const withheld=BigInt(withholdBasisPoints);
  // Model assumption: validated shares accrue proportional window payout;
  // attacker submits q fraction of its discovered full blocks; honest submits all.
  // Pool normalized full-block success = (N - q*A)/N.
  const successNumerator=total*BASIS-withheld*attacker;
  const denominator=total*total*BASIS;
  const honestPayout=(rewardAtoms*attacker)/total;
  const attackPayout=(rewardAtoms*attacker*successNumerator)/denominator;
  if(attackPayout>honestPayout)throw new Error('model_inconsistent_bwh_own_payout');
  return {
    model:'FAE_PPLNS_SOURCE_WINDOW_CONDITIONAL_PAYOFF_V1',
    source_window_size:Number(total),
    attacker_window_shares:Number(attacker),
    withhold_basis_points:withholdBasisPoints,
    assumed_reference_reward_atoms:rewardAtoms.toString(),
    honest_reference_payout_atoms:honestPayout.toString(),
    withheld_reference_payout_atoms:attackPayout.toString(),
    minimum_external_benefit_to_break_even_atoms:(honestPayout-attackPayout).toString(),
    basis:'ONE_EQUAL_DIFFICULTY_WINDOW__FIXED_COSTS__NO_EXTERNAL_REVENUE',
    external_benefit_known:false,
    total_network_hash_known:false,
    miner_cost_known:false,
    propagation_race_known:false,
    attack_profitability_proven:false
  };
}
export function sourceWindowRolloff(ledger,{newHonestShares=512}={}){
  if(!(ledger instanceof ShareLedger)||!Number.isSafeInteger(newHonestShares)||
    newHonestShares<0||newHonestShares>ledger.windowSize)
    throw new Error('invalid_rolloff');
  const previousTotal=ledger.summary().totalShares;
  for(let i=0;i<newHonestShares;i++)ledger.append({
    jobId:'honest-renewal-'+(previousTotal+i),address:'honest',nonce:previousTotal+i,hash:'0'.repeat(64),
    shareDifficultyBits:12,blockDifficultyBits:18,height:2,previousBlockHash:'1'.repeat(64)});
  const weights=ledger.weights('honest');
  return {window_size:ledger.windowSize,
    attacker_shares:Number(weights.find(w=>w.address==='attacker')?.weight??0n),
    honest_shares:Number(weights.find(w=>w.address==='honest')?.weight??0n)};
}

/**
 * FAW/EFAW attacker-favorable opportunity envelope from REAL source share
 * payout weights; external fork wins, opportunities and costs are INPUT
 * ASSUMPTIONS, never measured consensus/mempool/network outcomes.
 * One "opportunity" is a hypothetical independent reward opportunity in the
 * reference period. This deliberately does NOT assert its occurrence rate.
 */
export function fawConditionalExternalOpportunity({ledger,withholdBasisPoints=10000,
  poolRewardAtoms=100000000n,externalRewardAtoms,assumedOpportunities,
  assumedForkWinBasisPoints,extraAttackCostAtoms=0n}={}){
  const internal=bwhConditionalPayoff({ledger,withholdBasisPoints,rewardAtoms:poolRewardAtoms});
  if(typeof externalRewardAtoms!=='bigint'||externalRewardAtoms<1n||
     !Number.isSafeInteger(assumedOpportunities)||assumedOpportunities<1||assumedOpportunities>100000||
     !Number.isSafeInteger(assumedForkWinBasisPoints)||
     assumedForkWinBasisPoints<0||assumedForkWinBasisPoints>10000||
     typeof extraAttackCostAtoms!=='bigint'||extraAttackCostAtoms<0n)
    throw new Error('invalid_faw_external_assumptions');
  const loss=BigInt(internal.minimum_external_benefit_to_break_even_atoms);
  const opportunities=BigInt(assumedOpportunities),totalExternal=externalRewardAtoms*opportunities;
  const needed=loss+extraAttackCostAtoms;
  const expectedExternal=totalExternal*BigInt(assumedForkWinBasisPoints)/BASIS;
  const requiredWinBps=(needed*BASIS+totalExternal-1n)/totalExternal;
  return {
    verdict:'CONDITIONAL_FAW_MULTIPOOL_OPPORTUNITY__NOT_OBSERVED_PROFIT',
    ownPoolWithholdingCostAtoms:loss.toString(),
    assumedExternalOpportunities:assumedOpportunities,
    assumedForkWinBasisPoints,
    assumedExtraAttackCostAtoms:extraAttackCostAtoms.toString(),
    expectedExternalAtoms:expectedExternal.toString(),
    expectedNetGainAtoms:(expectedExternal-needed).toString(),
    requiredForkWinBasisPointsCeil:requiredWinBps.toString(),
    // A 100% fork-win scenario is the explicit attacker-favorable model ceiling.
    // If even that cannot overcome the source-ledger withholding penalty and
    // declared attack costs, no lower conditional win probability can profit.
    maximumHypotheticalExternalAtoms:totalExternal.toString(),
    minimumHypotheticalBenefitRequiredAtoms:needed.toString(),
    anyConditionalWinRateCanProfit:totalExternal>needed,
    noProfitableForkWinRateUnderDeclaredInputs:totalExternal<=needed,
    conditionalScenarioAdvantageous:expectedExternal>needed,
    forkOpportunityRateVerified:false,
    empiricalForkWinProbabilityVerified:false,
    externalPoolPayoutVerified:false,
    realNetworkHashAndLatencyVerified:false,
    actualAttackerProfitabilityVerified:false
  };
}
