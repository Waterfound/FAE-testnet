/**
 * HPA-W3-70..74 — structural PPLNS coinbase admission on ORIGINAL FAE rules.
 * Research/candidate preflight only: never installed in node/coordinator,
 * no activation, not a monetary policy or a proof of pool fairness.
 *
 * A full 2,048-share source window can contain >256 distinct payees, exceeding
 * MAX_COINBASE_OUTPUTS. Tiny payouts also filter zero-weighted-atom outputs,
 * changing the primary coinbase recipient required by active FAE consensus.
 * Fail closed: do not silently drop eligible miners or synthesize a fee.
 */
import {allocatePplnsOutputs} from '../../sovereign-forge/node/authoritative/share-coordinator.mjs';
import {MAX_COINBASE_OUTPUTS,normalizeCoinbaseOutputs,sumCoinbaseOutputs}
  from '../../sovereign-forge/node/authoritative/pplns-activation.mjs';
import {isValidAddress} from '../../sovereign-forge/node/authoritative/address.mjs';
import {hashHex} from '../../sovereign-forge/node/authoritative/crypto.mjs';

const reject=(reason,extra={})=>({
  verdict:'CONDITION_WAIT_UNSAFE_PPLNS_TEMPLATE',reason,
  safe_to_sign_job:false,policy_activated:false,
  mainnet_economic_proof:false,...extra
});
const canonicalAtoms=x=>typeof x==='bigint'&&x>=0n||
  typeof x==='string'&&/^(0|[1-9][0-9]*)$/.test(x);

export function assessSourcePplnsCoinbaseAdmission({
  weights,totalRewardAtoms,declaredMinerAddress
}={}){
  if(!Array.isArray(weights)||!weights.length||
     weights.length>100_000||
     !canonicalAtoms(totalRewardAtoms)||
     typeof declaredMinerAddress!=='string'||
     !isValidAddress(declaredMinerAddress,'faet'))
    return reject('invalid_source_pplns_admission_input');
  const seen=new Set();
  let previous='';
  const validated=[];
  for(const row of weights){
    const address=row?.address,raw=row?.weight;
    if(typeof address!=='string'||!isValidAddress(address,'faet')||
      address<=previous||seen.has(address)||
      !(typeof raw==='bigint'&&raw>0n||
        typeof raw==='string'&&/^[1-9][0-9]*$/.test(raw)))
      return reject('invalid_or_unordered_source_weights');
    previous=address;seen.add(address);
    validated.push({address,weight:BigInt(raw)});
  }
  // The same canonical, source-sorted address becomes miner_address in
  // createDistributedTemplate. No unpaid primary may be silently replaced.
  if(declaredMinerAddress!==validated[0].address)
    return reject('source_primary_address_mismatch');
  if(validated.length>MAX_COINBASE_OUTPUTS)
    return reject('source_window_exceeds_consensus_output_limit',{
      payees:validated.length,consensus_max_outputs:MAX_COINBASE_OUTPUTS
    });
  const reward=BigInt(totalRewardAtoms);
  if(reward===0n)return reject('zero_reward_has_no_valid_coinbase');
  const raw=allocatePplnsOutputs(reward,validated);
  if(raw.length===0||raw.length>MAX_COINBASE_OUTPUTS)
    return reject('invalid_source_payout_count');
  if(raw[0].address!==declaredMinerAddress)
    return reject('zero_value_source_primary_filtered',{
      payees:validated.length,positive_output_count:raw.length,
      source_primary:declaredMinerAddress,actual_primary:raw[0].address
    });
  let outputs;
  try{
    outputs=normalizeCoinbaseOutputs(raw,{
      validAddress:x=>isValidAddress(x,'faet'),
      maxOutputs:MAX_COINBASE_OUTPUTS
    });
  }catch{
    return reject('source_coinbase_normalization_failed');
  }
  if(sumCoinbaseOutputs(outputs)!==reward)
    return reject('source_coinbase_sum_mismatch');
  return {
    verdict:'STRUCTURAL_CANDIDATE_ONLY',reason:null,
    safe_to_sign_job:false,
    source_coinbase_structurally_encodable:true,
    policy_activated:false,mainnet_economic_proof:false,
    expected_outputs:outputs,expected_coinbase_root:hashHex(outputs),
    source_primary:declaredMinerAddress,positive_output_count:outputs.length,
    payees:validated.length
  };
}
