import assert from 'node:assert/strict';
import {NETWORK,nextDifficulty,subsidy,validateHeaderSequence} from '../node/authoritative/fae-v4-core.mjs';
import {hashHex,leadingZeroBits} from '../node/authoritative/crypto.mjs';
import {freezeActivationPolicy,validateBranchChain} from '../node/authoritative/activation-reorg-candidate.mjs';
import {activationPolicyDescriptor} from '../node/authoritative/activation-policy-identity-candidate.mjs';
import {mineFullActivationCandidate,appendRehearsedCandidate} from '../node/authoritative/full-activation-rehearsal-candidate.mjs';
import {
  FULL_TARGET_HEADERS_SYNC_STATUS,
  activatedHeaderRecord,
  activatedBlockRecord,
  validateMixedHeaderSequence,
  validateDownloadedBodies,
  rehearseHeadersFirstSync
} from '../node/authoritative/full-target-headers-sync-candidate.mjs';
import {legacyBlocks} from './legacy-testnet-fixture.mjs';

const H=13;
const policy=freezeActivationPolicy({activationHeight:H});
const descriptor=activationPolicyDescriptor(policy);
const miner=legacyBlocks.at(-1).miner_address;

function mineLegacy(chain,{timestampMs}){
  const height=chain.length+1,bits=nextDifficulty(chain);
  const header={
    network:NETWORK,
    height,
    previous_hash:chain.at(-1).hash,
    timestamp_ms:timestampMs,
    difficulty_bits:bits,
    miner_address:miner,
    reward_atoms:subsidy(height).toString(),
    tx_root:hashHex([]),
    tx_count:0
  };
  for(let nonce=0;nonce<10_000_000;nonce++){
    const full={...header,nonce},hash=hashHex(full);
    if(leadingZeroBits(hash)<bits)continue;
    return{height,hash,previous_hash:header.previous_hash,timestamp_ms:timestampMs,difficulty_bits:bits,reward_atoms:header.reward_atoms,header_json:full,txids:[],attempts:nonce+1};
  }
  throw new Error('legacy_nonce_budget_exhausted');
}
function branchRecord(block){
  return{height:Number(block.height),hash:String(block.hash),previous_hash:String(block.previous_hash),timestamp_ms:Number(block.timestamp_ms),difficulty_bits:Number(block.difficulty_bits),reward_atoms:String(block.reward_atoms)};
}

assert.equal(FULL_TARGET_HEADERS_SYNC_STATUS,'candidate-not-active-consensus');
assert.equal(legacyBlocks.length,H-2);

// Begin from the exact historical v4 genesis/checkpoint chain, then mine the one
// post-checkpoint legacy block immediately before activation.
let build=legacyBlocks.map(branchRecord);
const legacy12=mineLegacy(build,{timestampMs:legacyBlocks.at(-1).timestamp_ms+180_000});
build.push(branchRecord(legacy12));
assert.equal(build.at(-1).height,H-1);

// Cross H with a deliberately delayed activation block. This keeps the rehearsal
// cheap while exercising the same branch-derived full-target semantics.
const t13=legacy12.timestamp_ms+48*60*60_000;
const mined13=mineFullActivationCandidate(build,policy,{minerAddress:miner,timestampMs:t13,maxNonce:5_000_000});
build=appendRehearsedCandidate(build,mined13.candidate,policy,{nowMs:t13});
const t14=t13+180_000;
const mined14=mineFullActivationCandidate(build,policy,{minerAddress:miner,timestampMs:t14,maxNonce:5_000_000});
build=appendRehearsedCandidate(build,mined14.candidate,policy,{nowMs:t14});
const t15=t14+180_000;
const mined15=mineFullActivationCandidate(build,policy,{minerAddress:miner,timestampMs:t15,maxNonce:5_000_000});
build=appendRehearsedCandidate(build,mined15.candidate,policy,{nowMs:t15});

const headers=[
  ...legacyBlocks.map(block=>structuredClone(block)),
  structuredClone(legacy12),
  activatedHeaderRecord(mined13.candidate),
  activatedHeaderRecord(mined14.candidate),
  activatedHeaderRecord(mined15.candidate)
];
const blocks=[
  ...legacyBlocks.map(block=>structuredClone(block)),
  structuredClone(legacy12),
  activatedBlockRecord(mined13.candidate),
  activatedBlockRecord(mined14.candidate),
  activatedBlockRecord(mined15.candidate)
];
assert.equal(headers.length,15);assert.equal(blocks.length,15);

// Full replay from genesis: both headers and bodies must reproduce the exact tip
// and cumulative work across historical checkpoints, post-checkpoint legacy, and
// candidate full-target blocks.
const genesisHeaders=validateMixedHeaderSequence([],headers,policy,{remotePolicyDescriptor:descriptor,nowMs:t15});
const genesisBodies=validateDownloadedBodies([],headers,blocks,policy,{remotePolicyDescriptor:descriptor,nowMs:t15});
assert.equal(genesisHeaders.ok,true);assert.equal(genesisBodies.ok,true);
assert.equal(genesisHeaders.chain.at(-1).hash,mined15.candidate.hash);
assert.equal(genesisBodies.chain.at(-1).hash,mined15.candidate.hash);
assert.equal(genesisHeaders.work,genesisBodies.work);
assert.equal(validateBranchChain(genesisBodies.chain,policy,{enforceFutureDrift:false}).work,genesisBodies.work);

// A legacy-only validator must fail closed on H rather than silently interpreting
// a full-target header using old difficulty_bits semantics.
assert.throws(
  ()=>validateHeaderSequence(genesisBodies.chain.slice(0,H-1),[headers[H-1]],{activationHeight:Number.MAX_SAFE_INTEGER,now:t13}),
  /header_bad_difficulty/
);

// Late join: a node already synchronized through H+1 can fetch only H+2 and must
// reproduce the same canonical tip/work as a full replay.
const lateLocal=genesisBodies.chain.slice(0,H+1);
const late=await rehearseHeadersFirstSync({
  localChain:lateLocal,
  commonAncestorHeight:H+1,
  remotePolicyDescriptor:descriptor,
  remoteClaimedTipHash:headers.at(-1).hash,
  policy,
  nowMs:t15,
  fetchHeaders:async()=>[structuredClone(headers.at(-1))],
  fetchBlocks:async()=>[structuredClone(blocks.at(-1))]
});
assert.equal(late.ok,true);assert.equal(late.preferred,true);
assert.equal(late.candidate_chain.at(-1).hash,mined15.candidate.hash);
assert.equal(late.remote_work,genesisBodies.work);

// Stale recovery: a node stuck at the final historical checkpoint (H-2) must
// catch up through legacy H-1 and then cross activation without a special path.
const staleLocal=genesisBodies.chain.slice(0,H-2);
const staleHeaders=headers.slice(H-2);
const staleBlocks=blocks.slice(H-2);
const stale=await rehearseHeadersFirstSync({
  localChain:staleLocal,
  commonAncestorHeight:H-2,
  remotePolicyDescriptor:descriptor,
  remoteClaimedTipHash:headers.at(-1).hash,
  policy,
  nowMs:t15,
  fetchHeaders:async()=>structuredClone(staleHeaders),
  fetchBlocks:async()=>structuredClone(staleBlocks)
});
assert.equal(stale.ok,true);assert.equal(stale.preferred,true);
assert.equal(stale.candidate_chain.at(-1).hash,mined15.candidate.hash);
assert.equal(stale.remote_work,genesisBodies.work);

// Persisted clean-room replay from JSON bytes must remain byte-semantics neutral.
const persistedHeaders=JSON.parse(JSON.stringify(headers));
const persistedBlocks=JSON.parse(JSON.stringify(blocks));
const persisted=validateDownloadedBodies([],persistedHeaders,persistedBlocks,policy,{remotePolicyDescriptor:descriptor,enforceFutureDrift:false});
assert.equal(persisted.chain.at(-1).hash,mined15.candidate.hash);
assert.equal(persisted.work,genesisBodies.work);

// Historical checkpoint encoding is immutable: retroactively adding modern
// tx commitments to a checkpoint block must fail before normalization.
const corruptedHeaders=JSON.parse(JSON.stringify(headers));
const corruptedBlocks=JSON.parse(JSON.stringify(blocks));
corruptedHeaders[0].header_json.tx_root=hashHex([]);corruptedHeaders[0].header_json.tx_count=0;
corruptedBlocks[0].header_json.tx_root=hashHex([]);corruptedBlocks[0].header_json.tx_count=0;
assert.throws(
  ()=>validateDownloadedBodies([],corruptedHeaders,corruptedBlocks,policy,{remotePolicyDescriptor:descriptor,enforceFutureDrift:false}),
  /invalid_historical_legacy_block/
);

console.log(JSON.stringify({
  status:'PASS',
  authority:'candidate-not-active-consensus',
  activation_height:H,
  genesis_to_h_plus_2_replay:true,
  historical_legacy_encoding_preserved:true,
  legacy_only_fails_closed_at_activation:true,
  late_join_from_h_plus_1:true,
  stale_recovery_from_h_minus_2:true,
  persisted_clean_room_replay:true,
  final_tip:mined15.candidate.hash,
  legacy_mining_attempts:legacy12.attempts,
  full_target_attempts:mined13.attempts+mined14.attempts+mined15.attempts
}));
