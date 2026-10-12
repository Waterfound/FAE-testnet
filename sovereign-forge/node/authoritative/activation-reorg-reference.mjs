import {nextDifficulty,ZERO_HASH} from './fae-v4-core.mjs';
import {asertTargetCandidate,targetFromLeadingZeroBits,targetFromHex,targetHex,medianTimePast} from './difficulty-timestamp-candidate.mjs';
import {legacyBitsWork,workFromTarget} from './full-target-migration-candidate.mjs';

// Intentionally separate implementation for differential testing. Do not import activation-reorg-candidate.mjs.
function n(v){const x=Number(v);if(!Number.isSafeInteger(x))throw new Error('unsafe_integer');return x}
function hx(v){const s=String(v??'').toLowerCase();if(!/^[0-9a-f]{64}$/.test(s))throw new Error('bad_hash');return s}
function targetFor(block,ctx){return asertTargetCandidate({anchorTarget:targetFromHex(ctx.anchor_target_hex),anchorHeight:ctx.anchor_height,anchorParentTimeSeconds:ctx.anchor_parent_time_seconds,evaluationHeight:n(block.height),evaluationTimeSeconds:Math.floor(n(block.timestamp_ms)/1000),targetSeconds:ctx.target_seconds,halfLifeSeconds:ctx.half_life_seconds,powLimit:targetFromHex(ctx.pow_limit_hex)});}

export function referenceEvaluate(chain,policy){
  if(!Array.isArray(chain))throw new Error('chain_required');let work=0n,ctx=null,previous=null;
  for(let i=0;i<chain.length;i++){
    const b=chain[i],height=n(b.height);if(height!==i+1)throw new Error('noncontiguous_height');if(hx(b.previous_hash)!==(previous?.hash??ZERO_HASH))throw new Error('previous_hash_mismatch');const hash=hx(b.hash),ts=n(b.timestamp_ms);
    if(previous&&ts<n(previous.timestamp_ms))throw new Error('timestamp_before_parent');
    if(height<policy.activation_height){
      if(b.target_hex!==undefined&&b.target_hex!==null)throw new Error('pre_activation_target_forbidden');const bits=n(b.difficulty_bits),expected=nextDifficulty(chain.slice(0,i));if(bits!==expected)throw new Error('legacy_difficulty_mismatch');work+=legacyBitsWork(bits);
    }else{
      if(height===policy.activation_height){const parent=chain[i-1];if(!parent)throw new Error('activation_parent_prefix_required');const bits=nextDifficulty(chain.slice(0,i));ctx={activation_height:policy.activation_height,anchor_height:policy.activation_height,anchor_parent_height:height-1,anchor_parent_hash:hx(parent.hash),anchor_parent_time_seconds:Math.floor(n(parent.timestamp_ms)/1000),anchor_difficulty_bits:bits,anchor_target_hex:targetHex(targetFromLeadingZeroBits(bits)),half_life_seconds:policy.half_life_seconds,target_seconds:policy.target_seconds,pow_limit_hex:policy.pow_limit_hex};}
      if(b.difficulty_bits!==undefined&&b.difficulty_bits!==null)throw new Error('post_activation_legacy_bits_forbidden');const mtp=medianTimePast(chain.slice(0,i),{window:policy.mtp_window});if(mtp!==null&&ts<=mtp)throw new Error('timestamp_not_above_mtp');const actual=targetFromHex(String(b.target_hex)),expected=targetFor(b,ctx);if(actual!==expected)throw new Error('unexpected_activation_target');work+=workFromTarget(actual);
    }
    previous={hash,timestamp_ms:ts};
  }
  return{work,tip_hash:previous?.hash??ZERO_HASH,context:ctx};
}

export function referenceCompare(a,b,policy){const ar=referenceEvaluate(a,policy),br=referenceEvaluate(b,policy);let winner;if(ar.work!==br.work)winner=ar.work>br.work?'a':'b';else if(a.length!==b.length)winner=a.length>b.length?'a':'b';else winner=ar.tip_hash===br.tip_hash?'tie':ar.tip_hash<br.tip_hash?'a':'b';return{winner,a_work:ar.work,b_work:br.work,a_context:ar.context,b_context:br.context};}
