const TARGETS=[180,300,600],OUTAGES=[60,120,180,208,300,600];
function poissonAtLeastOne(mu){return 1-Math.exp(-mu)}
function poissonAtLeastTwo(mu){return 1-Math.exp(-mu)*(1+mu)}
export function runOutageRecovery(){
 const table={};
 for(const seconds of OUTAGES){
   table[String(seconds)]={};
   for(const target of TARGETS){
     const mu=seconds/target;
     table[String(seconds)][String(target)]={
       expectedBlocksDuringIsolation:mu,
       probabilityAtLeastOneBlock:poissonAtLeastOne(mu),
       probabilityAtLeastTwoBlocks:poissonAtLeastTwo(mu)
     };
   }
 }
 return {
  schema:'fae-180s-outage-recovery-model/1',
  authority:'analytical-and-replay-context-only-no-consensus-authority',
  model:'Poisson block arrivals during isolation; does not model actual peer topology, chainwork distribution or recovery transport.',
  table,
  historical208sCase:{
    reportedTargetSeconds:180,reportedDivergenceSeconds:208,frozenGateSeconds:180,reportedRunOutcome:'FAIL',
    modelAt180:table['208']['180'],
    interpretation:'At 180s, a 208s isolation spans 1.156 expected blocks; the idealized probability of at least one block elsewhere is ~68.5% and at least two ~32.1%. This contextualizes the recovery pressure but does not assign causality for V2.'
  },
  priorRecoveryEvidence:[
    {commit:'49270aabfd75ab36b7d1e63230303cd9c2b700d7',claim:'deterministic mid-reorg transport interruption; atomic no-partial adoption; fresh-session/restart recovery',directness:'directional-to-block-time'},
    {commit:'c402e75e71930812a3c94932595691eac0a283aa',claim:'four-runner public-WAN recovery with independent observer, interruption, crash/restart and rollback resistance',directness:'directional-to-block-time'},
    {commit:'66c7c1d30a11d2750bcb5635797a175ab33765b3',claim:'public-WAN recovery retained across two zero-cost tunnel transports',directness:'directional-to-block-time'},
    {commit:'efacaf516b12c8ea24ca6e3632d414f97c02a93c',claim:'operator-neutral recovery gate passed 5/5 sealed replays with fail-closed verification',directness:'directional-to-block-time'}
  ],
  limitations:[
    'Historical V2 raw authoritative bundle was not located by F180-01; the 208s case retains a provenance gap.',
    'A longer target lowers the chance of a competing block during a fixed outage but also slows normal confirmations and reward events.',
    'Stability Soak V3 remains a separate operational gate and is not substituted.'
  ],
  selectionAuthorized:false,activationAuthorized:false
 };
}
if(import.meta.url===new URL(process.argv[1],'file:').href)process.stdout.write(JSON.stringify(runOutageRecovery(),null,2)+'\n');
