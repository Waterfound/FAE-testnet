import {NETWORK,MAX_TXS_PER_BLOCK,LEGACY_TESTNET_LAST_HEIGHT,validateHeaderSequence} from './fae-v4-core.mjs';
import {isValidAddress} from './address.mjs';
import {hashHex} from './crypto.mjs';
import {stableStringify} from './canonical.mjs';
import {hashMeetsTarget,targetFromHex} from './difficulty-timestamp-candidate.mjs';
import {validateBranchBlock,validateBranchChain,compareBranchForks} from './activation-reorg-candidate.mjs';
import {activationPolicyDescriptor,assertActivationPolicyCompatible} from './activation-policy-identity-candidate.mjs';
import {validateFullActivationCandidate} from './full-activation-rehearsal-candidate.mjs';

export const FULL_TARGET_HEADERS_SYNC_STATUS='candidate-not-active-consensus';

function int(value,label,{min=0}={}){const n=Number(value);if(!Number.isSafeInteger(n)||n<min)throw new Error(`${label}_invalid`);return n}
function hex64(value,label){const s=String(value??'').toLowerCase();if(!/^[0-9a-f]{64}$/.test(s))throw new Error(`${label}_invalid`);return s}
function activatedRecord(record){return{height:Number(record.height),hash:String(record.hash),previous_hash:String(record.previous_hash),timestamp_ms:Number(record.timestamp_ms),target_hex:String(record.target_hex),reward_atoms:String(record.reward_atoms)};}
function same(a,b){return stableStringify(a)===stableStringify(b)}

function arrivalTime(value){if(!Number.isSafeInteger(value)||value<0)throw new Error('arrival_clock_invalid');return value}
function validateLegacyHeader(chain,record,{nowMs,enforceFutureDrift}){
  // The legacy validator has no intrinsic-replay switch. Using the stored
  // header's own time only for explicit replay removes the arrival-time test
  // while preserving linkage, parent ordering, difficulty, commitments and PoW.
  const now=enforceFutureDrift?arrivalTime(nowMs):int(record?.header_json?.timestamp_ms,'timestamp_ms');
  return validateHeaderSequence(chain,[record],{activationHeight:Number.MAX_SAFE_INTEGER,now});
}

export function activatedHeaderRecord(candidate){
  const header=candidate?.header;if(!header)throw new Error('candidate_header_required');
  return{height:Number(header.height),hash:String(candidate.hash),previous_hash:String(header.previous_hash),timestamp_ms:Number(header.timestamp_ms),target_hex:String(header.target_hex),reward_atoms:String(header.reward_atoms),header_json:{...header,nonce:Number(candidate.nonce)}};
}
export function activatedBlockRecord(candidate){return{...activatedHeaderRecord(candidate),txids:[...(candidate.txids||[])]};}

export function validateActivatedHeader(chain,record,policy,{nowMs=Date.now(),enforceFutureDrift=true}={}){
  if(enforceFutureDrift)arrivalTime(nowMs);
  const full=record?.header_json;if(!full)return{ok:false,error:'header_missing_full_header'};
  const nonce=Number(full.nonce);if(!Number.isSafeInteger(nonce)||nonce<0)return{ok:false,error:'header_bad_nonce'};
  const height=int(record.height,'height',{min:1});if(height<policy.activation_height)return{ok:false,error:'header_not_activated'};
  if(Number(full.height)!==height||String(full.previous_hash)!==String(record.previous_hash)||Number(full.timestamp_ms)!==Number(record.timestamp_ms)||String(full.target_hex)!==String(record.target_hex)||String(full.reward_atoms)!==String(record.reward_atoms))return{ok:false,error:'header_record_mismatch'};
  if(full.network!==NETWORK)return{ok:false,error:'header_wrong_network'};
  if(full.difficulty_bits!==undefined)return{ok:false,error:'header_legacy_bits_after_activation'};
  if(!isValidAddress(String(full.miner_address),'faet'))return{ok:false,error:'header_bad_miner'};
  if(!/^[0-9a-f]{64}$/.test(String(full.tx_root??''))||!Number.isSafeInteger(Number(full.tx_count))||Number(full.tx_count)<0||Number(full.tx_count)>MAX_TXS_PER_BLOCK)return{ok:false,error:'header_bad_tx_commitment'};
  let target;try{target=targetFromHex(String(full.target_hex))}catch(error){return{ok:false,error:error.message}}
  const branch=validateBranchBlock(chain,activatedRecord(record),policy,{nowMs,enforceFutureDrift});if(!branch.ok)return{ok:false,error:branch.error,branch};
  let hash;try{hash=hex64(record.hash,'hash')}catch(error){return{ok:false,error:error.message}}
  if(hashHex(full)!==hash)return{ok:false,error:'header_hash_mismatch'};
  if(!hashMeetsTarget(hash,target))return{ok:false,error:'header_insufficient_pow'};
  return{ok:true,work:branch.work,target,record:activatedRecord(record)};
}

export function validateMixedHeaderSequence(prefix,headers,policy,{remotePolicyDescriptor=activationPolicyDescriptor(policy),nowMs=Date.now(),enforceFutureDrift=true}={}){
  if(!Array.isArray(prefix)||!Array.isArray(headers))throw new Error('header_sequence_arrays_required');
  const compatibility=assertActivationPolicyCompatible(policy,remotePolicyDescriptor);if(!compatibility.ok)throw Object.assign(new Error(compatibility.error),{compatibility});
  let chain=structuredClone(prefix);const accepted=[];
  for(const record of headers){
    const height=int(record?.height,'height',{min:1});if(height!==chain.length+1)throw new Error('header_noncontiguous_height');
    if(height<policy.activation_height){
      chain=validateLegacyHeader(chain,record,{nowMs,enforceFutureDrift});accepted.push(structuredClone(chain.at(-1)));continue;
    }
    const verdict=validateActivatedHeader(chain,record,policy,{nowMs,enforceFutureDrift});if(!verdict.ok)throw Object.assign(new Error(verdict.error),{verdict});
    chain.push(verdict.record);accepted.push(structuredClone(record));
  }
  const replay=validateBranchChain(chain,policy,{enforceFutureDrift:false});
  return{ok:true,policy_id:compatibility.policy_id,chain,accepted,work:replay.work};
}

function candidateFromActivatedBlock(block){
  const full={...(block?.header_json||{})},nonce=Number(full.nonce);delete full.nonce;
  return{header:full,nonce,hash:String(block.hash),txids:[...(block.txids||[])]};
}

function validateLegacyBodyCommitment(height,header,block){
  if(!Array.isArray(block.txids)||new Set(block.txids.map(String)).size!==block.txids.length)throw new Error('legacy_block_bad_txids');
  const full=header.header_json;
  if(height<=LEGACY_TESTNET_LAST_HEIGHT){
    // Historical v4 checkpoints predate tx_root/tx_count. Full replay must
    // preserve their exact encoding rather than retroactively normalizing them.
    if(block.txids.length!==0||full.tx_root!==undefined||full.tx_count!==undefined)throw new Error('invalid_historical_legacy_block');
    return;
  }
  if(Number(full.tx_count)!==block.txids.length||String(full.tx_root)!==hashHex(block.txids.map(String)))throw new Error('legacy_block_tx_commitment_mismatch');
}

export function validateDownloadedBodies(prefix,headers,blocks,policy,{remotePolicyDescriptor=activationPolicyDescriptor(policy),nowMs=Date.now(),enforceFutureDrift=true}={}){
  if(enforceFutureDrift)arrivalTime(nowMs);
  if(!Array.isArray(headers)||!Array.isArray(blocks)||headers.length!==blocks.length)throw new Error('header_block_length_mismatch');
  let chain=structuredClone(prefix),storageChain=structuredClone(prefix);
  for(let i=0;i<headers.length;i++){
    const header=headers[i],block=blocks[i];if(String(block?.hash)!==String(header?.hash)||!same(block?.header_json,header?.header_json))throw new Error('downloaded_block_header_mismatch');
    const height=int(header.height,'height',{min:1});
    if(height<policy.activation_height){
      validateLegacyBodyCommitment(height,header,block);
      chain=validateLegacyHeader(chain,header,{nowMs,enforceFutureDrift});storageChain.push(structuredClone(block));continue;
    }
    const candidate=candidateFromActivatedBlock(block),verdict=validateFullActivationCandidate(chain,candidate,policy,{remotePolicyDescriptor,nowMs,enforceFutureDrift});
    if(!verdict.ok)throw Object.assign(new Error(verdict.error),{verdict});
    chain.push(activatedRecord(header));storageChain.push(structuredClone(block));
  }
  return{ok:true,chain,storage_chain:storageChain,work:validateBranchChain(chain,policy,{enforceFutureDrift:false}).work};
}

export async function rehearseHeadersFirstSync({localChain,commonAncestorHeight,remotePolicyDescriptor,remoteClaimedWork=null,remoteClaimedTipHash=null,fetchHeaders,fetchBlocks,policy,nowMs,clock=null}={}){
  if(!Array.isArray(localChain)||typeof fetchHeaders!=='function'||typeof fetchBlocks!=='function')throw new Error('sync_inputs_required');
  if(clock!==null&&typeof clock!=='function')throw new Error('arrival_clock_required');
  const readClock=()=>arrivalTime(clock!==null?clock():nowMs===undefined?Date.now():nowMs);
  const compatibility=assertActivationPolicyCompatible(policy,remotePolicyDescriptor);if(!compatibility.ok)return{ok:false,stage:'policy',error:compatibility.error};
  const ancestor=int(commonAncestorHeight,'common_ancestor_height');if(ancestor<0||ancestor>localChain.length)throw new Error('common_ancestor_out_of_range');
  const prefix=structuredClone(localChain.slice(0,ancestor));
  const headers=await fetchHeaders();
  if(remoteClaimedTipHash!==null){
    let claimed;try{claimed=hex64(remoteClaimedTipHash,'remote_claimed_tip_hash')}catch(error){return{ok:false,stage:'headers',error:error.message,blocks_requested:false};}
    const downloadedTip=headers.at(-1);if(!downloadedTip||String(downloadedTip.hash).toLowerCase()!==claimed)return{ok:false,stage:'headers',error:'remote_tip_changed_during_headers',blocks_requested:false};
  }
  let headerPlan;try{headerPlan=validateMixedHeaderSequence(prefix,headers,policy,{remotePolicyDescriptor,nowMs:readClock(),enforceFutureDrift:true});}catch(error){return{ok:false,stage:'headers',error:error.message,blocks_requested:false};}
  if(remoteClaimedWork!==null&&BigInt(remoteClaimedWork)!==headerPlan.work)return{ok:false,stage:'headers',error:'remote_chain_work_mismatch',blocks_requested:false};
  const blocks=await fetchBlocks();
  let bodies;try{bodies=validateDownloadedBodies(prefix,headers,blocks,policy,{remotePolicyDescriptor,nowMs:readClock(),enforceFutureDrift:true});}catch(error){return{ok:false,stage:'blocks',error:error.message,blocks_requested:true};}
  if(bodies.work!==headerPlan.work)return{ok:false,stage:'blocks',error:'header_body_work_mismatch',blocks_requested:true};
  const fork=compareBranchForks(bodies.chain,localChain,policy);
  return{ok:true,status:FULL_TARGET_HEADERS_SYNC_STATUS,policy_id:compatibility.policy_id,blocks_requested:true,headers_validated:headers.length,blocks_validated:blocks.length,remote_work:bodies.work,local_work:validateBranchChain(localChain,policy,{enforceFutureDrift:false}).work,preferred:fork.winner==='a',fork_winner:fork.winner,candidate_chain:bodies.chain,storage_chain:bodies.storage_chain};
}
