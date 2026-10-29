'use strict';
// V36: run the ORIGINAL protected Wallet #342's PUBLIC coin selector, but never
// grant spending, custody, signer or transaction-submission authority.
// The original CLI and every import are verified by the already existing
// source-owner SHA-256 closure and snapshotted to eliminate checkout TOCTOU.
const {pathToFileURL}=require('node:url');
const {prepareAttestedWalletSource}=require('./native-wallet-terminal-handoff.cjs');
const {NETWORK}=require('./bridge-contract.cjs');
const HEX=/^[0-9a-f]{64}$/;
const ATOMS=/^(?:0|[1-9][0-9]*)$/;
const MAX_ATOMS=10n**16n;
function decimalAtoms(v,{zero=false}={}){
  if(typeof v!=='string'||v.length>40||
     !/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,8})?$/.test(v))
    throw Error('Untrusted decimal payment');
  const [whole,fraction='']=v.split('.');
  const atoms=BigInt(whole)*100000000n+BigInt((fraction+'00000000').slice(0,8));
  if(atoms>MAX_ATOMS||(!zero&&atoms===0n))
    throw Error('Payment outside public planning bounds');
  return atoms;
}
function validatePublicCandidates(review,candidates){
  if(!review||review.network!==NETWORK||
     review.state!=='UNSIGNED_PUBLIC_REVIEW_ONLY'||
     review.signing!=='UNAVAILABLE'||review.submission!=='NOT_SUBMITTED'||
     typeof review.from!=='string'||typeof review.to!=='string'||
     typeof review.amount_fae!=='string'||typeof review.fee_fae!=='string')
    throw Error('Untrusted original Wallet public planning request');
  if(!candidates||typeof candidates!=='object'||Array.isArray(candidates)||
     candidates.ok!==true||candidates.network!==NETWORK||
     candidates.address!==review.from||
     candidates.authority!=='SELECTED_NODE_UNTRUSTED_UTXO_CLAIM'||
     candidates.funding_authorization!=='DENIED_UNVERIFIED'||
     candidates.eligible_candidate_count!==0||
     candidates.eligible_candidate_atoms!=='0'||
     candidates.ownership!=='NOT_VERIFIED'||candidates.maturity!=='NOT_VERIFIED'||
     candidates.signer!=='UNAVAILABLE'||candidates.submission!=='NOT_PERFORMED'||
     !Number.isSafeInteger(candidates.observed_tip_height)||
     candidates.observed_tip_height<0||
     typeof candidates.observed_tip_hash!=='string'||!HEX.test(candidates.observed_tip_hash)||
     !Array.isArray(candidates.outputs)||candidates.outputs.length>500)
    throw Error('Untrusted original Wallet UTXO candidates');
  const seen=new Set();let total=0n,confirmed=0n;
  for(const row of candidates.outputs){
    if(!row||typeof row!=='object'||Array.isArray(row)||
       typeof row.outpoint!=='string'||!(/^[0-9a-f]{64}:[0-9]{1,4}$/.test(row.outpoint))||
       seen.has(row.outpoint)||!['confirmed','pending'].includes(row.source)||
       typeof row.amount_atoms!=='string'||!ATOMS.test(row.amount_atoms)||
       BigInt(row.amount_atoms)<=0n||row.spend_eligibility!=='UNVERIFIED'||
       !Array.isArray(row.exclusion_reasons)||
       !row.exclusion_reasons.includes('KEY_OWNERSHIP_UNVERIFIED')||
       !row.exclusion_reasons.includes('PROCESS_IDENTITY_UNAUTHENTICATED')||
       !row.exclusion_reasons.includes('SOURCE_PROVENANCE_UNVERIFIED'))
      throw Error('Original Wallet UTXO input has unverified or forged authority');
    seen.add(row.outpoint);
    const value=BigInt(row.amount_atoms);total+=value;
    if(row.source==='confirmed')confirmed+=value;
  }
  if(String(total)!==candidates.candidate_atoms||
     String(confirmed)!==candidates.confirmed_candidate_atoms)
    throw Error('Original Wallet UTXO candidates do not reconcile');
  return {confirmed,tip_height:candidates.observed_tip_height,
    tip_hash:candidates.observed_tip_hash};
}
async function planWithOriginalWallet({walletScript,review,candidates}={}){
  const {confirmed,tip_height,tip_hash}=validatePublicCandidates(review,candidates);
  const amount=decimalAtoms(review.amount_fae);
  const fee=decimalAtoms(review.fee_fae,{zero:true});
  if(amount+fee>MAX_ATOMS)throw Error('Original Wallet payment total too large');
  // The amount/fee authorization preview must refer to the SAME total as
  // the public review, including fee; never plan against a substituted total.
  const total=amount+fee;
  const [whole,fraction]=[total/100000000n,(total%100000000n).toString().padStart(8,'0').replace(/0+$/,'')];
  if(review.total_fae!==whole.toString()+(fraction?'.'+fraction:''))
    throw Error('Original Wallet public review total differs from plan');
  const base=Object.freeze({
    network:NETWORK,origin:'ORIGINAL_WALLET_342_SOURCE_PINNED',
    authority:'PUBLIC_UNTRUSTED_NODE_CANDIDATES_ONLY',
    input_authorization:'DENIED_UNVERIFIED',
    custody:'NOT_AUTHENTICATED',signing:'NOT_ADMITTED',
    submission:'NOT_SUBMITTED',
    observed_tip_height:tip_height,observed_tip_hash:tip_hash,
    confirmed_candidate_atoms:confirmed.toString()
  });
  if(!walletScript)return Object.freeze({...base,state:'ORIGINAL_WALLET_SOURCE_UNAVAILABLE'});
  // No vault, seed, private key, signer operation or user-selected executable.
  const stage=await prepareAttestedWalletSource(walletScript);
  try{
    const original=await import(pathToFileURL(stage.script).href);
    if(typeof original.planSpend!=='function')
      throw Error('Original Wallet #342 public planning function missing');
    if(confirmed<amount+fee)
      return Object.freeze({...base,state:'INSUFFICIENT_UNVERIFIED_CONFIRMED_CANDIDATES'});
    const raw=original.planSpend(candidates.outputs,review.from,review.to,amount,fee);
    if(!raw||!Array.isArray(raw.inputs)||raw.inputs.length<1||raw.inputs.length>64||
       !Array.isArray(raw.outputs)||raw.outputs.length<1||raw.outputs.length>2||
       raw.fee_atoms!==fee.toString())
      throw Error('Original Wallet public plan shape mismatch');
    const byPoint=new Map(candidates.outputs.filter(x=>x.source==='confirmed')
      .map(x=>[x.outpoint,BigInt(x.amount_atoms)]));
    const selected=new Set();let used=0n;
    for(const input of raw.inputs){
      if(typeof input!=='string'||!byPoint.has(input)||selected.has(input))
        throw Error('Original Wallet public plan attempted unverified input');
      selected.add(input);used+=byPoint.get(input);
    }
    if(raw.outputs[0]?.address!==review.to||
       raw.outputs[0]?.amount_atoms!==amount.toString()||
       (used===amount+fee?raw.outputs.length!==1:
         raw.outputs.length!==2||
         raw.outputs[1]?.address!==review.from||
         raw.outputs[1]?.amount_atoms!==(used-amount-fee).toString()))
      throw Error('Original Wallet public plan value mismatch');
    return Object.freeze({...base,state:'ORIGINAL_WALLET_UNVERIFIED_PUBLIC_PLAN',
      input_count:raw.inputs.length,selected_inputs:Object.freeze([...raw.inputs]),
      outputs:Object.freeze(raw.outputs.map(x=>Object.freeze({...x}))),
      selected_atoms:used.toString(),fee_atoms:fee.toString(),
      notice:'Original Wallet #342 used for public hypothetical input selection. Coinbase maturity, key ownership and process identity have NOT been proven. THIS PLAN CANNOT BE SIGNED OR SUBMITTED.'});
  }finally{await stage.release()}
}
// The existing ProcessController already has stable-tip read endpoints.
// Bind the original Wallet's hypothetical plan to the SAME actual owned node
// object AND chain tip after source attestation + coin selection has finished.
// This is a read-only result; it grants no spend/sign/submit authority.
const unavailable=(state)=>Object.freeze({
  state,signing:'NOT_ADMITTED',submission:'NOT_SUBMITTED',
  input_authorization:'DENIED_UNVERIFIED'
});
async function planWithOwnedNodeFinalityCheck({
  controller,walletScript,review,observed
}={}){
  if(!controller||typeof controller.readFundingCandidates!=='function'||
     typeof controller.readStatus!=='function'||!controller.node||
     !observed||typeof observed!=='object'||Array.isArray(observed)||
     !Number.isSafeInteger(observed.observed_tip_height)||
     observed.observed_tip_height<0||
     typeof observed.observed_tip_hash!=='string'||!HEX.test(observed.observed_tip_hash))
    throw Error('Real managed-node observation required for original Wallet plan');
  const owned=controller.node;
  const funding=await controller.readFundingCandidates(review.from);
  if(controller.node!==owned)
    return unavailable('NODE_PROCESS_REPLACED_NO_PLAN');
  if(funding.observed_tip_height!==observed.observed_tip_height||
     funding.observed_tip_hash!==observed.observed_tip_hash)
    return unavailable('NODE_TIP_CHANGED_NO_PLAN');
  const planned=await planWithOriginalWallet({
    walletScript,review,candidates:funding
  });
  if(controller.node!==owned)
    return unavailable('NODE_PROCESS_REPLACED_NO_PLAN');
  // Critical race fixed: the original Wallet source snapshot and selection
  // can take significant time; validate fresh node state AFTER planning.
  const final=await controller.readStatus();
  if(controller.node!==owned)
    return unavailable('NODE_PROCESS_REPLACED_NO_PLAN');
  if(final.height!==observed.observed_tip_height||
     final.tip_hash!==observed.observed_tip_hash)
    return unavailable('NODE_TIP_CHANGED_AFTER_PLAN');
  return planned;
}
module.exports={planWithOriginalWallet,planWithOwnedNodeFinalityCheck};
