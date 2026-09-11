import {
  DAA_STATUS,TESTNET_CANDIDATE_HALF_LIFE_SECONDS,POW_LIMIT,candidateNextTarget,targetFromLeadingZeroBits,targetHex,validateCandidateTimestamp
} from './difficulty-timestamp-candidate.mjs';

export const DIFFICULTY_TIMESTAMP_SHADOW_STATUS='observer-only-not-consensus';

function safeInt(value,label){const n=Number(value);if(!Number.isSafeInteger(n))throw new Error(`${label}_must_be_safe_integer`);return n}

export function deriveShadowAnchor(chain,{anchorIndex=1}={}){
  if(!Array.isArray(chain)||chain.length<2)throw new Error('shadow_anchor_requires_two_blocks');
  const index=safeInt(anchorIndex,'anchor_index');if(index<1||index>=chain.length)throw new Error('shadow_anchor_index_out_of_range');
  const block=chain[index],parent=chain[index-1],height=safeInt(block?.height,'anchor_height'),bits=safeInt(block?.difficulty_bits,'anchor_difficulty_bits'),parentMs=safeInt(parent?.timestamp_ms,'anchor_parent_timestamp_ms');
  return{height,parent_time_seconds:Math.floor(parentMs/1000),target:targetFromLeadingZeroBits(bits),source_hash:block?.hash?String(block.hash):null};
}

export function observeDifficultyTimestampShadow(chain,{anchor=null,anchorIndex=1,header=null,nowMs=Date.now(),halfLifeSeconds=TESTNET_CANDIDATE_HALF_LIFE_SECONDS,powLimit=POW_LIMIT}={}){
  if(!Array.isArray(chain)||chain.length<2)throw new Error('shadow_observer_requires_chain');
  const selectedAnchor=anchor||deriveShadowAnchor(chain,{anchorIndex}),tip=chain.at(-1),candidateTarget=candidateNextTarget(chain,{anchor:selectedAnchor,halfLifeSeconds,powLimit});
  const legacyBits=safeInt(tip.difficulty_bits,'tip_difficulty_bits'),legacyTarget=targetFromLeadingZeroBits(legacyBits),deltaPpm=Number(((candidateTarget-legacyTarget)*1_000_000n)/legacyTarget);
  let timestamp=null;if(header)timestamp=validateCandidateTimestamp(chain,safeInt(header.timestamp_ms,'header_timestamp_ms'),{nowMs});
  return{
    status:DIFFICULTY_TIMESTAMP_SHADOW_STATUS,
    candidate_status:DAA_STATUS,
    next_height:safeInt(tip.height,'tip_height')+1,
    half_life_seconds:safeInt(halfLifeSeconds,'half_life_seconds'),
    anchor:{height:selectedAnchor.height,parent_time_seconds:selectedAnchor.parent_time_seconds,target_hex:targetHex(selectedAnchor.target),source_hash:selectedAnchor.source_hash??null},
    current_integer_bits:legacyBits,
    current_integer_target_hex:targetHex(legacyTarget),
    candidate_target_hex:targetHex(candidateTarget),
    candidate_vs_current_target_delta_ppm:deltaPpm,
    timestamp
  };
}
