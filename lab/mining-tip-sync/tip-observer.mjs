'use strict';

function validHash(value){
  return typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
}
function validHeight(value){
  return Number.isSafeInteger(Number(value))&&Number(value)>=0;
}

export const TIP_OBSERVER_STATES=Object.freeze({
  CURRENT:'current',
  STALE:'stale',
  UNKNOWN:'unknown',
  REVALIDATE:'revalidate'
});

export function classifyAuthoritativeTip({work,observation}){
  const parentHeight=Number(work?.height)-1;
  const parentHash=work?.previous_hash;

  if(!Number.isSafeInteger(parentHeight)||parentHeight<0||!validHash(parentHash)){
    return Object.freeze({state:TIP_OBSERVER_STATES.UNKNOWN,reason:'INVALID_WORK_IDENTITY',authoritative:false});
  }

  if(!observation||observation.ok===false){
    return Object.freeze({state:TIP_OBSERVER_STATES.UNKNOWN,reason:'OBSERVER_UNAVAILABLE',authoritative:false});
  }

  const observedHeight=Number(observation.height);
  const observedHash=observation.tip_hash;
  if(!validHeight(observedHeight)||!validHash(observedHash)){
    return Object.freeze({state:TIP_OBSERVER_STATES.UNKNOWN,reason:'MALFORMED_AUTHORITATIVE_STATE',authoritative:false});
  }

  if(observedHeight<parentHeight){
    return Object.freeze({
      state:TIP_OBSERVER_STATES.UNKNOWN,
      reason:'OBSERVER_BEHIND_WORK_PARENT',
      authoritative:true,
      parent_height:parentHeight,
      observed_height:observedHeight
    });
  }

  if(observedHeight===parentHeight&&observedHash===parentHash){
    return Object.freeze({
      state:TIP_OBSERVER_STATES.CURRENT,
      reason:'PARENT_TIP_MATCH',
      authoritative:true,
      parent_height:parentHeight,
      observed_height:observedHeight,
      observed_tip_hash:observedHash
    });
  }

  if(observedHeight===parentHeight&&observedHash!==parentHash){
    return Object.freeze({
      state:TIP_OBSERVER_STATES.STALE,
      reason:'PARENT_REPLACED',
      authoritative:true,
      parent_height:parentHeight,
      observed_height:observedHeight,
      observed_tip_hash:observedHash
    });
  }

  return Object.freeze({
    state:TIP_OBSERVER_STATES.STALE,
    reason:'CHAIN_ADVANCED',
    authoritative:true,
    parent_height:parentHeight,
    observed_height:observedHeight,
    observed_tip_hash:observedHash
  });
}

export function classifyCrossTabHint(hint){
  return Object.freeze({
    state:TIP_OBSERVER_STATES.REVALIDATE,
    reason:'UNTRUSTED_ACCELERATION_HINT',
    authoritative:false,
    hinted_height:validHeight(hint?.height)?Number(hint.height):null,
    hinted_tip_hash:validHash(hint?.tip_hash)?hint.tip_hash:null
  });
}

export const TIP_OBSERVER_CONTRACT=Object.freeze({
  version:1,
  source:'/status',
  authoritative_identity:Object.freeze(['height','tip_hash']),
  work_parent_identity:Object.freeze(['height - 1','previous_hash']),
  mempool_only_change_invalidates_work:false,
  same_device_hint_is_authority:false,
  lifecycle_resume_requires_revalidation:true,
  observer_failure_classification:'unknown'
});
