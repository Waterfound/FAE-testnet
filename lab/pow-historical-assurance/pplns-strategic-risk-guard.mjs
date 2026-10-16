/**
 * HPA-UC-001 W3 — guard existing, inactive PPLNS candidate until strategic
 * reward-withholding evidence is genuinely accepted. Not a pool feature.
 * This standalone guard is NOT wired into production/branch protections.
 */
import {PPLNS_COINBASE_ACTIVATION_HEIGHT,isPplnsCoinbaseActive,activationConfigured} from '../../sovereign-forge/node/authoritative/pplns-activation.mjs';

export function assessCurrentPplnsAdmission(){
  const height=PPLNS_COINBASE_ACTIVATION_HEIGHT;
  if(height!==null||activationConfigured()||isPplnsCoinbaseActive(1)||isPplnsCoinbaseActive(Number.MAX_SAFE_INTEGER)){
    throw Object.assign(new Error('HPA_POOL_STRATEGIC_ACTIVATION_NOT_ADMITTED'),{code:'HPA_POOL_STRATEGIC_ACTIVATION_NOT_ADMITTED'});
  }
  return {verdict:'HPA_POOL_INACTIVE_STRATEGIC_RISK_CONTAINED_ONLY',
    mainnet_bwh_faw_economic_proof:false,release_or_approval_created:false,
    active_pool_consensus:false,remaining:['final finite-window and stale-job attack economics','propagation and fork/tie policy','multi-pool EFAW relevance','specific human authority to change activation']};
}
/** A non-null future height is NOT silently accepted as a safe strategic risk. */
export function requireFreshStrategicAuthority({activationHeight}={}){
  if(activationHeight!==null){
    throw Object.assign(new Error('HPA_POOL_STRATEGIC_ACTIVATION_NOT_ADMITTED'),{code:'HPA_POOL_STRATEGIC_ACTIVATION_NOT_ADMITTED'});
  }
  return assessCurrentPplnsAdmission();
}
