import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {guaranteedClockSkewBudget,honestClockPairAccepted} from '../node/authoritative/difficulty-timestamp-template-policy.mjs';
import {activationPolicyDescriptor} from '../node/authoritative/activation-policy-identity-candidate.mjs';
import {validateActivatedHeader,validateMixedHeaderSequence,validateDownloadedBodies,rehearseHeadersFirstSync} from '../node/authoritative/full-target-headers-sync-candidate.mjs';
import {createShadowValidationFixture} from '../node/lab/full-target-shadow-validation-fixtures.mjs';
import {createFullTargetShadowPeerNode,SHADOW_TIMESTAMP_POLICY_STATUS} from '../node/lab/full-target-shadow-peer-node.mjs';

const fixture=createShadowValidationFixture('strong-b');
const {policy,trustedPrefix,initialChain:chain}=fixture;
const descriptor=activationPolicyDescriptor(policy);
const tip=chain.at(-1),arrivalBoundary=tip.timestamp_ms-policy.future_drift_ms;
const beforeTip=chain.slice(0,-1);

test('clock guarantee covers the whole relay interval, including zero delay',()=>{
  for(const skew of [0,30_000,45_000,46_000]){
    for(const relayBudget of [0,5_000,120_000]){
      const budget=guaranteedClockSkewBudget({clockSkewBudgetMs:skew,relayDelayBudgetMs:relayBudget});
      let maximumLead=0,allAccepted=true;
      for(const producer of [-skew,0,skew])for(const receiver of [-skew,0,skew])for(const relay of [0,Math.floor(relayBudget/2),relayBudget]){
        maximumLead=Math.max(maximumLead,producer-receiver-relay);
        allAccepted&&=honestClockPairAccepted({producerSkewMs:producer,receiverSkewMs:receiver,relayDelayMs:relay});
      }
      assert.equal(budget.worst_future_lead_ms,maximumLead);
      assert.equal(budget.ok,allAccepted);
      assert.equal(budget.headroom_ms,90_000-maximumLead);
    }
  }
  assert.deepEqual(guaranteedClockSkewBudget(),{ok:true,worst_future_lead_ms:60_000,headroom_ms:30_000});
});

test('activated header and body admission agree at the receiver wall',()=>{
  for(const height of [14,15]){
    const prefix=chain.slice(0,height-1),block=chain[height-1];
    for(const offset of [-1,0,1]){
      const nowMs=block.timestamp_ms-policy.future_drift_ms+offset;
      const verdict=validateActivatedHeader(prefix,block,policy,{nowMs});
      assert.equal(verdict.ok,offset>=0);
      if(offset<0){
        assert.equal(verdict.error,'timestamp_too_far_future');
        assert.throws(()=>validateDownloadedBodies(prefix,[block],[block],policy,{nowMs}),/timestamp_too_far_future/);
      }else assert.equal(validateDownloadedBodies(prefix,[block],[block],policy,{nowMs}).ok,true);
    }
  }
});

test('legacy admission retains its existing 120s wall across the mixed sequence',()=>{
  const block=chain[12],prefix=chain.slice(0,12);
  for(const offset of [-1,0,1]){
    const nowMs=block.timestamp_ms-120_000+offset;
    const headers=()=>validateMixedHeaderSequence(prefix,[block],policy,{nowMs});
    const bodies=()=>validateDownloadedBodies(prefix,[block],[block],policy,{nowMs});
    if(offset<0){assert.throws(headers,/header_bad_timestamp/);assert.throws(bodies,/header_bad_timestamp/)}
    else{assert.equal(headers().ok,true);assert.equal(bodies().ok,true)}
  }
});

test('intrinsic replay is clock-independent while preserving body validation',()=>{
  const suffix=chain.slice(trustedPrefix.length);
  for(const nowMs of [0,arrivalBoundary-1,tip.timestamp_ms]){
    const result=validateDownloadedBodies(trustedPrefix,suffix,suffix,policy,{nowMs,enforceFutureDrift:false});
    assert.equal(result.work.toString(),fixture.expected_work);
    assert.deepEqual(result.storage_chain,chain);
  }
  const mismatch=structuredClone(tip);mismatch.txids=['a'.repeat(64)];
  assert.throws(()=>validateDownloadedBodies(beforeTip,[tip],[mismatch],policy,{nowMs:0,enforceFutureDrift:false}),/tx/);
});

function syncOptions(extra={}){
  return{localChain:beforeTip,commonAncestorHeight:beforeTip.length,remotePolicyDescriptor:descriptor,
    remoteClaimedWork:BigInt(fixture.expected_work),remoteClaimedTipHash:tip.hash,policy,
    fetchHeaders:async()=>[structuredClone(tip)],fetchBlocks:async()=>[structuredClone(tip)],...extra};
}

test('premature headers defer sync before downloading bodies and retry at the exact wall',async()=>{
  let bodyRequests=0;
  const fetchBlocks=async()=>{bodyRequests++;return[structuredClone(tip)]};
  const deferred=await rehearseHeadersFirstSync(syncOptions({nowMs:arrivalBoundary-1,fetchBlocks}));
  assert.deepEqual(deferred,{ok:false,stage:'headers',error:'timestamp_too_far_future',blocks_requested:false});
  assert.equal(bodyRequests,0);
  const accepted=await rehearseHeadersFirstSync(syncOptions({nowMs:arrivalBoundary,fetchBlocks}));
  assert.equal(accepted.ok,true);assert.equal(accepted.preferred,true);assert.equal(bodyRequests,1);
});

test('the clock is sampled after headers arrive and again after bodies arrive',async()=>{
  let now=arrivalBoundary-1;
  const afterArrival=await rehearseHeadersFirstSync(syncOptions({clock:()=>now,
    fetchHeaders:async()=>{now=arrivalBoundary;return[structuredClone(tip)]}}));
  assert.equal(afterArrival.ok,true);
  const corrected=await rehearseHeadersFirstSync(syncOptions({clock:()=>now,
    fetchBlocks:async()=>{now=arrivalBoundary-1;return[structuredClone(tip)]}}));
  assert.deepEqual(corrected,{ok:false,stage:'blocks',error:'timestamp_too_far_future',blocks_requested:true});
});

test('an unavailable arrival clock fails closed before requesting bodies',async()=>{
  for(const now of [NaN,Infinity,-1,null,'1760000000000']){
    let bodyRequests=0;
    const result=await rehearseHeadersFirstSync(syncOptions({clock:()=>now,fetchBlocks:async()=>{bodyRequests++;return[tip]}}));
    assert.equal(result.error,'arrival_clock_invalid');assert.equal(result.stage,'headers');assert.equal(bodyRequests,0);
  }
});

test('shadow append, peer sync, durable replay and clock correction use the same admission boundary',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'fae-arrival-clock-')),nodes=[];
  let now=arrivalBoundary-1,readings=[];
  const clock=()=>readings.length?readings.shift():now;
  const receiverOptions={policy,trustedPrefix,clock,dataFile:join(dir,'receiver.json'),identityFile:join(dir,'receiver-identity.json')};
  try{
    const server=createFullTargetShadowPeerNode({...fixture,clock:()=>tip.timestamp_ms});
    const receiver=createFullTargetShadowPeerNode(receiverOptions);
    nodes.push(server,receiver);await server.start();await receiver.start();
    for(const block of chain.slice(trustedPrefix.length,-1))await receiver.appendBlock(block);
    const before=receiver.status(),durable=await readFile(receiverOptions.dataFile,'utf8');
    assert.equal(before.timestamp_policy,SHADOW_TIMESTAMP_POLICY_STATUS);
    await assert.rejects(()=>receiver.appendBlock(tip),/timestamp_too_far_future/);
    assert.deepEqual(receiver.status(),before);
    assert.equal(await readFile(receiverOptions.dataFile,'utf8'),durable);

    const deferred=await receiver.syncPeer(server.baseUrl());
    assert.equal(deferred.adopted,false);assert.equal(deferred.reason,'timestamp_too_far_future');assert.equal(deferred.stage,'headers');
    assert.deepEqual(receiver.status(),before);assert.equal(await readFile(receiverOptions.dataFile,'utf8'),durable);

    // Header and body validation succeed; the receiver clock is corrected just
    // before the serialized adoption step. No suffix may be committed yet.
    readings=[arrivalBoundary,arrivalBoundary,arrivalBoundary-1];
    const commitDeferred=await receiver.syncPeer(server.baseUrl());
    assert.equal(commitDeferred.adopted,false);assert.equal(commitDeferred.stage,'adoption');
    assert.equal(commitDeferred.reason,'timestamp_too_far_future');assert.equal(readings.length,0);
    assert.deepEqual(receiver.status(),before);assert.equal(await readFile(receiverOptions.dataFile,'utf8'),durable);

    now=arrivalBoundary;
    const accepted=await receiver.syncPeer(server.baseUrl());
    assert.equal(accepted.adopted,true);assert.equal(receiver.status().tip_hash,tip.hash);
    assert.equal(receiver.status().chain_work,fixture.expected_work);
    const persisted=await readFile(receiverOptions.dataFile,'utf8');
    await receiver.close();nodes.splice(nodes.indexOf(receiver),1);

    // A backward local-clock correction must not invalidate previously stored
    // history. No system clock or peer authentication clock is changed here.
    now=0;
    const restarted=createFullTargetShadowPeerNode(receiverOptions);nodes.push(restarted);await restarted.start();
    assert.equal(restarted.status().tip_hash,tip.hash);assert.equal(restarted.status().chain_work,fixture.expected_work);
    assert.equal(await readFile(receiverOptions.dataFile,'utf8'),persisted);
    assert.equal((await restarted.syncPeer(server.baseUrl())).reason,'already_current');
  }finally{await Promise.allSettled(nodes.map(node=>node.close()));await rm(dir,{recursive:true,force:true})}
});
