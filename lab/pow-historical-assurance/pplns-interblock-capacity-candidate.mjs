/**
 * HPA-UC-001 W3 — bounded atom-level inter-block payout *counterfactual*.
 * No source ShareCoordinator changes, monetary rule, pool admission,
 * custody, enforceable future entitlement, or active consensus.
 *
 * Fundamental constraint: a canonical coinbase can pay at most 256 positive
 * addresses, and at most rewardAtoms addresses when each receives >=1 atom.
 * Min-block coverage assumes stable weights, constant positive rewards,
 * no orphaned blocks and successful ongoing participation; it is necessary
 * capacity arithmetic, NOT payment finality or a scheduling guarantee.
 *
 * The replay below is intentionally address-lexicographic in ties to make
 * its address-grinding vulnerability visible instead of calling it fair.
 */
import {MAX_COINBASE_OUTPUTS,PPLNS_COINBASE_ACTIVATION_HEIGHT}
  from '../../sovereign-forge/node/authoritative/pplns-activation.mjs';
import {isValidAddress} from '../../sovereign-forge/node/authoritative/address.mjs';

const fail=code=>{throw Object.assign(new Error(code),{code});};
const atomic=x=>
  typeof x==='bigint'&&x>=0n?x:
  typeof x==='string'&&/^(0|[1-9][0-9]*)$/.test(x)?BigInt(x):null;

export function minimumDirectCoverageBlocks({beneficiaries,rewardAtomsPerBlock}={}){
  const atoms=atomic(rewardAtomsPerBlock);
  if(!Number.isSafeInteger(beneficiaries)||beneficiaries<1||
     beneficiaries>2048||atoms===null)fail('invalid_interblock_coverage_inputs');
  const payablePerBlock=Number(
    atoms<BigInt(MAX_COINBASE_OUTPUTS)?atoms:BigInt(MAX_COINBASE_OUTPUTS));
  return {
    payees:beneficiaries,per_block_output_cap:MAX_COINBASE_OUTPUTS,
    per_block_positive_atom_capacity:payablePerBlock,
    minimum_blocks_to_touch_every_payee:payablePerBlock===0?null:
      Math.ceil(beneficiaries/payablePerBlock),
    requires_positive_canonical_rewards:payablePerBlock!==0,
    permission_to_activate:false,
    current_pplns_activation_height:PPLNS_COINBASE_ACTIVATION_HEIGHT,
    guaranteed_future_payment:false,
    guaranteed_non_custodial_entitlement:false
  };
}

/**
 * One-atom weighted deficit allocator with a hard per-block atom ceiling.
 * Source weights MUST be supplied from independent verified ShareLedger
 * provenance; this function does not authenticate a supplied weight array.
 * Not implemented in real block generation and not Sybil resistant.
 */
export function simulateDirectAtomRounds({weights,rewardAtomsPerBlock,blocks}={}){
  const atoms=atomic(rewardAtomsPerBlock);
  if(!Array.isArray(weights)||weights.length<1||weights.length>2048||
     !Number.isSafeInteger(blocks)||blocks<1||blocks>2048||
     atoms===null||atoms<1n||atoms>BigInt(MAX_COINBASE_OUTPUTS))
    fail('invalid_interblock_simulation_inputs');
  const participants=weights.map(w=>{
    const a=w?.address,v=atomic(w?.weight);
    if(typeof a!=='string'||!isValidAddress(a,'faet')||v===null||v<1n)
      fail('invalid_interblock_weight');
    return {address:a,weight:v,deficit:0n,paid:0n};
  }).sort((a,b)=>a.address.localeCompare(b.address));
  if(new Set(participants.map(p=>p.address)).size!==participants.length)
    fail('duplicate_interblock_payee');
  const totalWeight=participants.reduce((s,p)=>s+p.weight,0n);
  const outputs=[];
  for(let b=0;b<blocks;b++){
    const paidThisBlock=new Map();
    for(let unit=0n;unit<atoms;unit++){
      for(const p of participants)p.deficit+=p.weight;
      let chosen=participants[0];
      for(const p of participants)if(p.deficit>chosen.deficit)chosen=p;
      chosen.deficit-=totalWeight;
      chosen.paid++;
      paidThisBlock.set(chosen.address,(paidThisBlock.get(chosen.address)??0n)+1n);
    }
    const coinbaseOutputs=participants
      .filter(p=>paidThisBlock.has(p.address))
      .map(p=>({address:p.address,amount_atoms:paidThisBlock.get(p.address).toString()}));
    if(coinbaseOutputs.length>MAX_COINBASE_OUTPUTS||
       coinbaseOutputs.reduce((s,p)=>s+BigInt(p.amount_atoms),0n)!==atoms)
      fail('interblock_conservation_failure');
    outputs.push(coinbaseOutputs);
  }
  return {
    rounds:outputs,paid:participants.map(p=>({address:p.address,
      amount_atoms:p.paid.toString()})),
    total_atoms:(atoms*BigInt(blocks)).toString(),
    maximum_outputs:MAX_COINBASE_OUTPUTS,
    policy_activated:false,guaranteed_future_payment:false,
    sybil_resistant:false,tip_independent_but_address_order_sensitive:true
  };
}
