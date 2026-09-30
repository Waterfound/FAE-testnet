#!/usr/bin/env node
'use strict';

import { createHash } from 'node:crypto';

export const NETWORK='fairyelf-public-testnet-v4';
export const HRP='faet';
export const CHARSET='qpzry9x8gf2tvdw0s3jn54khce6mua7l';
export const BECH32M_CONST=0x2bc830a3;
export const MAX_TARGET_BITS=64;
export const MAX_TEMPLATE_TXS=20;

export function canonical(value){
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object'){
    return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
  }
  return value;
}

export function stable(value){
  return JSON.stringify(canonical(value));
}

export function sha256(bytes){
  return createHash('sha256').update(bytes).digest();
}

export function doubleHashHex(value){
  const first=sha256(Buffer.from(stable(value)));
  return sha256(first).toString('hex');
}

export function leadingZeroBits(hash){
  if(typeof hash!=='string'||!/^[0-9a-f]{64}$/.test(hash))return-1;
  let count=0;
  for(const character of hash){
    const value=parseInt(character,16);
    if(value===0){count+=4;continue}
    if(value<2)count+=3;
    else if(value<4)count+=2;
    else if(value<8)count+=1;
    break;
  }
  return count;
}

function polymod(values){
  const generators=[0x3b6a57b2,0x26508e6d,0x1ea119fa,0x3d4233dd,0x2a1462b3];
  let checksum=1;
  for(const value of values){
    const top=checksum>>>25;
    checksum=((checksum&0x1ffffff)<<5)^value;
    for(let i=0;i<5;i++)if((top>>>i)&1)checksum^=generators[i];
  }
  return checksum>>>0;
}

function hrpExpand(hrp){
  return [...hrp].map(character=>character.charCodeAt(0)>>>5)
    .concat([0],[...hrp].map(character=>character.charCodeAt(0)&31));
}

function convertBits(data,fromBits,toBits,pad=true){
  let accumulator=0,bitCount=0;
  const result=[],mask=(1<<toBits)-1,maxAccumulator=(1<<(fromBits+toBits-1))-1;
  for(const value of data){
    if(value<0||(value>>>fromBits)!==0)throw Error('bit conversion');
    accumulator=((accumulator<<fromBits)|value)&maxAccumulator;
    bitCount+=fromBits;
    while(bitCount>=toBits){
      bitCount-=toBits;
      result.push((accumulator>>>bitCount)&mask);
    }
  }
  if(pad){
    if(bitCount)result.push((accumulator<<(toBits-bitCount))&mask);
  }else if(bitCount>=fromBits||((accumulator<<(toBits-bitCount))&mask)){
    throw Error('padding');
  }
  return result;
}

export function validAddress(address){
  try{
    if(typeof address!=='string'||address.length<8||address.length>90||address!==address.toLowerCase())return false;
    const separator=address.lastIndexOf('1');
    if(separator<1||address.slice(0,separator)!==HRP)return false;
    const values=[...address.slice(separator+1)].map(character=>CHARSET.indexOf(character));
    if(values.length<6||values.some(value=>value<0))return false;
    if(polymod([...hrpExpand(HRP),...values])!==BECH32M_CONST)return false;
    return convertBits(values.slice(0,-6),5,8,false).length===20;
  }catch{
    return false;
  }
}

export function validateTemplate(template,{address,network=NETWORK}={}){
  if(!template||typeof template!=='object'||template.ok===false)throw Error('INVALID_TEMPLATE');
  if(template.template_policy!==undefined&&template.template_policy!=='snapshot')throw Error('UNSUPPORTED_TEMPLATE_POLICY');
  const header=template.header;
  if(!header||typeof header!=='object')throw Error('INVALID_TEMPLATE_HEADER');
  if(header.network!==network)throw Error('TEMPLATE_NETWORK_MISMATCH');
  if(!validAddress(address)||header.miner_address!==address)throw Error('TEMPLATE_REWARD_ADDRESS_MISMATCH');
  if(!Number.isSafeInteger(Number(header.height))||Number(header.height)<1)throw Error('INVALID_TEMPLATE_HEIGHT');
  if(!/^[0-9a-f]{64}$/.test(String(header.previous_hash||'')))throw Error('INVALID_TEMPLATE_PREVIOUS_HASH');
  if(!Number.isSafeInteger(Number(header.timestamp_ms))||Number(header.timestamp_ms)<0)throw Error('INVALID_TEMPLATE_TIMESTAMP');
  const bits=Number(header.difficulty_bits);
  if(!Number.isInteger(bits)||bits<1||bits>MAX_TARGET_BITS)throw Error('INVALID_TEMPLATE_TARGET');
  if(!/^\d+$/.test(String(header.reward_atoms??'')))throw Error('INVALID_TEMPLATE_REWARD');
  const txids=Array.isArray(template.txids)?template.txids.map(String):null;
  if(!txids||txids.length>MAX_TEMPLATE_TXS||new Set(txids).size!==txids.length||txids.some(txid=>!/^[0-9a-f]{64}$/.test(txid)))throw Error('INVALID_TEMPLATE_TXIDS');
  if(Number(header.tx_count)!==txids.length)throw Error('TEMPLATE_TX_COUNT_MISMATCH');
  if(header.tx_root!==doubleHashHex(txids))throw Error('TEMPLATE_TX_ROOT_MISMATCH');
  return Object.freeze({header,txids,coinbase_outputs:Array.isArray(template.coinbase_outputs)?template.coinbase_outputs:undefined});
}

export function tipState(header,status){
  const parentHeight=Number(header?.height)-1;
  const parentHash=String(header?.previous_hash||'');
  const observedHeight=Number(status?.height);
  const observedHash=String(status?.tip_hash||'');
  if(!Number.isSafeInteger(parentHeight)||parentHeight<0||!/^[0-9a-f]{64}$/.test(parentHash))return'unknown';
  if(!Number.isSafeInteger(observedHeight)||observedHeight<0||!/^[0-9a-f]{64}$/.test(observedHash))return'unknown';
  if(observedHeight<parentHeight)return'unknown';
  if(observedHeight===parentHeight&&observedHash===parentHash)return'current';
  return'stale';
}

export function hashHeaderNonce(header,nonce){
  if(!Number.isSafeInteger(nonce)||nonce<0)throw Error('INVALID_NONCE');
  return doubleHashHex({...header,nonce});
}

export function workMeetsTarget(hash,targetBits){
  const bits=Number(targetBits);
  return Number.isInteger(bits)&&bits>=1&&bits<=MAX_TARGET_BITS&&leadingZeroBits(hash)>=bits;
}

export function mineChunk(header,{startNonce=0,maxHashes=2048}={}){
  if(!Number.isSafeInteger(startNonce)||startNonce<0)throw Error('INVALID_NONCE_START');
  if(!Number.isSafeInteger(maxHashes)||maxHashes<1||maxHashes>1_000_000)throw Error('INVALID_CHUNK_SIZE');
  const targetBits=Number(header?.difficulty_bits);
  if(!Number.isInteger(targetBits)||targetBits<1||targetBits>MAX_TARGET_BITS)throw Error('INVALID_TEMPLATE_TARGET');
  let nonce=startNonce;
  for(let attempts=1;attempts<=maxHashes;attempts++,nonce++){
    const hash=hashHeaderNonce(header,nonce);
    if(workMeetsTarget(hash,targetBits))return{found:true,nonce,hash,attempts,nextNonce:nonce+1};
  }
  return{found:false,attempts:maxHashes,nextNonce:startNonce+maxHashes};
}

export function buildSubmission(template,nonce,hash){
  const validated=validateTemplate(template,{address:template?.header?.miner_address});
  if(!Number.isSafeInteger(nonce)||nonce<0)throw Error('INVALID_NONCE');
  if(!/^[0-9a-f]{64}$/.test(String(hash||'')))throw Error('INVALID_WORK_HASH');
  const computed=hashHeaderNonce(validated.header,nonce);
  if(computed!==hash)throw Error('WORK_HASH_MISMATCH');
  if(!workMeetsTarget(hash,validated.header.difficulty_bits))throw Error('WORK_BELOW_TARGET');
  const submission={header:validated.header,nonce,hash,txids:validated.txids};
  if(validated.coinbase_outputs)submission.coinbase_outputs=validated.coinbase_outputs;
  return submission;
}
