import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {NETWORK,ZERO_HASH,nextDifficulty,subsidy} from '../node/authoritative/fae-v4-core.mjs';
import {encodeAddress} from '../node/authoritative/address.mjs';
import {hashHex,leadingZeroBits,sha256} from '../node/authoritative/crypto.mjs';
import {freezeActivationPolicy,validateBranchChain} from '../node/authoritative/activation-reorg-candidate.mjs';
import {activationPolicyDescriptor} from '../node/authoritative/activation-policy-identity-candidate.mjs';
import {mineFullActivationCandidate,appendRehearsedCandidate} from '../node/authoritative/full-activation-rehearsal-candidate.mjs';
import {activatedHeaderRecord,activatedBlockRecord,validateMixedHeaderSequence,rehearseHeadersFirstSync} from '../node/authoritative/full-target-headers-sync-candidate.mjs';

function h(label){return createHash('sha256').update(String(label)).digest('hex')}
const minerA=encodeAddress(sha256(Buffer.from('sync-miner-a')).subarray(0,20),'faet');
const minerB=encodeAddress(sha256(Buffer.from('sync-miner-b')).subarray(0,20),'faet');

function trustedPrefix(count,{startMs=Date.now()-count*180_000-60_000}={}){
  const chain=[];
  for(let height=1;height<=count;height++){
    const previous=chain.at(-1),bits=nextDifficulty(chain);
    chain.push({height,hash:h(`trusted-prefix-${height}`),previous_hash:previous?.hash??ZERO_HASH,timestamp_ms:startMs+(height-1)*180_000,difficulty_bits:bits,reward_atoms:'0'});
  }
  return chain;
}
function mineLegacyHeader(prefix,{minerAddress,timestampMs,label}){
  const height=prefix.length+1,bits=nextDifficulty(prefix),base={network:NETWORK,height,previous_hash:prefix.at(-1)?.hash??ZERO_HASH,timestamp_ms:timestampMs,difficulty_bits:bits,miner_address:minerAddress,reward_atoms:subsidy(height).toString(),tx_root:hashHex([]),tx_count:0};
  for(let nonce=0;nonce<5_000_000;nonce++){
    const full={...base,nonce},hash=hashHex(full);if(leadingZeroBits(hash)<bits)continue;
    return{height,hash,previous_hash:base.previous_hash,timestamp_ms:timestampMs,difficulty_bits:bits,reward_atoms:base.reward_atoms,header_json:full,txids:[],attempts:nonce+1,label};
  }
  throw new Error('legacy_nonce_budget_exhausted');
}

const policy=freezeActivationPolicy({activationHeight:14});
const descriptor=activationPolicyDescriptor(policy);
const prefix=trustedPrefix(12);
const h13Time=prefix.at(-1).timestamp_ms+180_000;
const local13=mineLegacyHeader(prefix,{minerAddress:minerA,timestampMs:h13Time,label:'local'});
const remote13=mineLegacyHeader(prefix,{minerAddress:minerB,timestampMs:h13Time+1_000,label:'remote'});

// Local branch intentionally experiences a huge gap and therefore receives an
// easy/clamped post-activation target.
let localChain=[...prefix,local13];
const local14Time=local13.timestamp_ms+48*60*60_000;
const local14=mineFullActivationCandidate(localChain,policy,{minerAddress:minerA,timestampMs:local14Time,maxNonce:5_000_000});
localChain=appendRehearsedCandidate(localChain,local14.candidate,policy,{nowMs:local14Time});
const local15Time=local14Time+180_000;
const local15=mineFullActivationCandidate(localChain,policy,{minerAddress:minerA,timestampMs:local15Time,maxNonce:5_000_000});
localChain=appendRehearsedCandidate(localChain,local15.candidate,policy,{nowMs:local15Time});

// Remote fork starts below activation (H13), then crosses into full target at
// H14 with materially more cumulative work.
let remoteBuild=[...prefix,remote13];
const remote14Time=remote13.timestamp_ms+6*60*60_000+180_000;
const remote14=mineFullActivationCandidate(remoteBuild,policy,{minerAddress:minerB,timestampMs:remote14Time,maxNonce:5_000_000});
remoteBuild=appendRehearsedCandidate(remoteBuild,remote14.candidate,policy,{nowMs:remote14Time});
const remote15Time=remote14Time+180_000;
const remote15=mineFullActivationCandidate(remoteBuild,policy,{minerAddress:minerB,timestampMs:remote15Time,maxNonce:5_000_000});
remoteBuild=appendRehearsedCandidate(remoteBuild,remote15.candidate,policy,{nowMs:remote15Time});

const remoteHeaders=[remote13,activatedHeaderRecord(remote14.candidate),activatedHeaderRecord(remote15.candidate)];
const remoteBlocks=[remote13,activatedBlockRecord(remote14.candidate),activatedBlockRecord(remote15.candidate)];
const plan=validateMixedHeaderSequence(prefix,remoteHeaders,policy,{remotePolicyDescriptor:descriptor,nowMs:remote15Time});

let headerFetches=0,blockFetches=0;
const sync=await rehearseHeadersFirstSync({
  localChain,commonAncestorHeight:12,remotePolicyDescriptor:descriptor,remoteClaimedWork:plan.work,policy,nowMs:remote15Time,
  fetchHeaders:async()=>{headerFetches++;return structuredClone(remoteHeaders)},
  fetchBlocks:async()=>{blockFetches++;return structuredClone(remoteBlocks)}
});
assert.equal(sync.ok,true);assert.equal(sync.preferred,true);assert.equal(sync.fork_winner,'a');
assert.equal(sync.headers_validated,3);assert.equal(sync.blocks_validated,3);assert.equal(headerFetches,1);assert.equal(blockFetches,1);
assert.equal(sync.candidate_chain.at(-1).hash,remote15.candidate.hash);
assert.ok(sync.remote_work>sync.local_work);

// A bad header must abort before any body download.
const badHeaders=structuredClone(remoteHeaders);badHeaders[1].target_hex='f'.repeat(64);badHeaders[1].header_json.target_hex='f'.repeat(64);
let forbiddenBlockFetch=false;
const badHeaderSync=await rehearseHeadersFirstSync({localChain,commonAncestorHeight:12,remotePolicyDescriptor:descriptor,policy,nowMs:remote15Time,fetchHeaders:async()=>badHeaders,fetchBlocks:async()=>{forbiddenBlockFetch=true;throw new Error('blocks_should_not_be_requested')}});
assert.equal(badHeaderSync.ok,false);assert.equal(badHeaderSync.stage,'headers');assert.equal(badHeaderSync.blocks_requested,false);assert.equal(forbiddenBlockFetch,false);

// A body/header mismatch is caught only after the independently valid header pass.
const badBlocks=structuredClone(remoteBlocks);badBlocks[2].header_json={...badBlocks[2].header_json,tx_count:1};
const badBodySync=await rehearseHeadersFirstSync({localChain,commonAncestorHeight:12,remotePolicyDescriptor:descriptor,policy,nowMs:remote15Time,fetchHeaders:async()=>structuredClone(remoteHeaders),fetchBlocks:async()=>badBlocks});
assert.equal(badBodySync.ok,false);assert.equal(badBodySync.stage,'blocks');assert.equal(badBodySync.blocks_requested,true);

// Policy mismatch must stop before either headers or blocks are requested.
const wrongDescriptor=activationPolicyDescriptor(freezeActivationPolicy({activationHeight:15}));let networkTouched=false;
const badPolicy=await rehearseHeadersFirstSync({localChain,commonAncestorHeight:12,remotePolicyDescriptor:wrongDescriptor,policy,fetchHeaders:async()=>{networkTouched=true;return[]},fetchBlocks:async()=>{networkTouched=true;return[]}});
assert.equal(badPolicy.ok,false);assert.equal(badPolicy.stage,'policy');assert.equal(networkTouched,false);

// Restart/replay of the adopted branch must reproduce exactly the same tip/work.
const restarted=validateBranchChain(JSON.parse(JSON.stringify(sync.candidate_chain)),policy,{enforceFutureDrift:false});
assert.equal(restarted.ok,true);assert.equal(restarted.tip.hash,remote15.candidate.hash);assert.equal(restarted.work,sync.remote_work);

console.log(JSON.stringify({status:'PASS',activation_height:14,common_ancestor:12,crosses_activation:true,headers_first:true,blocks_deferred_until_headers_valid:true,remote_preferred:true,restart_replay:true,legacy_attempts:local13.attempts+remote13.attempts,full_target_attempts:local14.attempts+local15.attempts+remote14.attempts+remote15.attempts}));
