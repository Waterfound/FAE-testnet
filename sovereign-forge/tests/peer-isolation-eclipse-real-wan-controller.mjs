import {mkdir,writeFile} from 'node:fs/promises';
import {createAuthoritativeV4PeerNodeEclipseCandidate} from '../node/authoritative/fae-v4-peer-node-eclipse-candidate.mjs';
import {networkGroupForEndpoint} from '../node/authoritative/peer-diversity.mjs';
import {emptyState,appendBlockFromFeed} from '../node/authoritative/fae-v4-core.mjs';
import {legacyBlocks} from './legacy-testnet-fixture.mjs';

const token=process.env.GH_TOKEN,repo=process.env.GITHUB_REPOSITORY,issue=process.env.ISSUE_NUMBER,run=String(process.env.GITHUB_RUN_ID||''),artifactDir=process.env.WAN_ARTIFACT_DIR||'/tmp/fae-eclipse-wan-controller';
if(!token||!repo||!issue||!run)throw new Error('WAN controller requires GH_TOKEN, GITHUB_REPOSITORY, ISSUE_NUMBER and GITHUB_RUN_ID');
const api=`https://api.github.com/repos/${repo}/issues/${issue}`,headers={Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'};
function legacyState(){let state=emptyState();for(const block of legacyBlocks)state=appendBlockFromFeed(state,block,new Map(),{activationHeight:null});return state}
async function comments(){const response=await fetch(`${api}/comments?per_page=100`,{headers});if(!response.ok)throw new Error(`comments ${response.status}`);return response.json()}
async function post(marker,payload){const response=await fetch(`${api}/comments`,{method:'POST',headers,body:JSON.stringify({body:`${marker} ${JSON.stringify(payload)}`})});if(!response.ok)throw new Error(`post ${marker} ${response.status}`)}
async function waitFor(predicate,label,timeoutMs=600_000){const start=Date.now();while(Date.now()-start<timeoutMs){for(const row of await comments()){const body=String(row.body||''),space=body.indexOf(' ');if(space<1)continue;let value;try{value=JSON.parse(body.slice(space+1))}catch{continue}if(String(value.run_id)!==run)continue;if(predicate(body.slice(0,space),value))return value}await new Promise(resolve=>setTimeout(resolve,2000))}throw new Error(`timeout waiting for ${label}`)}
const waitRole=role=>waitFor((marker,value)=>marker==='FAE_ECLIPSE_WAN_PEER'&&value.role===role,`peer ${role}`);
const waitAnchor=phase=>waitFor((marker,value)=>marker==='FAE_ECLIPSE_WAN_ANCHOR'&&value.phase===phase,`anchor ${phase}`);

await mkdir(artifactDir,{recursive:true});
let victim=null,outcome='failure',failure=null;
try{
  const [o1,o2,o3,anchor]=await Promise.all(['O1','O2','O3','ANCHOR'].map(waitRole));
  const all=[o1,o2,o3,anchor],boots=new Set(all.map(row=>row.boot_id));
  if(boots.size!==4)throw new Error(`expected four distinct runner boot IDs, got ${boots.size}`);
  if(new Set([o1.provider,o2.provider,o3.provider]).size!==3)throw new Error('ordinary peers must use three distinct tunnel providers');
  const ordinary=[o1,o2,o3],ordinaryGroups=new Set(ordinary.map(row=>networkGroupForEndpoint(row.endpoint)));
  if(ordinaryGroups.size!==3)throw new Error(`expected three ordinary network groups, got ${[...ordinaryGroups].join(',')}`);
  if(anchor.height!==13||ordinary.some(row=>row.height!==11))throw new Error('unexpected initial WAN chain heights');
  await waitFor((marker,value)=>marker==='FAE_ECLIPSE_WAN_OBSERVER'&&value.ok===true,'independent pre-isolation observer',300_000);

  let clock=1_930_000_000_000;
  victim=createAuthoritativeV4PeerNodeEclipseCandidate({
    initialState:legacyState(),host:'127.0.0.1',port:19787,
    knownPeers:ordinary.map(row=>({endpoint:row.endpoint,identityId:row.identityId,source:`real-wan-${row.role}`})),
    pinnedPeers:[{endpoint:anchor.endpoint,identityId:anchor.identityId,source:'real-wan-out-of-band-anchor'}],
    peerDiversityOptions:{minDistinctIdentities:3,minDistinctNetworkGroups:3,minPinnedIdentities:1,maxPerNetworkGroup:2},
    eclipseDiscoveryOptions:{now:()=>clock,failureBackoffMs:100,maxFailureBackoffMs:1000,healthyReprobeMs:1000,maxProbeBatch:8}
  });
  await victim.start();

  await post('FAE_ECLIPSE_WAN_PHASE',{run_id:run,phase:'isolate'});
  await waitAnchor('anchor-offline');
  const isolatedResults=await victim.syncPeers(),isolated=victim.status().peer_diversity;
  const ordinarySuccesses=isolatedResults.filter(row=>row.ok&&row.peer_id!==anchor.identityId);
  const anchorFailure=isolatedResults.find(row=>row.peer_id===anchor.identityId);
  if(ordinarySuccesses.length!==3)throw new Error(`expected 3 reachable ordinary peers, got ${ordinarySuccesses.length}`);
  if(!anchorFailure||anchorFailure.ok!==false)throw new Error('offline real-WAN anchor did not fail closed');
  if(isolated.state!=='HOLD'||isolated.livePinned!==0||isolated.distinctIdentities!==3||isolated.distinctNetworkGroups!==3)throw new Error(`invalid isolated assessment ${JSON.stringify(isolated)}`);
  if(victim.status().height!==11)throw new Error('victim changed chain while stronger anchor was isolated');

  await post('FAE_ECLIPSE_WAN_PHASE',{run_id:run,phase:'recover'});
  await waitAnchor('anchor-online');clock+=101;
  const recoveredResults=await victim.syncPeers(),anchorRecovery=recoveredResults.find(row=>row.peer_id===anchor.identityId),recovered=victim.status().peer_diversity;
  if(!anchorRecovery||!anchorRecovery.ok||!anchorRecovery.adopted)throw new Error(`anchor recovery did not adopt stronger chain: ${JSON.stringify(anchorRecovery)}`);
  if(victim.status().height!==13||recovered.state!=='READY'||recovered.livePinned!==1)throw new Error(`invalid recovered assessment ${JSON.stringify(recovered)}`);

  await post('FAE_ECLIPSE_WAN_PHASE',{run_id:run,phase:'reloss'});
  await waitAnchor('anchor-reoffline');clock+=1001;
  const relostResults=await victim.syncPeers(),anchorReloss=relostResults.find(row=>row.peer_id===anchor.identityId),relost=victim.status().peer_diversity;
  if(!anchorReloss||anchorReloss.ok!==false)throw new Error('second real-WAN anchor loss was not observed');
  if(relost.state!=='HOLD'||relost.livePinned!==0)throw new Error(`readiness remained sticky ${JSON.stringify(relost)}`);
  if(victim.status().height!==13)throw new Error('valid recovered chain was damaged by peer-view degradation');

  const evidence={ok:true,gate:3,transport:'public-real-wan',protocol:6,runner_boot_ids:[...boots],ordinary_providers:ordinary.map(row=>row.provider),ordinary_network_groups:[...ordinaryGroups],anchor_provider:anchor.provider,isolated:{state:isolated.state,livePinned:isolated.livePinned,identities:isolated.distinctIdentities,groups:isolated.distinctNetworkGroups,height:11},recovered:{state:recovered.state,livePinned:recovered.livePinned,height:13,stronger_chain_adopted:true},relost:{state:relost.state,livePinned:relost.livePinned,height:13,sticky_readiness:false},consensus_path:'unchanged-authoritative-protocol6'};
  await writeFile(`${artifactDir}/evidence.json`,JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
  await post('FAE_ECLIPSE_WAN_RESULT',{run_id:run,...evidence});outcome='success';
}catch(error){failure=String(error?.stack||error);console.error(failure);await writeFile(`${artifactDir}/failure.txt`,failure).catch(()=>{});throw error}
finally{
  if(victim)await victim.close().catch(()=>{});
  await post('FAE_ECLIPSE_WAN_PHASE',{run_id:run,phase:'done',outcome,failure:failure?failure.slice(0,500):null}).catch(()=>{});
}
