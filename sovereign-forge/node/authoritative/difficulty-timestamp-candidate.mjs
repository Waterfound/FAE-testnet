export const DAA_STATUS='candidate-not-active-consensus';
export const TARGET_SECONDS=180;
export const MTP_WINDOW=11;
export const FUTURE_DRIFT_MS=90_000;
export const TESTNET_CANDIDATE_HALF_LIFE_SECONDS=6*60*60;
export const HALF_LIFE_CANDIDATES_SECONDS=Object.freeze([6,12,24,48].map(hours=>hours*60*60));
export const RADIX=65536n;
export const MAX_HASH=(1n<<256n)-1n;
export const CANDIDATE_MIN_LEADING_ZERO_BITS=12;
export const POW_LIMIT=MAX_HASH>>BigInt(CANDIDATE_MIN_LEADING_ZERO_BITS);

function integer(value,label){
  const n=Number(value);
  if(!Number.isSafeInteger(n))throw new Error(`${label}_must_be_safe_integer`);
  return n;
}
function positiveInteger(value,label){const n=integer(value,label);if(n<=0)throw new Error(`${label}_must_be_positive`);return n}
export function targetFromLeadingZeroBits(bits){
  const n=integer(bits,'bits');if(n<0||n>255)throw new Error('bits_out_of_range');return MAX_HASH>>BigInt(n);
}
export function targetHex(target){
  const t=BigInt(target);if(t<=0n||t>MAX_HASH)throw new Error('target_out_of_range');return t.toString(16).padStart(64,'0');
}
export function targetFromHex(hex){
  if(typeof hex!=='string'||!/^[0-9a-f]{64}$/i.test(hex))throw new Error('invalid_target_hex');const target=BigInt(`0x${hex}`);if(target<=0n||target>MAX_HASH)throw new Error('target_out_of_range');return target;
}
export function hashMeetsTarget(hashHex,target){
  if(typeof hashHex!=='string'||!/^[0-9a-f]{64}$/i.test(hashHex))return false;const t=BigInt(target);if(t<=0n||t>MAX_HASH)return false;return BigInt(`0x${hashHex}`)<=t;
}

export function medianTimePast(chain,{window=MTP_WINDOW}={}){
  const width=positiveInteger(window,'mtp_window');if(!Array.isArray(chain))throw new Error('chain_required');if(chain.length===0)return null;
  const values=chain.slice(-width).map((block,index)=>integer(block?.timestamp_ms,`timestamp_${index}`)).sort((a,b)=>a-b);
  return values[Math.floor(values.length/2)];
}

export function validateCandidateTimestamp(chain,timestampMs,{nowMs=Date.now(),window=MTP_WINDOW,futureDriftMs=FUTURE_DRIFT_MS}={}){
  const timestamp=integer(timestampMs,'timestamp_ms'),now=integer(nowMs,'now_ms'),drift=integer(futureDriftMs,'future_drift_ms');
  if(timestamp<0||now<0||drift<0)return{ok:false,error:'negative_timestamp_context'};
  if(!Array.isArray(chain))throw new Error('chain_required');
  const previous=chain.at(-1)||null,mtp=medianTimePast(chain,{window}),maxFutureMs=now+drift;
  if(previous&&timestamp<integer(previous.timestamp_ms,'previous_timestamp_ms'))return{ok:false,error:'timestamp_before_parent',mtp,maxFutureMs};
  if(mtp!==null&&timestamp<=mtp)return{ok:false,error:'timestamp_not_above_mtp',mtp,maxFutureMs};
  if(timestamp>maxFutureMs)return{ok:false,error:'timestamp_too_far_future',mtp,maxFutureMs};
  return{ok:true,mtp,maxFutureMs};
}

function truncDiv(numerator,denominator){if(denominator===0n)throw new Error('division_by_zero');return numerator/denominator}
function floorDivRadix(value){
  if(value>=0n)return value/RADIX;
  return -(((-value)+RADIX-1n)/RADIX);
}

export function asertTargetCandidate({anchorTarget,anchorHeight,anchorParentTimeSeconds,evaluationHeight,evaluationTimeSeconds,targetSeconds=TARGET_SECONDS,halfLifeSeconds=TESTNET_CANDIDATE_HALF_LIFE_SECONDS,powLimit=POW_LIMIT}){
  let targetRef=BigInt(anchorTarget),limit=BigInt(powLimit);
  const hRef=positiveInteger(anchorHeight,'anchor_height'),hEval=integer(evaluationHeight,'evaluation_height');
  const tRef=integer(anchorParentTimeSeconds,'anchor_parent_time_seconds'),tEval=integer(evaluationTimeSeconds,'evaluation_time_seconds');
  const ideal=positiveInteger(targetSeconds,'target_seconds'),halfLife=positiveInteger(halfLifeSeconds,'half_life_seconds');
  if(hEval<hRef)throw new Error('evaluation_before_anchor');if(targetRef<=0n||targetRef>limit||limit<=0n||limit>MAX_HASH)throw new Error('invalid_target_bounds');
  const timeDelta=BigInt(tEval-tRef),heightDelta=BigInt(hEval-hRef);
  let exponent=truncDiv((timeDelta-BigInt(ideal)*(heightDelta+1n))*RADIX,BigInt(halfLife));
  const numShifts=floorDivRadix(exponent);exponent-=numShifts*RADIX;
  const factor=((195766423245049n*exponent+971821376n*exponent*exponent+5127n*exponent*exponent*exponent+(1n<<47n))>>48n)+RADIX;
  let nextTarget=targetRef*factor;
  if(numShifts<0n)nextTarget>>=-numShifts;else nextTarget<<=numShifts;
  nextTarget>>=16n;
  if(nextTarget<=0n)return 1n;if(nextTarget>limit)return limit;return nextTarget;
}

export function candidateNextTarget(chain,{anchor,halfLifeSeconds=TESTNET_CANDIDATE_HALF_LIFE_SECONDS,targetSeconds=TARGET_SECONDS,powLimit=POW_LIMIT}={}){
  if(!Array.isArray(chain)||chain.length===0)throw new Error('nonempty_chain_required');if(!anchor)throw new Error('anchor_required');
  const evaluation=chain.at(-1);
  return asertTargetCandidate({anchorTarget:anchor.target,anchorHeight:anchor.height,anchorParentTimeSeconds:anchor.parent_time_seconds,evaluationHeight:evaluation.height,evaluationTimeSeconds:Math.floor(integer(evaluation.timestamp_ms,'evaluation_timestamp_ms')/1000),targetSeconds,halfLifeSeconds,powLimit});
}

export function timestampAttackEaseBoundPpm({futureDriftMs=FUTURE_DRIFT_MS,halfLifeSeconds=TESTNET_CANDIDATE_HALF_LIFE_SECONDS}={}){
  const drift=integer(futureDriftMs,'future_drift_ms'),halfLife=positiveInteger(halfLifeSeconds,'half_life_seconds');
  // Conservative first-order bound in ppm: ln(2)*drift/halfLife. 693147/1e6 approximates ln(2).
  return Number((693147n*BigInt(drift)*1_000_000n)/(1_000_000n*BigInt(halfLife)*1000n));
}
