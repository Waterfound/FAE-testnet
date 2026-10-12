import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createFullTargetShadowPeerNode} from '../node/lab/full-target-shadow-peer-node.mjs';
import {createFullTargetShadowFaultProxy} from '../node/lab/full-target-shadow-fault-proxy.mjs';
import {createShadowValidationFixture} from '../node/lab/full-target-shadow-validation-fixtures.mjs';

async function persistedTip(file){const state=JSON.parse(await readFile(file,'utf8'));assert.ok(Array.isArray(state.chain)&&state.chain.length>0);return state.chain.at(-1).hash}

const dir=await mkdtemp(join(tmpdir(),'fae-shadow-mid-reorg-faults-'));
const nodes=[];
let proxy=null;
try{
  const trusted=createShadowValidationFixture('trusted');
  const weak=createShadowValidationFixture('weak-a');
  const strong=createShadowValidationFixture('strong-b');
  assert.equal(trusted.expected_weak_work,weak.expected_work);
  assert.equal(trusted.expected_strong_work,strong.expected_work);
  assert.ok(BigInt(strong.expected_work)>BigInt(weak.expected_work));

  const options=(name,fixture)=>({
    host:'127.0.0.1',port:0,
    dataFile:join(dir,`${name}.json`),
    identityFile:join(dir,`${name}-identity.json`),
    policy:fixture.policy,
    trustedPrefix:fixture.trustedPrefix,
    initialChain:fixture.initialChain
  });

  const a=createFullTargetShadowPeerNode(options('a',weak));
  const b=createFullTargetShadowPeerNode(options('b',strong));
  let c=createFullTargetShadowPeerNode(options('c',trusted));
  nodes.push(a,b,c);
  for(const node of nodes)await node.start();

  // Establish the persisted lower-work starting point first. This represents C
  // having converged to A before discovering B.
  const adoptWeak=await c.syncPeer(a.baseUrl());
  assert.equal(adoptWeak.adopted,true,`weak adoption failed: ${JSON.stringify(adoptWeak)}`);
  assert.equal(c.status().tip_hash,weak.expected_tip_hash);
  assert.equal(await persistedTip(join(dir,'c.json')),weak.expected_tip_hash);

  // Secure request order inside syncPeer is ancestor -> headers -> blocks.
  // Fault 1 truncates the headers response after the common ancestor is known.
  proxy=createFullTargetShadowFaultProxy({target:b.baseUrl(),host:'127.0.0.1',port:0,dropSecureOrdinal:2,label:'headers-cut'});
  await proxy.start();
  await assert.rejects(()=>c.syncPeer(proxy.baseUrl()));
  assert.equal(proxy.status().faults_injected,1);
  assert.equal(c.status().tip_hash,weak.expected_tip_hash,'headers interruption must not mutate live state');
  assert.equal(await persistedTip(join(dir,'c.json')),weak.expected_tip_hash,'headers interruption must not mutate persisted state');
  await proxy.close();proxy=null;

  // Fault 2 permits headers validation, then truncates the block-body response.
  // Candidate state must still remain entirely uncommitted.
  proxy=createFullTargetShadowFaultProxy({target:b.baseUrl(),host:'127.0.0.1',port:0,dropSecureOrdinal:3,label:'blocks-cut'});
  await proxy.start();
  await assert.rejects(()=>c.syncPeer(proxy.baseUrl()));
  assert.equal(proxy.status().faults_injected,1);
  assert.equal(c.status().tip_hash,weak.expected_tip_hash,'blocks interruption must not mutate live state');
  assert.equal(await persistedTip(join(dir,'c.json')),weak.expected_tip_hash,'blocks interruption must not mutate persisted state');
  await proxy.close();proxy=null;

  // Restore connectivity through the same proxy implementation with injection
  // disabled. A fresh secure session must repeat validation and atomically commit.
  proxy=createFullTargetShadowFaultProxy({target:b.baseUrl(),host:'127.0.0.1',port:0,dropSecureOrdinal:0,label:'recovered-link'});
  await proxy.start();
  const recovered=await c.syncPeer(proxy.baseUrl());
  assert.equal(recovered.adopted,true,`recovery sync failed: ${JSON.stringify(recovered)}`);
  assert.equal(recovered.headers_validated,3);
  assert.equal(recovered.blocks_validated,3);
  assert.equal(proxy.status().faults_injected,0);
  assert.equal(c.status().tip_hash,strong.expected_tip_hash);
  assert.equal(c.status().chain_work,strong.expected_work);
  assert.equal(await persistedTip(join(dir,'c.json')),strong.expected_tip_hash);
  await proxy.close();proxy=null;

  // Once strong B is committed, reachable weak A must never cause rollback.
  const rollback=await c.syncPeer(a.baseUrl());
  assert.equal(rollback.adopted,false);
  assert.equal(rollback.reason,'validated_but_not_preferred');
  assert.equal(c.status().tip_hash,strong.expected_tip_hash);

  // Restart from disk after the interrupted attempts and successful recovery.
  // The recovered tip must survive with no repair or copied state.
  await c.close();
  nodes.splice(nodes.indexOf(c),1);
  c=createFullTargetShadowPeerNode(options('c',trusted));
  nodes.push(c);
  await c.start();
  assert.equal(c.status().tip_hash,strong.expected_tip_hash);
  assert.equal(c.status().chain_work,strong.expected_work);
  assert.equal(c.status().secure_context_binding,c.status().policy_id);
  const current=await c.syncPeer(b.baseUrl());
  assert.equal(current.adopted,false);
  assert.equal(current.reason,'already_current');

  console.log(JSON.stringify({
    status:'PASS',shadow_only:true,
    scenario:'mid-reorg-network-interruption-recovery',
    reusable_fault_proxy:true,common_ancestor_height:12,crosses_activation:true,
    headers_response_interrupted:true,blocks_response_interrupted:true,
    no_partial_live_adoption:true,no_partial_persisted_adoption:true,
    fresh_session_recovery:true,stronger_work_selected:true,
    lower_work_rollback_rejected:true,persistence_restart:true
  }));
}finally{
  await proxy?.close().catch(()=>{});
  await Promise.allSettled(nodes.map(node=>node.close()));
  await rm(dir,{recursive:true,force:true});
}
