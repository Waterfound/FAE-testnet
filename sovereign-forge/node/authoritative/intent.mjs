import {hashHex} from './crypto.mjs';
import {isValidAddress} from './address.mjs';

export const SEND_INTENT_KIND='fairyelf-send-intent-v1';

function normalizeAtomic(value,field){let parsed;try{parsed=BigInt(value)}catch{throw new Error(`${field} must be an integer atomic amount`)}if(parsed<0n)throw new Error(`${field} cannot be negative`);return parsed}

export function createSendIntent({networkId='fairyelf-public-testnet-v4',hrp='faet',from,to,amountAtomic,feeAtomic=0n,expiresAt=null}){
  if(!isValidAddress(from,hrp))throw new Error('Invalid sender address');
  if(!isValidAddress(to,hrp))throw new Error('Invalid destination address');
  const amount=normalizeAtomic(amountAtomic,'amountAtomic'),fee=normalizeAtomic(feeAtomic,'feeAtomic');
  if(amount<=0n)throw new Error('amountAtomic must be positive');
  const body={kind:SEND_INTENT_KIND,version:1,network:networkId,from,to,amountAtomic:amount.toString(),feeAtomic:fee.toString(),...(expiresAt?{expiresAt}:{})};
  return {...body,intentId:hashHex(body)};
}

export function validateSendIntent(intent,{networkId='fairyelf-public-testnet-v4',hrp='faet',expectedFrom=null,now=Date.now()}={}){
  if(!intent||intent.kind!==SEND_INTENT_KIND||intent.version!==1)throw new Error('Malformed send intent');
  if(intent.network!==networkId)throw new Error('Send intent is for a different network');
  if(!isValidAddress(intent.from,hrp)||!isValidAddress(intent.to,hrp))throw new Error('Send intent contains an invalid address');
  if(expectedFrom&&intent.from!==expectedFrom)throw new Error('Send intent sender does not match wallet');
  const amount=normalizeAtomic(intent.amountAtomic,'amountAtomic'),fee=normalizeAtomic(intent.feeAtomic,'feeAtomic');
  if(amount<=0n)throw new Error('Send intent amount must be positive');
  if(intent.expiresAt){const expiry=Date.parse(intent.expiresAt);if(!Number.isFinite(expiry)||expiry<=now)throw new Error('Send intent is expired or has an invalid expiry')}
  const {intentId,...body}=intent; if(intentId!==hashHex(body))throw new Error('Send intent integrity check failed');
  return {amount,fee};
}
