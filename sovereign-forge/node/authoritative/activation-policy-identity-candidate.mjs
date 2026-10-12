import {createHash} from 'node:crypto';
import {freezeActivationPolicy,ACTIVATION_REORG_STATUS,ACTIVATION_CONTEXT_MODE} from './activation-reorg-candidate.mjs';

export const ACTIVATION_POLICY_ID_STATUS='candidate-not-active-consensus';
export const ACTIVATION_POLICY_ID_VERSION=1;

function canonicalPolicyFields(policy){
  if(!policy||policy.status!==ACTIVATION_REORG_STATUS)throw new Error('activation_policy_required');
  return {
    version:ACTIVATION_POLICY_ID_VERSION,
    activation_height:Number(policy.activation_height),
    context_mode:String(policy.context_mode),
    half_life_seconds:Number(policy.half_life_seconds),
    target_seconds:Number(policy.target_seconds),
    pow_limit_hex:String(policy.pow_limit_hex).toLowerCase(),
    mtp_window:Number(policy.mtp_window),
    future_drift_ms:Number(policy.future_drift_ms)
  };
}
function canonicalString(value){return JSON.stringify(value,Object.keys(value).sort());}
function hashFields(fields){return createHash('sha256').update('FAE_ACTIVATION_POLICY_V1\0').update(canonicalString(fields)).digest('hex');}
function descriptorFields(descriptor){
  if(!descriptor||descriptor.status!==ACTIVATION_POLICY_ID_STATUS)throw new Error('activation_policy_descriptor_required');
  const fields={
    version:Number(descriptor.version),activation_height:Number(descriptor.activation_height),context_mode:String(descriptor.context_mode),
    half_life_seconds:Number(descriptor.half_life_seconds),target_seconds:Number(descriptor.target_seconds),pow_limit_hex:String(descriptor.pow_limit_hex||'').toLowerCase(),
    mtp_window:Number(descriptor.mtp_window),future_drift_ms:Number(descriptor.future_drift_ms)
  };
  if(fields.version!==ACTIVATION_POLICY_ID_VERSION||!Number.isSafeInteger(fields.activation_height)||fields.activation_height<2||fields.context_mode!==ACTIVATION_CONTEXT_MODE||
     !Number.isSafeInteger(fields.half_life_seconds)||fields.half_life_seconds<=0||!Number.isSafeInteger(fields.target_seconds)||fields.target_seconds<=0||
     !/^[0-9a-f]{64}$/.test(fields.pow_limit_hex)||!Number.isSafeInteger(fields.mtp_window)||fields.mtp_window<=0||
     !Number.isSafeInteger(fields.future_drift_ms)||fields.future_drift_ms<0)throw new Error('activation_policy_descriptor_invalid');
  return fields;
}
export function activationPolicyId(policy){return hashFields(canonicalPolicyFields(policy));}
export function activationPolicyDescriptor(policy){const fields=canonicalPolicyFields(policy);return Object.freeze({status:ACTIVATION_POLICY_ID_STATUS,policy_id:hashFields(fields),...fields});}
export function assertActivationPolicyCompatible(localPolicy,remoteDescriptor){
  const local=activationPolicyDescriptor(localPolicy);
  if(!remoteDescriptor||remoteDescriptor.status!==ACTIVATION_POLICY_ID_STATUS)return{ok:false,error:'activation_policy_descriptor_required',local_policy_id:local.policy_id};
  const remoteId=String(remoteDescriptor.policy_id||'').toLowerCase();
  if(!/^[0-9a-f]{64}$/.test(remoteId))return{ok:false,error:'activation_policy_id_invalid',local_policy_id:local.policy_id};
  let fields;try{fields=descriptorFields(remoteDescriptor)}catch(error){return{ok:false,error:error.message,local_policy_id:local.policy_id,remote_policy_id:remoteId};}
  const recomputed=hashFields(fields);
  if(recomputed!==remoteId)return{ok:false,error:'activation_policy_descriptor_tampered',local_policy_id:local.policy_id,remote_policy_id:remoteId,recomputed_remote_policy_id:recomputed};
  if(remoteId!==local.policy_id)return{ok:false,error:'activation_policy_mismatch',local_policy_id:local.policy_id,remote_policy_id:remoteId};
  return{ok:true,policy_id:local.policy_id};
}
export function policyFromParameters(parameters){return freezeActivationPolicy(parameters);}
export const POLICY_CONTEXT_MODE=ACTIVATION_CONTEXT_MODE;
