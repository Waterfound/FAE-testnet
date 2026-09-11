import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {NETWORK,ZERO_HASH,nextDifficulty,subsidy} from '../node/authoritative/fae-v4-core.mjs';
import {encodeAddress} from '../node/authoritative/address.mjs';
import {hashHex,leadingZeroBits,sha256} from '../node/authoritative/crypto.mjs';
import {freezeActivationPolicy} from '../node/authoritative/activation-reorg-candidate.mjs';
import {mineFullActivationCandidate} from '../node/authoritative/full-activation-rehearsal-candidate.mjs';
import {activatedBlockRecord} from '../node/authoritative/full-target-headers-sync-candidate.mjs';
import {createFullTargetShadowPeerNode,FULL_TARGET_SHADOW_NODE_STATUS} from '../node/lab/full-target-shadow-peer-node.mjs';

function h(label){return createHash('sha256').update(String(label)).digest('hex')}
function trustedPrefix(count,{startMs=Date.now()-count*180_000-60_000}={}){const chain=[];for(let height=1;height<=count;height++){const previous=chain.at(-1),bits=nextDifficulty(chain);chain.push({height,hash:h(`shadow-trusted-${height}`),previous_hash:previous?.hash??ZERO_HASH,timestamp_ms:startMs+(height-1)*180_000,difficulty_bits:bits,reward_atoms:'1000000000',header_json:{trusted:true,height},txids:[]})}return chain}
function mineLegacy(prefix,{minerAddress,timestampMs,label}){const height=prefix.length+1,bits=nextDifficulty(prefix),base={network:NETWORK,height,previous_hash:prefix.at(-1).hash,timestamp_ms:timestampMs,difficulty_bits:bits,miner_address:minerAddress,reward_atoms:subsidy(height).toString(),tx_root:hashHex([]),tx_count:0};for(let nonce=0;nonce<5_000_000;nonce++){const full={...base,nonce},hash=hashHex(full);if(leadingZeroBits(hash)<bits)continue;return{height,hash,previous_hash:base.previous_hash,timestamp_ms:timestampMs,difficulty_bits:bits,reward_atoms:base.reward_atoms,header_json:full,txids:[],label,attempts:nonce+1}}throw new Error('legacy_nonce_budget_exhausted')}
async function extend(node,{minerAddress,legacyTimestamp,activationDelayMs,label}){let chain=node.getChain();const legacy=mineLegacy(chain,{minerAddress,timestampMs:legacyTimestamp,label});await node.appendBlock(legacy);chain=node.getChain();const t14=legacy.timestamp_ms+activationDelayMs+180_000,m14=mineFullActivationCandidate(chain,node.policy,{minerAddress,timestampMs:t14,maxNonce:5_000_000});await node.appendBlock(activatedBlockRecord(m14.candidate));chain=node.getChain();const t15=t14+180_000,m15=mineFullActivationCandidate(chain,node.policy,{minerAddress,timestampMs:t15,maxNonce:5_000_000});await node.appendBlock(activatedBlockRecord(m15.candidate));return{legacy,m14,m15}}

const dir=await mkdtemp(join(tmpdir(),'fae-full-target-shadow-node-')),nodes=[];
try{
  const policy=freezeActivationPolicy({activationHeight:14}),wrongPolicy=freezeActivationPolicy({activationHeight:15}),trusted=trustedPrefix(12);
  const minerA=encodeAddress(sha256(Buffer.from('shadow-a')).subarray(0,20),'faet'),minerB=encodeAddress(sha256(Buffer.from('shadow-b')).subarray(0,20),'faet');
  const options=(name,nodePolicy=policy)=>({host:'127.0.0.1',port:0,dataFile:join(dir,`${name}.json`),identityFile:join(dir,`${name}-identity.json`),policy:nodePolicy,trustedPrefix:trusted});
  const a=createFullTargetShadowPeerNode(options('a')),b=createFullTargetShadowPeerNode(options('b')),c=createFullTargetShadowPeerNode(options('c')),wrong=createFullTargetShadowPeerNode(options('wrong',wrongPolicy));nodes.push(a,b,c,wrong);for(const node of nodes)await node.start();
  assert.equal(a.status().status,FULL_TARGET_SHADOW_NODE_STATUS);assert.equal(a.status().height,12);assert.equal(a.status().policy_id,b.status().policy_id);

  // Partition phase: A and B evolve independently from the same H12 checkpoint.
  const h13Time=trusted.at(-1).timestamp_ms+180_000;
  const branchA=await extend(a,{minerAddress:minerA,legacyTimestamp:h13Time,activationDelayMs:48*60*60_000,label:'a'});
  const branchB=await extend(b,{minerAddress:minerB,legacyTimestamp:h13Time+1_000,activationDelayMs:6*60*60_000,label:'b'});
  assert.equal(a.status().height,15);assert.equal(b.status().height,15);assert.notEqual(a.status().tip_hash,b.status().tip_hash);assert.ok(BigInt(b.status().chain_work)>BigInt(a.status().chain_work),'B should carry more cumulative work');

  // Reconnect C first to weaker A, then to stronger B. The second sync must
  // discover H12 below activation and reorg through H13 -> H14 activation.
  const first=await c.syncPeer(a.baseUrl());assert.equal(first.adopted,true);assert.equal(c.status().tip_hash,a.status().tip_hash);
  const second=await c.syncPeer(b.baseUrl());assert.equal(second.adopted,true);assert.equal(c.status().tip_hash,b.status().tip_hash);assert.equal(second.headers_validated,3);assert.equal(second.blocks_validated,3);

  // Same-height lower-work branch is validated but not adopted after convergence.
  const back=await c.syncPeer(a.baseUrl());assert.equal(back.adopted,false);assert.equal(back.reason,'validated_but_not_preferred');

  // Mismatched activation policy fails during signed hello, before secure sync.
  await assert.rejects(()=>c.syncPeer(wrong.baseUrl()),/activation_policy_mismatch/);

  // Restart from atomically persisted state and re-validate the whole suffix.
  await c.close();nodes.splice(nodes.indexOf(c),1);
  const restarted=createFullTargetShadowPeerNode(options('c'));nodes.push(restarted);await restarted.start();
  assert.equal(restarted.status().height,15);assert.equal(restarted.status().tip_hash,b.status().tip_hash);assert.equal(restarted.status().chain_work,b.status().chain_work);assert.equal(restarted.status().secure_context_binding,restarted.status().policy_id);
  const current=await restarted.syncPeer(b.baseUrl());assert.equal(current.adopted,false);assert.equal(current.reason,'already_current');

  console.log(JSON.stringify({status:'PASS',shadow_only:true,activation_height:14,partitioned_branches:true,reconnect_a_then_b:true,reorg_common_ancestor:12,crosses_activation:true,cumulative_work_selected:true,policy_mismatch_rejected:true,persistence_restart:true,legacy_attempts:branchA.legacy.attempts+branchB.legacy.attempts,full_target_attempts:branchA.m14.attempts+branchA.m15.attempts+branchB.m14.attempts+branchB.m15.attempts}));
}finally{await Promise.allSettled(nodes.map(node=>node.close()));await rm(dir,{recursive:true,force:true})}
