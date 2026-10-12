import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createAuthoritativeV4PeerNode} from '../node/authoritative/fae-v4-peer-node.mjs';
import {freezeActivationPolicy} from '../node/authoritative/activation-reorg-candidate.mjs';
import {activationPolicyDescriptor,assertActivationPolicyCompatible} from '../node/authoritative/activation-policy-identity-candidate.mjs';

function optionsFor(dir,name,{policy=null,descriptorOverride=null,bindingOverride=undefined}={}){
  const descriptor=descriptorOverride??(policy?activationPolicyDescriptor(policy):null);
  const binding=bindingOverride===undefined?(descriptor?.policy_id??null):bindingOverride;
  return{
    host:'127.0.0.1',port:0,syncIntervalMs:0,
    dataFile:join(dir,`${name}-state.json`),identityFile:join(dir,`${name}-identity.json`),peerTrustFile:join(dir,`${name}-trust.json`),
    peerDiversityOptions:{minDistinctIdentities:0,minDistinctNetworkGroups:0,minPinnedIdentities:0,maxPerNetworkGroup:8},
    secureChannelOptions:{contextBinding:binding},
    peerHelloExtensions:descriptor?{daa_activation_policy:descriptor}:null,
    peerHelloValidator:policy?(hello=>assertActivationPolicyCompatible(policy,hello?.daa_activation_policy)):null
  };
}
async function started(options){const node=createAuthoritativeV4PeerNode(options);await node.start();return node;}

const dir=await mkdtemp(join(tmpdir(),'fae-policy-negotiation-'));
const nodes=[];
try{
  const policyA=freezeActivationPolicy({activationHeight:500});
  const policyB=freezeActivationPolicy({activationHeight:501});
  const descriptorA=activationPolicyDescriptor(policyA);

  assert.throws(()=>createAuthoritativeV4PeerNode({...optionsFor(dir,'reserved'),peerHelloExtensions:{network:'evil'}}),/peer_hello_extension_reserved:network/);
  assert.throws(()=>createAuthoritativeV4PeerNode({...optionsFor(dir,'bad-validator'),peerHelloValidator:'not-a-function'}),/peer_hello_validator_must_be_function/);

  const a=await started(optionsFor(dir,'a',{policy:policyA}));nodes.push(a);
  const same=await started(optionsFor(dir,'same',{policy:policyA}));nodes.push(same);
  const mismatch=await started(optionsFor(dir,'mismatch',{policy:policyB}));nodes.push(mismatch);
  const legacy=await started(optionsFor(dir,'legacy'));nodes.push(legacy);
  const legacy2=await started(optionsFor(dir,'legacy2'));nodes.push(legacy2);
  const tamperedDescriptor={...descriptorA,target_seconds:descriptorA.target_seconds+1};
  const tampered=await started(optionsFor(dir,'tampered',{descriptorOverride:tamperedDescriptor}));nodes.push(tampered);
  const wrongBinding='f'.repeat(64)===descriptorA.policy_id?'e'.repeat(64):'f'.repeat(64);
  const bindingMismatch=await started(optionsFor(dir,'binding-mismatch',{policy:policyA,bindingOverride:wrongBinding}));nodes.push(bindingMismatch);

  const matched=await a.syncPeer(same.baseUrl());
  assert.equal(matched.adopted,false);assert.equal(matched.reason,'already_current');
  assert.equal(a.status().authenticated_peers,1);
  assert.equal(a.status().secure_channels.contextBinding,descriptorA.policy_id);

  const beforeMismatch=a.status().authenticated_peers;
  await assert.rejects(()=>a.syncPeer(mismatch.baseUrl()),/activation_policy_mismatch/);
  assert.equal(a.status().authenticated_peers,beforeMismatch,'mismatch must fail before peer authentication');

  await assert.rejects(()=>a.syncPeer(legacy.baseUrl()),/activation_policy_descriptor_required/);
  assert.equal(a.status().authenticated_peers,beforeMismatch,'missing policy must fail before peer authentication');

  await assert.rejects(()=>a.syncPeer(tampered.baseUrl()),/activation_policy_descriptor_tampered/);
  assert.equal(a.status().authenticated_peers,beforeMismatch,'tampered policy must fail before peer authentication');

  // Same signed policy in hello is insufficient if the authenticated channel is
  // bound to another digest: the channel handshake must fail before sync.
  await assert.rejects(()=>a.syncPeer(bindingMismatch.baseUrl()),/Secure-channel context binding mismatch/);

  // Mutual fail-closed property: an unbound/default client can see the signed
  // candidate hello, but cannot open a secure session to a policy-bound peer.
  await assert.rejects(()=>legacy.syncPeer(a.baseUrl()),/Secure-channel context binding mismatch/);

  // Default mode remains backward compatible with itself.
  const defaultPair=await legacy.syncPeer(legacy2.baseUrl());
  assert.equal(defaultPair.adopted,false);assert.equal(defaultPair.reason,'already_current');
  assert.equal(legacy.status().secure_channels.contextBinding,null);

  const status=a.status();
  assert.deepEqual(status.peer_hello_extension_keys,['daa_activation_policy']);
  assert.equal(legacy.status().peer_hello_extension_keys.length,0);

  console.log(JSON.stringify({status:'PASS',policy_id:descriptorA.policy_id,matched:true,mismatch_rejected:true,missing_rejected:true,tamper_rejected:true,secure_binding_rejected:true,mutual_fail_closed:true,default_pair_compatible:true,authentication_fail_closed:true}));
}finally{
  await Promise.allSettled(nodes.map(node=>node.close()));
  await rm(dir,{recursive:true,force:true});
}
