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
function canonicalString(value){
  return JSON.stringify(value,Object.keys(value).sort());
}
export function activationPolicyId(policy){
  const fields=canonicalPolicyFields(policy);
  return createHash('sha256').update('FAE_ACTIVATION_POLICY_V1\0').update(canonicalString(fields)).digest('hex');
}
export function activationPolicyDescriptor(policy){
  const fields=canonicalPolicyFields(policy);
  return Object.freeze({status:ACTIVATION_POLICY_ID_STATUS,policy_id:activationPolicyId(policy),...fields});
}
export function assertActivationPolicyCompatible(localPolicy,remoteDescriptor){
  const local=activationPolicyDescriptor(localPolicy);
  if(!remoteDescriptor||remoteDescriptor.status!==ACTIVATION_POLICY_ID_STATUS)return{ok:false,error:'activation_policy_descriptor_required',local_policy_id:local.policy_id};
  const remoteId=String(remoteDescriptor.policy_id||'').toLowerCase();
  if(!/^[0-9a-f]{64}$/.test(remoteId))return{ok:false,error:'activation_policy_id_invalid',local_policy_id:local.policy_id};
  if(remoteId!==local.policy_id)return{ok:false,error:'activation_policy_mismatch',local_policy_id:local.policy_id,remote_policy_id:remoteId};
  return{ok:true,policy_id:local.policy_id};
}
export function policyFromParameters(parameters){return freezeActivationPolicy(parameters);}
export const POLICY_CONTEXT_MODE=ACTIVATION_CONTEXT_MODE;
