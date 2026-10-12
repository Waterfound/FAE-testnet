import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createFullTargetShadowPeerNode} from '../node/lab/full-target-shadow-peer-node.mjs';
import {createShadowValidationFixture} from '../node/lab/full-target-shadow-validation-fixtures.mjs';
import {EclipseResistantDiscoveryCandidate} from '../node/authoritative/eclipse-resistant-discovery-candidate.mjs';
import {evaluateActivationReconnect} from '../node/authoritative/activation-network-composition-candidate.mjs';

const dir=await mkdtemp(join(tmpdir(),'fae-colony-d-runtime-diff-'));
const live=[];
let victim=null,strong=null;

function options(name,fixture,host,port=0){return{
  host,port,dataFile:join(dir,`${name}.json`),identityFile:join(dir,`${name}-identity.json`),
  policy:fixture.policy,trustedPrefix:fixture.trustedPrefix,initialChain:fixture.initialChain
};}
function headerRecord(block){
  const row={
    height:Number(block.height),hash:String(block.hash),previous_hash:String(block.previous_hash),
    timestamp_ms:Number(block.timestamp_ms),reward_atoms:String(block.reward_atoms),header_json:structuredClone(block.header_json)
  };
  if(block.difficulty_bits!==undefined)row.difficulty_bits=Number(block.difficulty_bits);
  if(block.target_hex!==undefined)row.target_hex=String(block.target_hex);
  return row;
}
async function runtimeGate(discovery,node,endpoint){
  const assessment=discovery.assessment();
  if(!assessment.ready)return{attempted:false,reason:'peer_view_not_ready',assessment};
  return{attempted:true,assessment,...await node.syncPeer(endpoint)};
}

try{
  const trusted=createShadowValidationFixture('trusted');
  const weakFixture=createShadowValidationFixture('weak-a');
  const strongFixture=createShadowValidationFixture('strong-b');
  assert.ok(BigInt(strongFixture.expected_work)>BigInt(weakFixture.expected_work));

  const weak=createFullTargetShadowPeerNode(options('weak',weakFixture,'127.21.0.1'));
  const peerA=createFullTargetShadowPeerNode(options('peer-a',trusted,'127.31.0.1'));
  const peerB=createFullTargetShadowPeerNode(options('peer-b',trusted,'127.41.0.1'));
  victim=createFullTargetShadowPeerNode(options('victim',trusted,'127.51.0.1'));
  const strongCold=createFullTargetShadowPeerNode(options('strong',strongFixture,'127.11.0.1'));
  for(const node of[weak,peerA,peerB,victim,strongCold]){await node.start();live.push(node)}

  const strongEndpoint=strongCold.baseUrl(),strongIdentity=strongCold.identity.id,strongPort=Number(new URL(strongEndpoint).port);
  let clock=1_940_000_000_000;
  const discovery=new EclipseResistantDiscoveryCandidate({
    pinnedIdentityIds:[strongIdentity],now:()=>clock,
    failureBackoffMs:100,maxFailureBackoffMs:1_000,healthyReprobeMs:10_000
  });
  const observations=[
    {endpoint:strongEndpoint,identityId:strongIdentity,source:'out-of-band-anchor'},
    {endpoint:weak.baseUrl(),identityId:weak.identity.id,source:'gossip'},
    {endpoint:peerA.baseUrl(),identityId:peerA.identity.id,source:'gossip'},
    {endpoint:peerB.baseUrl(),identityId:peerB.identity.id,source:'gossip'}
  ];
  discovery.ingest(observations);
  for(const row of observations)discovery.markProbeResult({identityId:row.identityId,endpoint:row.endpoint,ok:true});
  assert.equal(discovery.assessment().state,'READY');

  // Establish the lower-work cross-activation runtime state while peer authority
  // is healthy. The fixture forks at H13 and both branches cross H14 activation.
  const weakAdoption=await runtimeGate(discovery,victim,weak.baseUrl());
  assert.equal(weakAdoption.attempted,true);assert.equal(weakAdoption.adopted,true);
  assert.equal(victim.status().tip_hash,weakFixture.expected_tip_hash);

  // Remove the pinned independent anchor. The real discovery component moves to
  // HOLD despite three remaining network groups. Colony D must reach the same
  // decision before invoking either remote fetch callback.
  await strongCold.close();live.splice(live.indexOf(strongCold),1);
  discovery.disconnect(strongIdentity,strongEndpoint);
  const holdView=discovery.assessment();
  assert.equal(holdView.state,'HOLD');assert.equal(holdView.livePinned,0);
  let holdTouches=0;
  const holdOracle=await evaluateActivationReconnect({
    localChain:victim.getChain(),commonAncestorHeight:12,remotePolicyDescriptor:strongCold.descriptor,
    policy:trusted.policy,peerView:holdView,
    fetchHeaders:async()=>{holdTouches++;return[]},fetchBlocks:async()=>{holdTouches++;return[]}
  });
  assert.equal(holdOracle.adoption_permitted,false);assert.equal(holdOracle.reason,'peer_view_not_ready');
  assert.equal(holdOracle.remote_touched,false);assert.equal(holdTouches,0);
  const blockedRuntime=await runtimeGate(discovery,victim,weak.baseUrl());
  assert.equal(blockedRuntime.attempted,false);assert.equal(victim.status().tip_hash,weakFixture.expected_tip_hash);

  // Restore exactly the same pinned identity and endpoint, then evaluate the same
  // stronger branch independently in Colony D and in the real shadow runtime.
  strong=createFullTargetShadowPeerNode(options('strong',strongFixture,'127.11.0.1',strongPort));
  await strong.start();live.push(strong);
  assert.equal(strong.identity.id,strongIdentity);assert.equal(strong.baseUrl(),strongEndpoint);
  clock+=101;discovery.markProbeResult({identityId:strongIdentity,endpoint:strongEndpoint,ok:true});
  const readyView=discovery.assessment();assert.equal(readyView.state,'READY');assert.equal(readyView.livePinned,1);

  const strongSuffix=strongFixture.initialChain.slice(12);
  const oracle=await evaluateActivationReconnect({
    localChain:victim.getChain(),commonAncestorHeight:12,
    remotePolicyDescriptor:strong.descriptor,remoteClaimedWork:BigInt(strongFixture.expected_work),
    remoteClaimedTipHash:strongFixture.expected_tip_hash,policy:trusted.policy,peerView:readyView,
    nowMs:Math.max(...strongSuffix.map(row=>Number(row.timestamp_ms))),
    fetchHeaders:async()=>strongSuffix.map(headerRecord),
    fetchBlocks:async()=>structuredClone(strongSuffix)
  });
  assert.equal(oracle.ok,true);assert.equal(oracle.adoption_permitted,true);assert.equal(oracle.adopted,true);
  assert.equal(oracle.classification.activation_crossing_reorg,true);
  assert.equal(oracle.selected_tip_hash,strongFixture.expected_tip_hash);
  assert.equal(oracle.remote_work,BigInt(strongFixture.expected_work));

  const runtime=await runtimeGate(discovery,victim,strongEndpoint);
  assert.equal(runtime.attempted,true);assert.equal(runtime.adopted,true,JSON.stringify(runtime));
  assert.equal(victim.status().tip_hash,oracle.selected_tip_hash);
  assert.equal(victim.status().chain_work,oracle.remote_work.toString());

  // Both layers must reject a return to the lower-work branch after recovery.
  const weakSuffix=weakFixture.initialChain.slice(12);
  const weakOracle=await evaluateActivationReconnect({
    localChain:victim.getChain(),commonAncestorHeight:12,remotePolicyDescriptor:weak.descriptor,
    remoteClaimedWork:BigInt(weakFixture.expected_work),remoteClaimedTipHash:weakFixture.expected_tip_hash,
    policy:trusted.policy,peerView:readyView,
    nowMs:Math.max(...weakSuffix.map(row=>Number(row.timestamp_ms))),
    fetchHeaders:async()=>weakSuffix.map(headerRecord),fetchBlocks:async()=>structuredClone(weakSuffix)
  });
  assert.equal(weakOracle.ok,true);assert.equal(weakOracle.adopted,false);assert.equal(weakOracle.preferred,false);
  const weakRuntime=await runtimeGate(discovery,victim,weak.baseUrl());
  assert.equal(weakRuntime.attempted,true);assert.equal(weakRuntime.adopted,false);assert.equal(weakRuntime.reason,'validated_but_not_preferred');
  assert.equal(victim.status().tip_hash,strongFixture.expected_tip_hash);

  // Persisted restart is intentionally a runtime-only property; it must preserve
  // the same tip/work that Colony D selected without persisting the oracle itself.
  await victim.close();live.splice(live.indexOf(victim),1);
  victim=createFullTargetShadowPeerNode(options('victim',trusted,'127.51.0.1'));
  await victim.start();live.push(victim);
  assert.equal(victim.status().tip_hash,oracle.selected_tip_hash);
  assert.equal(victim.status().chain_work,oracle.remote_work.toString());

  console.log(JSON.stringify({
    status:'PASS',scope:'post-integration-differential',candidate_only:true,
    real_discovery_hold_matches_colony_d:true,hold_remote_touches:holdTouches,
    stronger_cross_activation_selection_matches_runtime:true,
    lower_work_rejection_matches_runtime:true,persisted_restart_matches_oracle_selection:true,
    activation_height:trusted.policy.activation_height
  }));
}finally{
  await Promise.allSettled(live.map(node=>node.close()));
  await rm(dir,{recursive:true,force:true});
}
