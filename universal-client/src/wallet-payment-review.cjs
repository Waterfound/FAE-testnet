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
module.exports={parseFaeAmount,formatAtoms,reviewPublicPayment};
