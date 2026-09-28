const TARGETS=[180,300,600];
const DELAYS=[0.1,0.128,0.5,1,2,5,10];
export function raceProbability(delay,target){return 1-Math.exp(-delay/target)}
export function noCompetingBlock(delay,target){return Math.exp(-delay/target)}
export function runDecentralizationSensitivity(){
  const table={};
  for(const target of TARGETS){
    table[String(target)]={
      raceByDelaySeconds:Object.fromEntries(DELAYS.map(d=>[String(d),raceProbability(d,target)])),
      relativeAcceptedEventAdvantageFast0_1sVsSlow:{
        slow0_5s:noCompetingBlock(.1,target)/noCompetingBlock(.5,target)-1,
        slow1s:noCompetingBlock(.1,target)/noCompetingBlock(1,target)-1,
        slow2s:noCompetingBlock(.1,target)/noCompetingBlock(2,target)-1,
        slow5s:noCompetingBlock(.1,target)/noCompetingBlock(5,target)-1,
        slow10s:noCompetingBlock(.1,target)/noCompetingBlock(10,target)-1
      }
    };
  }
  return {
    schema:'fae-180s-decentralization-sensitivity/1',
    authority:'analytical-sensitivity-only-no-consensus-authority',
    model:'first-order Poisson competing-block race; accepted-event proxy exp(-delay/target)',
    table,
    interpretation:{
      direction:'For the same absolute propagation disadvantage, shorter targets amplify low-latency advantage.',
      example180:'A 0.1s vs 5s delay gap yields ~2.76% first-order accepted-event advantage; 0.1s vs 10s yields ~5.65%.',
      evidenceBoundary:'This is sensitivity analysis, not observed FAE miner revenue or proof of datacenter centralization.'
    },
    selectionAuthorized:false,activationAuthorized:false
  };
}
if(import.meta.url===new URL(process.argv[1],'file:').href)process.stdout.write(JSON.stringify(runDecentralizationSensitivity(),null,2)+'\n');
