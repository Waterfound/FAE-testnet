import {createHash} from 'node:crypto';
import {emptyState,appendBlockFromFeed,publicBlock,LEGACY_TESTNET_LAST_HEIGHT} from './fae-v4-core.mjs';
import {stableStringify} from './canonical.mjs';
import {activationPolicyDescriptor,assertActivationPolicyCompatible} from './activation-policy-identity-candidate.mjs';
import {validateDownloadedBodies,validateMixedHeaderSequence} from './full-target-headers-sync-candidate.mjs';
import {validateBranchChain} from './activation-reorg-candidate.mjs';

export const COMPATIBILITY_REPLAY_STATUS='candidate-not-active-consensus';
export const COMPATIBILITY_REPLAY_FORMAT='FAE_COMPATIBILITY_REPLAY_V1';

function integer(value,label,{min=0}={}){const n=Number(value);if(!Number.isSafeInteger(n)||n<min)throw new Error(`${label}_invalid`);return n}
function clone(value){return structuredClone(value)}
function digest(value){return createHash('sha256').update(stableStringify(value)).digest('hex')}

export function legacyReplayDigest(state){
  if(!state||!Array.isArray(state.chain))throw new Error('legacy_state_required');
  const utxos=Object.values(state.utxos||{}).sort((a,b)=>String(a.outpoint).localeCompare(String(b.outpoint)));
  return digest({format:COMPATIBILITY_REPLAY_FORMAT,network:state.network,height:state.chain.length,tip_hash:state.chain.at(-1)?.hash??null,issued_atoms:state.chain.reduce((sum,b)=>sum+BigInt(b.reward_atoms),0n).toString(),utxos});
}

export function replayCanonicalLegacySegment(blocks,{initialState=null}={}){
  if(!Array.isArray(blocks))throw new Error('legacy_blocks_required');let state=initialState?clone(initialState):emptyState();const records=new Map();
  for(const raw of blocks){const block=clone(raw),height=integer(block?.height,'legacy_height',{min:1});if(height>LEGACY_TESTNET_LAST_HEIGHT)throw new Error('legacy_checkpoint_range_exceeded');if(height!==state.chain.length+1)throw new Error('legacy_noncontiguous_height');if((block.txids||[]).length!==0)throw new Error('legacy_checkpoint_transactions_forbidden');state=appendBlockFromFeed(state,block,records,{activationHeight:Number.MAX_SAFE_INTEGER});}
  return state;
}

export function assertGenesisActivationBoundary(legacyState,policy){
  if(!policy)throw new Error('activation_policy_required');const expected=Number(policy.activation_height)-1;
  if(legacyState.chain.length!==expected)throw new Error('legacy_prefix_does_not_reach_activation_parent');
  if(expected!==LEGACY_TESTNET_LAST_HEIGHT)throw new Error('genesis_replay_requires_canonical_legacy_boundary');
  return true;
}

export function validateActivatedSuffixFromLegacy({legacyState,activatedHeaders,activatedBlocks,policy,remotePolicyDescriptor=activationPolicyDescriptor(policy),nowMs=Date.now()}={}){
  if(!legacyState||!Array.isArray(activatedHeaders)||!Array.isArray(activatedBlocks)||!policy)throw new Error('activated_suffix_inputs_required');assertGenesisActivationBoundary(legacyState,policy);
  const compatibility=assertActivationPolicyCompatible(policy,remotePolicyDescriptor);if(!compatibility.ok)throw Object.assign(new Error(compatibility.error),{compatibility});
  const prefix=legacyState.chain.map(publicBlock);
  const headers=validateMixedHeaderSequence(prefix,activatedHeaders,policy,{remotePolicyDescriptor,nowMs,enforceFutureDrift:true});
  const bodies=validateDownloadedBodies(prefix,activatedHeaders,activatedBlocks,policy,{remotePolicyDescriptor,nowMs,enforceFutureDrift:true});
  if(headers.work!==bodies.work)throw new Error('activated_header_body_work_mismatch');
  const replay=validateBranchChain(bodies.chain,policy,{enforceFutureDrift:false});
  return{ok:true,status:COMPATIBILITY_REPLAY_STATUS,policy_id:compatibility.policy_id,legacy_height:legacyState.chain.length,activated_headers:activatedHeaders.length,activated_blocks:activatedBlocks.length,work:replay.work,tip:clone(replay.tip),chain:clone(bodies.chain),storage_chain:clone(bodies.storage_chain)};
}

export function replayGenesisThroughActivation({legacyBlocks,activatedHeaders,activatedBlocks,policy,remotePolicyDescriptor=activationPolicyDescriptor(policy),nowMs=Date.now()}={}){
  const legacyState=replayCanonicalLegacySegment(legacyBlocks);assertGenesisActivationBoundary(legacyState,policy);
  const activated=validateActivatedSuffixFromLegacy({legacyState,activatedHeaders,activatedBlocks,policy,remotePolicyDescriptor,nowMs});
  return{...activated,genesis_replayed:true,legacy_digest:legacyReplayDigest(legacyState),legacy_state:legacyState};
}

export function recoverStaleLegacyNode({staleBlocks,catchupBlocks,activatedHeaders,activatedBlocks,policy,remotePolicyDescriptor=activationPolicyDescriptor(policy),nowMs=Date.now()}={}){
  const staleState=replayCanonicalLegacySegment(staleBlocks);const staleHeight=staleState.chain.length;
  const caughtUp=replayCanonicalLegacySegment(catchupBlocks,{initialState:staleState});assertGenesisActivationBoundary(caughtUp,policy);
  const activated=validateActivatedSuffixFromLegacy({legacyState:caughtUp,activatedHeaders,activatedBlocks,policy,remotePolicyDescriptor,nowMs});
  return{...activated,stale_height:staleHeight,caught_up_legacy_height:caughtUp.chain.length,legacy_digest:legacyReplayDigest(caughtUp),stale_recovered:true};
}
