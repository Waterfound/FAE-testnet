import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createFullTargetShadowPeerNode} from '../node/lab/full-target-shadow-peer-node.mjs';
import {createShadowValidationFixture} from '../node/lab/full-target-shadow-validation-fixtures.mjs';
import {EclipseResistantDiscoveryCandidate} from '../node/authoritative/eclipse-resistant-discovery-candidate.mjs';

const dir=await mkdtemp(join(tmpdir(),'fae-colony-network-composition-'));
const live=[];
let victim=null,strong=null;
let gatedAttempts=0;

function paths(name,fixture,host,port=0){
  return{
    host,port,
    dataFile:join(dir,`${name}-state.json`),
    identityFile:join(dir,`${name}-identity.json`),
    policy:fixture.policy,
    trustedPrefix:fixture.trustedPrefix,
    initialChain:fixture.initialChain
  };
}
async function gatedSync(discovery,node,endpoint){
  const assessment=discovery.assessment();
  if(!assessment.ready)return{attempted:false,adopted:false,reason:'peer_diversity_hold',assessment};
  gatedAttempts++;
  return{attempted:true,assessment,...await node.syncPeer(endpoint)};
}

try{
  const trusted=createShadowValidationFixture('trusted');
  const weakFixture=createShadowValidationFixture('weak-a');
  const strongFixture=createShadowValidationFixture('strong-b');
  assert.equal(trusted.policy.activation_height,14);
  assert.equal(weakFixture.expected_height,15);
  assert.equal(strongFixture.expected_height,15);
  assert.ok(BigInt(strongFixture.expected_work)>BigInt(weakFixture.expected_work));

  const weak=createFullTargetShadowPeerNode(paths('weak',weakFixture,'127.21.0.1'));
  const diverseA=createFullTargetShadowPeerNode(paths('diverse-a',trusted,'127.31.0.1'));
  const diverseB=createFullTargetShadowPeerNode(paths('diverse-b',trusted,'127.41.0.1'));
  victim=createFullTargetShadowPeerNode(paths('victim',trusted,'127.51.0.1'));
  const strongCold=createFullTargetShadowPeerNode(paths('strong',strongFixture,'127.11.0.1'));
  for(const node of[weak,diverseA,diverseB,victim,strongCold]){await node.start();live.push(node)}

  const strongEndpoint=strongCold.baseUrl(),strongIdentity=strongCold.identity.id;
  const strongPort=Number(new URL(strongEndpoint).port);
  let clock=1_930_000_000_000;
  const discovery=new EclipseResistantDiscoveryCandidate({
    pinnedIdentityIds:[strongIdentity],
    failureBackoffMs:100,maxFailureBackoffMs:1_000,healthyReprobeMs:10_000,
    now:()=>clock
  });
  const observations=[
    {endpoint:strongEndpoint,identityId:strongIdentity,source:'out-of-band-anchor'},
    {endpoint:weak.baseUrl(),identityId:weak.identity.id,source:'gossip'},
    {endpoint:diverseA.baseUrl(),identityId:diverseA.identity.id,source:'gossip'},
    {endpoint:diverseB.baseUrl(),identityId:diverseB.identity.id,source:'gossip'}
  ];
  assert.equal(discovery.ingest(observations),4);
  for(const row of observations)discovery.markProbeResult({identityId:row.identityId,endpoint:row.endpoint,ok:true});
  let assessment=discovery.assessment();
  assert.equal(assessment.state,'READY');
  assert.equal(assessment.livePinned,1);
  assert.ok(assessment.distinctNetworkGroups>=4);

  // Before the partition the peer view is READY. The victim is allowed to adopt
  // the weak branch, which already crosses H14. This gives the later reconnect a
  // real cross-activation reorg rather than a simple catch-up.
  const weakAdoption=await gatedSync(discovery,victim,weak.baseUrl());
  assert.equal(weakAdoption.attempted,true);
  assert.equal(weakAdoption.adopted,true);
  assert.equal(victim.status().tip_hash,weakFixture.expected_tip_hash);
  assert.equal(victim.status().height,15);

  // Partition the pinned independent anchor. Three ordinary peers remain live in
  // three different /24 groups, but loss of the pinned identity must force HOLD.
  await strongCold.close();
  live.splice(live.indexOf(strongCold),1);
  discovery.disconnect(strongIdentity,strongEndpoint);
  assessment=discovery.assessment();
  assert.equal(assessment.state,'HOLD');
  assert.equal(assessment.livePinned,0);
  assert.ok(assessment.distinctIdentities>=3);
  assert.ok(assessment.distinctNetworkGroups>=3);
  const attemptsBeforeHold=gatedAttempts;
  const blocked=await gatedSync(discovery,victim,weak.baseUrl());
  assert.equal(blocked.attempted,false);
  assert.equal(blocked.reason,'peer_diversity_hold');
  assert.equal(gatedAttempts,attemptsBeforeHold,'HOLD must stop sync before network/fork-choice mutation');
  assert.equal(victim.status().tip_hash,weakFixture.expected_tip_hash);

  // Reconnect the same pinned identity at the same endpoint. No identity swap is
  // allowed. Once authenticated, READY returns and the stronger branch can be
  // validated and atomically adopted across the activation boundary.
  strong=createFullTargetShadowPeerNode(paths('strong',strongFixture,'127.11.0.1',strongPort));
  await strong.start();live.push(strong);
  assert.equal(strong.identity.id,strongIdentity);
  assert.equal(strong.baseUrl(),strongEndpoint);
  clock+=101;
  discovery.markProbeResult({identityId:strongIdentity,endpoint:strongEndpoint,ok:true});
  assessment=discovery.assessment();
  assert.equal(assessment.state,'READY');
  assert.equal(assessment.livePinned,1);
  const recovery=await gatedSync(discovery,victim,strongEndpoint);
  assert.equal(recovery.attempted,true);
  assert.equal(recovery.adopted,true,JSON.stringify(recovery));
  assert.equal(recovery.headers_validated,3);
  assert.equal(recovery.blocks_validated,3);
  assert.equal(victim.status().tip_hash,strongFixture.expected_tip_hash);
  assert.equal(victim.status().chain_work,strongFixture.expected_work);

  // With peer diversity healthy again, the old weak branch may be examined but
  // cumulative-work fork choice must reject rollback.
  const rollback=await gatedSync(discovery,victim,weak.baseUrl());
  assert.equal(rollback.attempted,true);
  assert.equal(rollback.adopted,false);
  assert.equal(rollback.reason,'validated_but_not_preferred');
  assert.equal(victim.status().tip_hash,strongFixture.expected_tip_hash);

  // Restart after isolation + reconnect + reorg. Persisted state must retain the
  // strong branch without depending on discovery process memory.
  await victim.close();live.splice(live.indexOf(victim),1);
  victim=createFullTargetShadowPeerNode(paths('victim',trusted,'127.51.0.1'));
  await victim.start();live.push(victim);
  assert.equal(victim.status().tip_hash,strongFixture.expected_tip_hash);
  assert.equal(victim.status().chain_work,strongFixture.expected_work);
  assert.equal(victim.status().activation_height,14);

  console.log(JSON.stringify({
    status:'PASS',
    authority:'lab-only-no-consensus-authority',
    activation_height:14,
    weak_branch_crossed_activation:true,
    pinned_anchor_partition_forces_hold:true,
    hold_blocks_sync_before_mutation:true,
    same_identity_reconnect:true,
    reconnect_reorg_to_stronger_cross_activation_branch:true,
    lower_work_rollback_rejected:true,
    persisted_restart_after_recovery:true,
    real_loopback_network_groups:4
  }));
}finally{
  await Promise.allSettled(live.map(node=>node.close()));
  await rm(dir,{recursive:true,force:true});
}
