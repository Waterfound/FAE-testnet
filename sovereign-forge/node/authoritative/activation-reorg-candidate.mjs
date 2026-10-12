import {nextDifficulty,ZERO_HASH} from './fae-v4-core.mjs';
import {
  asertTargetCandidate,targetFromLeadingZeroBits,targetFromHex,targetHex,medianTimePast,
  POW_LIMIT,TARGET_SECONDS,TESTNET_CANDIDATE_HALF_LIFE_SECONDS,FUTURE_DRIFT_MS
} from './difficulty-timestamp-candidate.mjs';
import {legacyBitsWork,workFromTarget} from './full-target-migration-candidate.mjs';

export const ACTIVATION_REORG_STATUS='candidate-not-active-consensus';
export const ACTIVATION_CONTEXT_MODE='branch-derived-at-height-minus-one';

function int(value,label){const n=Number(value);if(!Number.isSafeInteger(n))throw new Error(`${label}_must_be_safe_integer`);return n}
function positive(value,label){const n=int(value,label);if(n<=0)throw new Error(`${label}_must_be_positive`);return n}
function hash64(value,label){const s=String(value??'').toLowerCase();if(!/^[0-9a-f]{64}$/.test(s))throw new Error(`${label}_invalid`);return s}
function blockHeight(block){return positive(block?.height,'height')}
function timestamp(block){const n=int(block?.timestamp_ms,'timestamp_ms');if(n<0)throw new Error('negative_timestamp');return n}
function cloneJson(value){return JSON.parse(JSON.stringify(value))}

export function freezeActivationPolicy({
  activationHeight,halfLifeSeconds=TESTNET_CANDIDATE_HALF_LIFE_SECONDS,
  targetSeconds=TARGET_SECONDS,powLimit=POW_LIMIT,mtpWindow=11,futureDriftMs=FUTURE_DRIFT_MS
}={}){
  const activation=positive(activationHeight,'activation_height');if(activation<2)throw new Error('activation_height_requires_parent');
  const limit=BigInt(powLimit);if(limit<=0n)throw new Error('invalid_pow_limit');
  return Object.freeze({
    status:ACTIVATION_REORG_STATUS,context_mode:ACTIVATION_CONTEXT_MODE,
    activation_height:activation,half_life_seconds:positive(halfLifeSeconds,'half_life_seconds'),
    target_seconds:positive(targetSeconds,'target_seconds'),pow_limit_hex:targetHex(limit),
    mtp_window:positive(mtpWindow,'mtp_window'),future_drift_ms:int(futureDriftMs,'future_drift_ms')
  });
}

export function validateChainLinkage(chain){
  if(!Array.isArray(chain))throw new Error('chain_required');
  let previous=null;
  for(let i=0;i<chain.length;i++){
    const block=chain[i],height=blockHeight(block);if(height!==i+1)throw new Error('noncontiguous_height');
    const hash=hash64(block.hash,'hash'),previousHash=hash64(block.previous_hash,'previous_hash');
    if(previousHash!==(previous?.hash??ZERO_HASH))throw new Error('previous_hash_mismatch');
    timestamp(block);previous={height,hash};
  }
  return true;
}

export function deriveBranchActivationContext(prefix,policy){
  if(!policy||policy.status!==ACTIVATION_REORG_STATUS)throw new Error('activation_policy_required');
  if(!Array.isArray(prefix))throw new Error('prefix_required');validateChainLinkage(prefix);
  const expectedParentHeight=policy.activation_height-1,tip=prefix.at(-1);
  if(!tip||blockHeight(tip)!==expectedParentHeight||prefix.length!==expectedParentHeight)throw new Error('activation_parent_prefix_required');
  if(tip.target_hex!==undefined&&tip.target_hex!==null)throw new Error('activation_parent_must_be_legacy');
  const bits=nextDifficulty(prefix),target=targetFromLeadingZeroBits(bits);
  return Object.freeze({
    activation_height:policy.activation_height,anchor_height:policy.activation_height,
    anchor_parent_height:expectedParentHeight,anchor_parent_hash:hash64(tip.hash,'anchor_parent_hash'),
    anchor_parent_time_seconds:Math.floor(timestamp(tip)/1000),anchor_difficulty_bits:bits,
    anchor_target_hex:targetHex(target),half_life_seconds:policy.half_life_seconds,
    target_seconds:policy.target_seconds,pow_limit_hex:policy.pow_limit_hex
  });
}

export function expectedBranchTarget({height,timestampMs,context}){
  const h=positive(height,'height');if(!context)throw new Error('activation_context_required');if(h<context.activation_height)throw new Error('target_requested_before_activation');
  return asertTargetCandidate({
    anchorTarget:targetFromHex(context.anchor_target_hex),anchorHeight:context.anchor_height,
    anchorParentTimeSeconds:context.anchor_parent_time_seconds,evaluationHeight:h,
    evaluationTimeSeconds:Math.floor(int(timestampMs,'timestamp_ms')/1000),targetSeconds:context.target_seconds,
    halfLifeSeconds:context.half_life_seconds,powLimit:targetFromHex(context.pow_limit_hex)
  });
}

function legacyIntrinsicVerdict(chain,block){
  const expectedHeight=chain.length+1,height=blockHeight(block);if(height!==expectedHeight)return{ok:false,error:'height_mismatch'};
  const previous=chain.at(-1)||null,previousHash=hash64(block.previous_hash,'previous_hash');if(previousHash!==(previous?.hash??ZERO_HASH))return{ok:false,error:'previous_hash_mismatch'};
  if(block.target_hex!==undefined&&block.target_hex!==null)return{ok:false,error:'pre_activation_target_forbidden'};
  const bits=Number(block.difficulty_bits);if(!Number.isSafeInteger(bits))return{ok:false,error:'legacy_bits_required'};
  const expectedBits=nextDifficulty(chain);if(bits!==expectedBits)return{ok:false,error:'legacy_difficulty_mismatch',expected_difficulty_bits:expectedBits};
  const ts=timestamp(block);if(previous&&ts<timestamp(previous))return{ok:false,error:'timestamp_before_parent'};
  return{ok:true,regime:'legacy',work:legacyBitsWork(bits),difficulty_bits:bits};
}

function activatedIntrinsicVerdict(chain,block,policy,context){
  const expectedHeight=chain.length+1,height=blockHeight(block);if(height!==expectedHeight)return{ok:false,error:'height_mismatch'};
  const previous=chain.at(-1)||null,previousHash=hash64(block.previous_hash,'previous_hash');if(previousHash!==(previous?.hash??ZERO_HASH))return{ok:false,error:'previous_hash_mismatch'};
  if(block.difficulty_bits!==undefined&&block.difficulty_bits!==null)return{ok:false,error:'post_activation_legacy_bits_forbidden'};
  let target;try{target=targetFromHex(String(block.target_hex))}catch{return{ok:false,error:'full_target_required'}}
  const ts=timestamp(block);if(previous&&ts<timestamp(previous))return{ok:false,error:'timestamp_before_parent'};
  const mtp=medianTimePast(chain,{window:policy.mtp_window});if(mtp!==null&&ts<=mtp)return{ok:false,error:'timestamp_not_above_mtp',mtp_ms:mtp};
  const expected=expectedBranchTarget({height,timestampMs:ts,context});if(target!==expected)return{ok:false,error:'unexpected_activation_target',expected_target_hex:targetHex(expected)};
  return{ok:true,regime:'full-target',work:workFromTarget(target),target_hex:targetHex(target),mtp_ms:mtp};
}

export function validateBranchBlock(chain,block,policy,{nowMs=null,enforceFutureDrift=false,context=null}={}){
  if(!Array.isArray(chain))throw new Error('chain_required');if(!policy)throw new Error('activation_policy_required');
  const height=blockHeight(block);let verdict;
  if(height<policy.activation_height)verdict=legacyIntrinsicVerdict(chain,block);
  else{
    const derived=context??deriveBranchActivationContext(chain.slice(0,policy.activation_height-1),policy);
    verdict=activatedIntrinsicVerdict(chain,block,policy,derived);
  }
  if(!verdict.ok)return verdict;
  if(enforceFutureDrift){const now=int(nowMs,'now_ms'),ts=timestamp(block);if(ts>now+policy.future_drift_ms)return{ok:false,error:'timestamp_too_far_future',max_future_ms:now+policy.future_drift_ms};}
  return verdict;
}

export function validateBranchChain(chain,policy,{arrivalNowMs=null,enforceFutureDrift=false}={}){
  if(!Array.isArray(chain))throw new Error('chain_required');let accepted=[],work=0n,context=null;
  for(const raw of chain){const block=cloneJson(raw);const height=blockHeight(block);if(height===policy.activation_height)context=deriveBranchActivationContext(accepted,policy);
    const verdict=validateBranchBlock(accepted,block,policy,{nowMs:arrivalNowMs,enforceFutureDrift,context});if(!verdict.ok)throw Object.assign(new Error(verdict.error),{verdict,height});
    work+=verdict.work;accepted.push(block);
  }
  return{ok:true,work,tip:accepted.at(-1)??null,context,chain:accepted};
}

export function replayBranchState(serializedOrChain,policy){
  const chain=typeof serializedOrChain==='string'?JSON.parse(serializedOrChain):cloneJson(serializedOrChain);
  const replay=validateBranchChain(chain,policy,{enforceFutureDrift:false});
  return{status:ACTIVATION_REORG_STATUS,height:replay.tip?.height??0,tip_hash:replay.tip?.hash??ZERO_HASH,work:replay.work.toString(),context:replay.context};
}

export function compareBranchForks(a,b,policy){
  const ar=validateBranchChain(a,policy),br=validateBranchChain(b,policy);const ah=hash64(ar.tip?.hash??ZERO_HASH,'a_tip_hash'),bh=hash64(br.tip?.hash??ZERO_HASH,'b_tip_hash');
  let winner;if(ar.work!==br.work)winner=ar.work>br.work?'a':'b';else if(a.length!==b.length)winner=a.length>b.length?'a':'b';else winner=ah===bh?'tie':ah<bh?'a':'b';
  return{winner,a_work:ar.work,b_work:br.work,a_tip_hash:ah,b_tip_hash:bh,a_context:ar.context,b_context:br.context};
}

export function rollbackBranch(chain,newTipHeight,policy){
  const h=int(newTipHeight,'new_tip_height');if(h<0||h>=chain.length)throw new Error('rollback_height_out_of_range');
  const rolled=cloneJson(chain.slice(0,h));const replay=validateBranchChain(rolled,policy);return{chain:rolled,state:{height:h,work:replay.work.toString(),regime:h<policy.activation_height?'legacy':'full-target',context:replay.context}};
}
