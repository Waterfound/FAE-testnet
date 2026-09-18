'use strict';

function requiredString(value,name){
  if(typeof value!=='string'||!value.length)throw new Error(name+' must be a non-empty string');
  return value;
}
function requiredGeneration(value){
  if(!Number.isSafeInteger(value)||value<1)throw new Error('generation must be a positive safe integer');
  return value;
}
function requiredHeight(value){
  if(!Number.isSafeInteger(value)||value<1)throw new Error('height must be a positive safe integer');
  return value;
}
function requiredHash(value,name='previous_hash'){
  const text=requiredString(value,name);
  if(!/^[0-9a-f]{64}$/.test(text))throw new Error(name+' must be 64 lowercase hex characters');
  return text;
}

export function makeWorkIdentity({network,header,rewardAddress,generation,sessionId}){
  const normalized=Object.freeze({
    schema:'FAE_MTS_WORK_ID_V1',
    session_id:requiredString(sessionId,'sessionId'),
    generation:requiredGeneration(generation),
    network:requiredString(network,'network'),
    height:requiredHeight(Number(header?.height)),
    previous_hash:requiredHash(header?.previous_hash),
    reward_address:requiredString(rewardAddress,'rewardAddress')
  });
  const key=[
    normalized.schema,
    normalized.session_id,
    normalized.generation,
    normalized.network,
    normalized.height,
    normalized.previous_hash,
    normalized.reward_address
  ].join('|');
  return Object.freeze({...normalized,work_id:key});
}

export function parentTipIdentity(work){
  return Object.freeze({
    height:requiredHeight(Number(work?.height))-1,
    tip_hash:requiredHash(work?.previous_hash)
  });
}

export class MiningSessionIdentityModel{
  #sessionId;
  #generation=0;
  #current=null;
  #history=[];

  constructor({sessionId}){
    this.#sessionId=requiredString(sessionId,'sessionId');
  }

  get sessionId(){return this.#sessionId}
  get generation(){return this.#generation}
  get current(){return this.#current}
  get history(){return Object.freeze(this.#history.map(item=>Object.freeze({...item})))}

  bindWork({network,header,rewardAddress}){
    this.#generation+=1;
    const identity=makeWorkIdentity({
      network,
      header,
      rewardAddress,
      generation:this.#generation,
      sessionId:this.#sessionId
    });
    this.#current=Object.freeze({identity,invalidated:false,invalidation_reason:null});
    this.#history.push({event:'WORK_BOUND',generation:this.#generation,work_id:identity.work_id});
    return identity;
  }

  invalidateCurrent(reason='TIP_INVALIDATED'){
    if(!this.#current)return Object.freeze({changed:false,reason:'NO_CURRENT_WORK'});
    if(this.#current.invalidated)return Object.freeze({changed:false,reason:'ALREADY_INVALIDATED',generation:this.#current.identity.generation});
    this.#current=Object.freeze({
      identity:this.#current.identity,
      invalidated:true,
      invalidation_reason:requiredString(reason,'reason')
    });
    this.#history.push({event:'WORK_INVALIDATED',generation:this.#current.identity.generation,reason});
    return Object.freeze({changed:true,generation:this.#current.identity.generation,reason});
  }

  classifyWorkerEvent({generation,type}){
    requiredGeneration(generation);
    requiredString(type,'type');
    if(!this.#current)return Object.freeze({accepted:false,reason:'NO_CURRENT_WORK'});
    if(generation!==this.#current.identity.generation){
      return Object.freeze({
        accepted:false,
        reason:'STALE_GENERATION',
        event_generation:generation,
        current_generation:this.#current.identity.generation
      });
    }
    if(this.#current.invalidated){
      return Object.freeze({
        accepted:false,
        reason:'INVALIDATED_GENERATION',
        event_generation:generation,
        current_generation:this.#current.identity.generation
      });
    }
    return Object.freeze({
      accepted:true,
      reason:'CURRENT_GENERATION',
      event_generation:generation,
      current_generation:this.#current.identity.generation
    });
  }
}
