import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {NETWORK,ZERO_HASH,nextDifficulty,subsidy} from '../node/authoritative/fae-v4-core.mjs';
import {encodeAddress} from '../node/authoritative/address.mjs';
import {hashHex,leadingZeroBits,sha256} from '../node/authoritative/crypto.mjs';
import {freezeActivationPolicy} from '../node/authoritative/activation-reorg-candidate.mjs';
import {mineFullActivationCandidate} from '../node/authoritative/full-activation-rehearsal-candidate.mjs';
import {activatedBlockRecord} from '../node/authoritative/full-target-headers-sync-candidate.mjs';
import {createFullTargetShadowPeerNode} from '../node/lab/full-target-shadow-peer-node.mjs';

function h(label){return createHash('sha256').update(String(label)).digest('hex')}
function trustedPrefix(count,{startMs=Date.now()-count*180_000-60_000}={}){
  const chain=[];
  for(let height=1;height<=count;height++){
    const previous=chain.at(-1),bits=nextDifficulty(chain);
    chain.push({height,hash:h(`ceiling-trusted-${height}`),previous_hash:previous?.hash??ZERO_HASH,timestamp_ms:startMs+(height-1)*180_000,difficulty_bits:bits,reward_atoms:'1000000000',header_json:{trusted:true,height},txids:[]});
  }
  return chain;
}
function mineLegacy(prefix,{minerAddress,timestampMs,label}){
  const height=prefix.length+1,bits=nextDifficulty(prefix),base={network:NETWORK,height,previous_hash:prefix.at(-1).hash,timestamp_ms:timestampMs,difficulty_bits:bits,miner_address:minerAddress,reward_atoms:subsidy(height).toString(),tx_root:hashHex([]),tx_count:0};
  for(let nonce=0;nonce<5_000_000;nonce++){
    const full={...base,nonce},hash=hashHex(full);if(leadingZeroBits(hash)<bits)continue;
    return{height,hash,previous_hash:base.previous_hash,timestamp_ms:timestampMs,difficulty_bits:bits,reward_atoms:base.reward_atoms,header_json:full,txids:[],label,attempts:nonce+1};
  }
  throw new Error('legacy_nonce_budget_exhausted');
}
async function extend(node,{minerAddress,legacyTimestamp,activationDelayMs,label}){
  let chain=node.getChain();const legacy=mineLegacy(chain,{minerAddress,timestampMs:legacyTimestamp,label});await node.appendBlock(legacy);chain=node.getChain();
  const t14=legacy.timestamp_ms+activationDelayMs+180_000,m14=mineFullActivationCandidate(chain,node.policy,{minerAddress,timestampMs:t14,maxNonce:5_000_000});await node.appendBlock(activatedBlockRecord(m14.candidate));chain=node.getChain();
  const t15=t14+180_000,m15=mineFullActivationCandidate(chain,node.policy,{minerAddress,timestampMs:t15,maxNonce:5_000_000});await node.appendBlock(activatedBlockRecord(m15.candidate));
  return{legacy,m14,m15};
}
async function expectStartFailure(factory,pattern){
  const node=factory();
  try{await assert.rejects(()=>node.start(),pattern)}finally{await node.close().catch(()=>{})}
}

const dir=await mkdtemp(join(tmpdir(),'fae-shadow-local-ceiling-')),nodes=[];
try{
  const policy=freezeActivationPolicy({activationHeight:14}),trusted=trustedPrefix(12);
  const minerA=encodeAddress(sha256(Buffer.from('ceiling-a')).subarray(0,20),'faet'),minerB=encodeAddress(sha256(Buffer.from('ceiling-b')).subarray(0,20),'faet');
  const options=name=>({host:'127.0.0.1',port:0,dataFile:join(dir,`${name}.json`),identityFile:join(dir,`${name}-identity.json`),policy,trustedPrefix:trusted});
  const a=createFullTargetShadowPeerNode(options('a')),b=createFullTargetShadowPeerNode(options('b'));nodes.push(a,b);await a.start();await b.start();
  const h13Time=trusted.at(-1).timestamp_ms+180_000;
  const branchA=await extend(a,{minerAddress:minerA,legacyTimestamp:h13Time,activationDelayMs:6*60*60_000,label:'a'});
  const branchB=await extend(b,{minerAddress:minerB,legacyTimestamp:h13Time,activationDelayMs:6*60*60_000,label:'b'});
  assert.equal(a.status().height,15);assert.equal(b.status().height,15);assert.equal(a.status().chain_work,b.status().chain_work);assert.notEqual(a.status().tip_hash,b.status().tip_hash);
  const preferred=a.status().tip_hash<b.status().tip_hash?a:b;

  // Two equal-work syncs begin together from the same local prefix. Whichever
  // finishes last may not overwrite the deterministic lower-hash winner.
  const c=createFullTargetShadowPeerNode(options('c'));nodes.push(c);await c.start();
  const firstRace=await Promise.allSettled([c.syncPeer(a.baseUrl()),c.syncPeer(b.baseUrl())]);
  assert.equal(firstRace.every(result=>result.status==='fulfilled'),true,`concurrent sync rejected: ${firstRace.map(r=>r.status==='rejected'?r.reason?.message:r.value?.reason).join(',')}`);
  assert.equal(c.status().tip_hash,preferred.status().tip_hash,'equal-work concurrent sync must converge to deterministic preferred tip');

  // Reverse invocation order on an independent client to prove the outcome is
  // not an artifact of Promise construction order.
  const d=createFullTargetShadowPeerNode(options('d'));nodes.push(d);await d.start();
  const secondRace=await Promise.allSettled([d.syncPeer(b.baseUrl()),d.syncPeer(a.baseUrl())]);
  assert.equal(secondRace.every(result=>result.status==='fulfilled'),true);
  assert.equal(d.status().tip_hash,preferred.status().tip_hash,'reversed concurrent sync must converge to the same preferred tip');

  // Close C with a valid atomically persisted state. An orphan .tmp from a
  // hypothetical crash must never replace the last successfully renamed file.
  const cPath=join(dir,'c.json'),cTmp=`${cPath}.tmp`;
  await c.close();nodes.splice(nodes.indexOf(c),1);
  const validStateText=await readFile(cPath,'utf8');
  await writeFile(cTmp,'{"partial":');
  const tmpRecovery=createFullTargetShadowPeerNode(options('c'));nodes.push(tmpRecovery);await tmpRecovery.start();
  assert.equal(tmpRecovery.status().tip_hash,preferred.status().tip_hash);assert.equal(tmpRecovery.status().height,15);
  await tmpRecovery.close();nodes.splice(nodes.indexOf(tmpRecovery),1);
  assert.equal(await readFile(cTmp,'utf8'),'{"partial":','startup must ignore orphan temporary state');

  // A truncated canonical state is not silently reset to trusted prefix.
  await writeFile(cPath,validStateText.slice(0,Math.max(1,Math.floor(validStateText.length/3))));
  await expectStartFailure(()=>createFullTargetShadowPeerNode(options('c')),/JSON|Unexpected|end of JSON|position/i);

  // Syntactically valid but semantically incomplete storage must also fail
  // closed. In particular, full blocks cannot lose header_json on disk.
  await writeFile(cPath,validStateText);
  const missingHeader=JSON.parse(validStateText);delete missingHeader.chain.at(-1).header_json;await writeFile(cPath,JSON.stringify(missingHeader));
  await expectStartFailure(()=>createFullTargetShadowPeerNode(options('c')),/shadow_block_header_json_required/);

  // Corrupting an activated target must be caught by consensus replay, not
  // accepted merely because the JSON and outer storage format are valid.
  const badTarget=JSON.parse(validStateText);badTarget.chain.at(-1).target_hex='f'.repeat(64);badTarget.chain.at(-1).header_json.target_hex='f'.repeat(64);await writeFile(cPath,JSON.stringify(badTarget));
  await expectStartFailure(()=>createFullTargetShadowPeerNode(options('c')),/unexpected_activation_target|header_/);

  // Restore pristine durable state and prove restart remains exact after all
  // adversarial mutations above.
  await writeFile(cPath,validStateText);
  const finalRestart=createFullTargetShadowPeerNode(options('c'));nodes.push(finalRestart);await finalRestart.start();
  assert.equal(finalRestart.status().tip_hash,preferred.status().tip_hash);assert.equal(finalRestart.status().chain_work,preferred.status().chain_work);

  console.log(JSON.stringify({status:'PASS',shadow_only:true,concurrent_equal_work_sync:true,deterministic_tip:true,reverse_order_same_result:true,orphan_tmp_ignored:true,truncated_state_fail_closed:true,missing_header_fail_closed:true,corrupt_target_fail_closed:true,pristine_restart_exact:true,legacy_attempts:branchA.legacy.attempts+branchB.legacy.attempts,full_target_attempts:branchA.m14.attempts+branchA.m15.attempts+branchB.m14.attempts+branchB.m15.attempts}));
}finally{await Promise.allSettled(nodes.map(node=>node.close()));await rm(dir,{recursive:true,force:true})}
