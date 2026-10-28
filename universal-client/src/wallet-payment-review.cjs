'use strict';
// Public payment REVIEW ONLY: cannot create/sign/submit transactions or unlock a vault.
// The canonical FAE address codec is imported by the trusted Electron main process.
const {pathToFileURL}=require('node:url');
const {NETWORK}=require('./bridge-contract.cjs');
const MAX_ATOMS=10n**16n;
const PUBLIC_FIELDS=new Set(['from','to','amount','fee']);
function parseFaeAmount(value,{allowZero=false}={}){
  if(typeof value!=='string'||value.length>40||
     !/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,8})?$/.test(value))
    throw Error('Invalid FAE decimal amount (up to 8 decimals)');
  const [whole,fraction='']=value.split('.');
  const atoms=BigInt(whole)*100000000n+BigInt((fraction+'00000000').slice(0,8));
  if((!allowZero&&atoms===0n)||atoms>MAX_ATOMS)
    throw Error('FAE amount outside candidate review bounds');
  return atoms;
}
function formatAtoms(atoms){
  const whole=atoms/100000000n,part=(atoms%100000000n).toString().padStart(8,'0').replace(/0+$/,'');
  return whole.toString()+(part?'.'+part:'');
}
async function reviewPublicPayment(input,{addressSource}={}){
  if(!input||typeof input!=='object'||Array.isArray(input)||
    Object.keys(input).some(k=>!PUBLIC_FIELDS.has(k))||
    ['from','to','amount','fee'].some(k=>!Object.hasOwn(input,k)))
    throw Error('Only public payment review fields are allowed');
  if(typeof addressSource!=='string'||!addressSource.endsWith('address.mjs'))
    throw Error('Canonical address verifier unavailable');
  // Never accept an address based on a permissive regex alone: verify Bech32m.
  const {isValidAddress}=await import(pathToFileURL(addressSource).href);
  if(!isValidAddress(input.from)||!isValidAddress(input.to))
    throw Error('Invalid canonical FAE testnet address');
  const amount=parseFaeAmount(input.amount);
  const fee=parseFaeAmount(input.fee,{allowZero:true});
  if(amount+fee>MAX_ATOMS)throw Error('FAE total outside candidate review bounds');
  return Object.freeze({
    network:NETWORK,asset:'FAE',project:'Triumph Sovereign',intended_ticker:'TRIUM',
    from:input.from,to:input.to,
    amount_fae:formatAtoms(amount),fee_fae:formatAtoms(fee),
    total_fae:formatAtoms(amount+fee),
    state:'UNSIGNED_PUBLIC_REVIEW_ONLY',signing:'UNAVAILABLE',
    submission:'NOT_SUBMITTED',balance:'NOT_CHECKED',
    custody:'SOURCE_ADDRESS_NOT_AUTHENTICATED',node:'NOT_USED',
    notice:'Public unsigned draft only. No vault ownership, spendability, signing or transaction submission.'
  });
}

function compareObservedFunds(publicReview,nodeBalance){
  // This does not confer signer authority, confirmed UTXO spendability, or
  // independently verified consensus. The caller must use a stable-tip read.
  if(!publicReview||publicReview.state!=='UNSIGNED_PUBLIC_REVIEW_ONLY'||
     publicReview.network!==NETWORK||typeof publicReview.from!=='string'||
     typeof publicReview.amount_fae!=='string'||typeof publicReview.fee_fae!=='string'||
     typeof publicReview.total_fae!=='string'){
    throw Error('Unverified public payment review');
  }
  if(!nodeBalance||typeof nodeBalance!=='object'||Array.isArray(nodeBalance)||
     nodeBalance.address!==publicReview.from||nodeBalance.ok!==true||
     (nodeBalance.network!==undefined&&nodeBalance.network!==NETWORK)||
     typeof nodeBalance.balance_atoms!=='string'||
     !Number.isSafeInteger(nodeBalance.observed_tip_height)||
     nodeBalance.observed_tip_height<0||
     !/^[0-9a-f]{64}$/.test(String(nodeBalance.observed_tip_hash))||
     !/^(?:0|[1-9][0-9]*)$/.test(nodeBalance.balance_atoms)||
     nodeBalance.balance_atoms.length>80){
    throw Error('Invalid selected-node funding observation');
  }
  const amount=parseFaeAmount(publicReview.amount_fae);
  const fee=parseFaeAmount(publicReview.fee_fae,{allowZero:true});
  if(formatAtoms(amount+fee)!==publicReview.total_fae)
    throw Error('Public payment total mismatched');
  const observed=BigInt(nodeBalance.balance_atoms);
  return Object.freeze({
    ...publicReview,
    balance:'SELECTED_NODE_OBSERVATION',
    node:'CURRENT_MANAGED_LOCAL_NODE_ASSERTION',
    observed_fae:formatAtoms(observed),
    observed_atoms:observed.toString(),
    observed_tip_height:nodeBalance.observed_tip_height,
    observed_tip_hash:nodeBalance.observed_tip_hash,
    provenance:'selected_managed_node_stable_tip_claim_not_independent_finality',
    funding:'NODE_REPORTED_BALANCE_BELOW_DRAFT_TOTAL' ,
    ...((observed>=amount+fee)?{funding:'NODE_REPORTED_BALANCE_AT_LEAST_DRAFT_TOTAL'}:{}),
    spendability:'NOT_VERIFIED',
    confirmation:'NOT_INDEPENDENTLY_VERIFIED',
    signing:'UNAVAILABLE',
    submission:'NOT_SUBMITTED',
    notice:'Selected local node reports balance only. No vault ownership, confirmed spendability, signing or transaction submission.'
  });
}

module.exports={parseFaeAmount,formatAtoms,reviewPublicPayment,compareObservedFunds};
