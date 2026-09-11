import {NETWORK,subsidy} from './fae-v4-core.mjs';
import {isValidAddress} from './address.mjs';
import {hashHex} from './crypto.mjs';
import {stableStringify} from './canonical.mjs';
import {hashMeetsTarget,targetFromHex,targetHex} from './difficulty-timestamp-candidate.mjs';
import {deriveBranchActivationContext,expectedBranchTarget,validateBranchBlock,validateBranchChain,compareBranchForks,ACTIVATION_REORG_STATUS} from './activation-reorg-candidate.mjs';
import {assertActivationPolicyCompatible,activationPolicyDescriptor} from './activation-policy-identity-candidate.mjs';
import {encodeFullTargetBlockCandidate,decodeFullTargetBlockCandidate,workFromTarget} from './full-target-migration-candidate.mjs';

export const FULL_ACTIVATION_REHEARSAL_STATUS='candidate-not-active-consensus';
export const FULL_ACTIVATION_REHEARSAL_MODE='end-to-end-shadow-rehearsal';

function integer(value,label,{min=0}={}){const n=Number(value);if(!Number.isSafeInteger(n)||n<min)throw new Error(`${label}_invalid`);return n}
function hash64(value,label){const s=String(value??'').toLowerCase();if(!/^[0-9a-f]{64}$/.test(s))throw new Error(`${label}_invalid`);return s}
function recordFromCandidate(candidate){const h=candidate?.header;if(!h)throw new Error('candidate_header_required');return{height:Number(h.height),hash:String(candidate.hash),previous_hash:String(h.previous_hash),timestamp_ms:Number(h.timestamp_ms),target_hex:String(h.target_hex),reward_atoms:String(h.reward_atoms)};}
function sameJson(a,b){return stableStringify(a)===stableStringify(b)}

export function validateFullActivationCandidate(chain,candidate,policy,{remotePolicyDescriptor=activationPolicyDescriptor(policy),nowMs=Date.now(),enforceFutureDrift=true}={}){
  if(!Array.isArray(chain))throw new Error('chain_required');if(!policy||policy.status!==ACTIVATION_REORG_STATUS)throw new Error('activation_policy_required');
  const compatibility=assertActivationPolicyCompatible(policy,remotePolicyDescriptor);if(!compatibility.ok)return{ok:false,error:compatibility.error,stage:'policy',...compatibility};
  const h=candidate?.header;if(!h)return{ok:false,error:'candidate_header_required',stage:'envelope'};
  const height=integer(h.height,'height',{min:1}),nonce=integer(candidate.nonce,'nonce');
  if(height<policy.activation_height)return{ok:false,error:'rehearsal_requires_activated_height',stage:'envelope'};
  if(h.network!==NETWORK)return{ok:false,error:'wrong_network',stage:'envelope'};
  if(h.difficulty_bits!==undefined)return{ok:false,error:'legacy_bits_forbidden_after_full_target_activation',stage:'envelope'};
  if(!isValidAddress(String(h.miner_address),'faet'))return{ok:false,error:'invalid_miner_address',stage:'envelope'};
  if(!/^\d+$/.test(String(h.reward_atoms??''))||String(h.reward_atoms)!==subsidy(height).toString())return{ok:false,error:'invalid_scheduled_reward',stage:'envelope'};
  if(!Array.isArray(candidate.txids)||new Set(candidate.txids.map(String)).size!==candidate.txids.length)return{ok:false,error:'invalid_tx_list',stage:'envelope'};
  if(Number(h.tx_count)!==candidate.txids.length||String(h.tx_root)!==hashHex(candidate.txids.map(String)))return{ok:false,error:'tx_commitment_mismatch',stage:'envelope'};
  let hash;try{hash=hash64(candidate.hash,'hash')}catch(error){return{ok:false,error:error.message,stage:'pow'}}
  let target;try{target=targetFromHex(String(h.target_hex))}catch(error){return{ok:false,error:error.message,stage:'target'}}
  const branchVerdict=validateBranchBlock(chain,recordFromCandidate(candidate),policy,{nowMs,enforceFutureDrift});
  if(!branchVerdict.ok)return{ok:false,error:branchVerdict.error,stage:'branch',branch:branchVerdict};
  const computed=hashHex({...h,nonce});if(computed!==hash)return{ok:false,error:'hash_mismatch',stage:'pow',computed_hash:computed};
  if(!hashMeetsTarget(hash,target))return{ok:false,error:'insufficient_proof_of_work',stage:'pow'};
  let decoded;try{decoded=decodeFullTargetBlockCandidate(encodeFullTargetBlockCandidate(candidate))}catch(error){return{ok:false,error:error.message,stage:'codec'}}
  if(!sameJson(decoded,candidate))return{ok:false,error:'full_target_codec_roundtrip_mismatch',stage:'codec'};
  return{ok:true,status:FULL_ACTIVATION_REHEARSAL_STATUS,mode:FULL_ACTIVATION_REHEARSAL_MODE,policy_id:compatibility.policy_id,height,target_hex:targetHex(target),work:workFromTarget(target),hash};
}

export function buildFullActivationTemplate(chain,policy,{minerAddress,timestampMs,txids=[]}={}){
  if(!Array.isArray(chain)||chain.length!==policy.activation_height-1&&chain.length<policy.activation_height)throw new Error('activation_prefix_or_active_chain_required');
  if(!isValidAddress(String(minerAddress),'faet'))throw new Error('invalid_miner_address');
  const previous=chain.at(-1);if(!previous)throw new Error('previous_block_required');const height=Number(previous.height)+1;
  if(height<policy.activation_height)throw new Error('template_before_activation');
  const context=deriveBranchActivationContext(chain.slice(0,policy.activation_height-1),policy);
  const ts=integer(timestampMs,'timestamp_ms');const target=expectedBranchTarget({height,timestampMs:ts,context});
  const normalizedTxids=txids.map(String);if(new Set(normalizedTxids).size!==normalizedTxids.length)throw new Error('duplicate_txid');
  return{header:{network:NETWORK,height,previous_hash:String(previous.hash),timestamp_ms:ts,target_hex:targetHex(target),miner_address:String(minerAddress),reward_atoms:subsidy(height).toString(),tx_root:hashHex(normalizedTxids),tx_count:normalizedTxids.length},txids:normalizedTxids,target};
}

export function mineFullActivationCandidate(chain,policy,{minerAddress,timestampMs,txids=[],startNonce=0,maxNonce=5_000_000,nowMs=timestampMs}={}){
  const template=buildFullActivationTemplate(chain,policy,{minerAddress,timestampMs,txids});const begin=integer(startNonce,'start_nonce'),limit=integer(maxNonce,'max_nonce');
  for(let nonce=begin;nonce<=limit;nonce++){
    const hash=hashHex({...template.header,nonce});if(!hashMeetsTarget(hash,template.target))continue;
    const candidate={header:template.header,nonce,hash,txids:template.txids};
    const verdict=validateFullActivationCandidate(chain,candidate,policy,{nowMs,enforceFutureDrift:true});if(!verdict.ok)throw Object.assign(new Error(verdict.error),{verdict});
    return{candidate,verdict,attempts:nonce-begin+1};
  }
  throw new Error('rehearsal_nonce_budget_exhausted');
}

export function appendRehearsedCandidate(chain,candidate,policy,options={}){
  const verdict=validateFullActivationCandidate(chain,candidate,policy,options);if(!verdict.ok)throw Object.assign(new Error(verdict.error),{verdict});
  return[...chain,recordFromCandidate(candidate)];
}

export function replayFullActivationChain(chain,policy){return validateBranchChain(chain,policy,{enforceFutureDrift:false});}
export function compareRehearsedForks(a,b,policy){return compareBranchForks(a,b,policy);}
