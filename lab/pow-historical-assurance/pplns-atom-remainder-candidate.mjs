/**
 * HPA-UC-001 — source-allocator falsification and ALTERNATIVE finite-atom
 * rounding policy. NOT installed, not activated, not a consensus change.
 *
 * Existing FAE allocatePplnsOutputs floors every address except the last;
 * the last receives all fractional leftovers regardless of its entitlement.
 * At tiny subsidies this yields address-order exploitation incentives.
 *
 * This candidate instead uses largest remainders with a deterministic
 * source-tip seed for ties. Tie seeds are PUBLIC and potentially grindable:
 * this does NOT prove incentive compatibility / Sybil resistance / fairness
 * against strategic miners. It only removes one deterministic last-index bias
 * in a bounded counterfactual experiment.
 */
import {hashHex} from '../../sovereign-forge/node/authoritative/crypto.mjs';
import {isValidAddress} from '../../sovereign-forge/node/authoritative/address.mjs';

const fail=(code)=>{throw Object.assign(new Error(code),{code})};

export function allocateLargestRemainderCandidate(totalRewardAtoms,weights,{tipHash}={}){
  const amount=typeof totalRewardAtoms==='bigint'?totalRewardAtoms:
    typeof totalRewardAtoms==='string'&&/^(0|[1-9][0-9]*)$/.test(totalRewardAtoms)?
      BigInt(totalRewardAtoms):null;
  if(amount===null||amount<0n||!Array.isArray(weights)||weights.length<1||
     weights.length>100_000||typeof tipHash!=='string'||!/^[0-9a-f]{64}$/.test(tipHash))
    fail('invalid_rounding_candidate_inputs');
  const seen=new Set();
  const items=weights.map((x,i)=>{
    const address=x?.address;
    const raw=x?.weight;
    const weight=typeof raw==='bigint'?raw:
      typeof raw==='string'&&/^[1-9][0-9]*$/.test(raw)?BigInt(raw):null;
    if(typeof address!=='string'||!isValidAddress(address,'faet')||
       weight===null||weight<=0n||seen.has(address))
      fail('invalid_rounding_candidate_weight');
    seen.add(address);
    return {address,weight,i};
  });
  const totalWeight=items.reduce((sum,x)=>sum+x.weight,0n);
  let floors=0n;
  const rows=items.map(x=>{
    const numerator=amount*x.weight;
    const base=numerator/totalWeight;
    floors+=base;
    return {...x,base,remainder:numerator%totalWeight};
  });
  let extra=amount-floors;
  if(extra<0n||extra>=BigInt(items.length))
    fail('rounding_remainder_out_of_bounds');
  const winners=[...rows].sort((a,b)=>{
    if(a.remainder!==b.remainder)return a.remainder>b.remainder?-1:1;
    const ah=hashHex({domain:'FAE_HPA_PPLNS_ROUNDING_CANDIDATE',tipHash,address:a.address});
    const bh=hashHex({domain:'FAE_HPA_PPLNS_ROUNDING_CANDIDATE',tipHash,address:b.address});
    return ah.localeCompare(bh)||a.address.localeCompare(b.address);
  });
  const bump=new Set(winners.slice(0,Number(extra)).map(x=>x.address));
  return rows.map(x=>({address:x.address,amount_atoms:
    (x.base+(bump.has(x.address)?1n:0n)).toString()}))
    .filter(x=>BigInt(x.amount_atoms)>0n);
}
