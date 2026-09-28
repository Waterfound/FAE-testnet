const DAY=86400,MONTH=30*DAY,YEAR=365.25*DAY;
const TARGETS=[
  {id:'180-active',seconds:180,rewardFae:10,economicStatus:'active-public-testnet'},
  {id:'300-incumbent',seconds:300,rewardFae:14,economicStatus:'preferred-research-candidate'},
  {id:'600-v2-reference',seconds:600,rewardFae:28,economicStatus:'v2-calendar-and-supply-neutral-reference-only'}
];
const SHARES=[0.1,0.01,0.001,0.0001];

function wait(target,share){
  return {meanSeconds:target/share,medianSeconds:Math.log(2)*target/share,p95Seconds:-Math.log(.05)*target/share};
}
function horizon(target,reward,share,seconds){
  const mu=share*seconds/target;
  const expected=mu*reward;
  const sigma=Math.sqrt(mu)*reward;
  return {expectedBlocks:mu,probabilityZeroBlocks:Math.exp(-mu),expectedPayoutFae:expected,payoutSigmaFae:sigma,coefficientOfVariation:mu?1/Math.sqrt(mu):null};
}
export function runMiningEconomics(){
  const rows={};
  for(const c of TARGETS){
    rows[c.id]={
      targetSeconds:c.seconds,rewardFae:c.rewardFae,economicStatus:c.economicStatus,
      networkIssuanceFaePerDay:DAY/c.seconds*c.rewardFae,
      miners:Object.fromEntries(SHARES.map(share=>[String(share),{
        share,waitToSoloBlock:wait(c.seconds,share),
        day:horizon(c.seconds,c.rewardFae,share,DAY),
        month30d:horizon(c.seconds,c.rewardFae,share,MONTH),
        year365_25d:horizon(c.seconds,c.rewardFae,share,YEAR)
      }]))
    };
  }
  const normalized={};
  const baseRate=14/300;
  for(const seconds of [180,300,600]){
    const reward=baseRate*seconds;
    normalized[String(seconds)]={
      targetSeconds:seconds,rewardFaeForEqualExpectedIssuanceRate:reward,
      sigmaRatioVs180:Math.sqrt(seconds/180),
      eventRateRatioVs180:180/seconds
    };
  }
  return {
    schema:'fae-180s-mining-economics/1',
    authority:'deterministic-model-only-no-consensus-authority',
    assumptions:{poisson_block_arrivals:true,miner_hash_share_constant:true,no_pool_fees:true,no_energy_costs:true},
    actual_and_research_packages:rows,
    equal_expected_issuance_normalization:normalized,
    conclusions:{
      event_frequency:'Shorter 180s target gives more solo reward events at a fixed miner share.',
      variance:'At equal expected issuance per time, payout sigma scales with sqrt(target); relative sigma is 1.291x at 300s and 1.826x at 600s versus 180s.',
      pool_pressure:'Probability of no solo block over a horizon is exp(-share*horizon/target); this is a pool-pressure proxy, not observed pool adoption.'
    },
    selectionAuthorized:false,activationAuthorized:false
  };
}
if(import.meta.url===new URL(process.argv[1],'file:').href)process.stdout.write(JSON.stringify(runMiningEconomics(),null,2)+'\n');
