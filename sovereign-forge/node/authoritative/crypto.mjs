import {createHash,createPrivateKey,createPublicKey,sign as nodeSign,verify as nodeVerify} from 'node:crypto';
import {stableStringify} from './canonical.mjs';

export function sha256(data){return createHash('sha256').update(data).digest()}

function publicKeyObject(publicKey){
  if(Buffer.isBuffer(publicKey))return createPublicKey({key:publicKey,format:'der',type:'spki'});
  if(typeof publicKey==='string'&&publicKey.includes('BEGIN PUBLIC KEY'))return createPublicKey(publicKey);
  if(typeof publicKey==='string')return createPublicKey({key:Buffer.from(publicKey,'base64'),format:'der',type:'spki'});
  return createPublicKey(publicKey);
}

export function publicKeyToBase64(publicKey){return publicKeyObject(publicKey).export({type:'spki',format:'der'}).toString('base64')}

export function signPayload(privateKeyPem,payload){
  return nodeSign(null,Buffer.from(stableStringify(payload)),createPrivateKey(privateKeyPem)).toString('base64');
}

export function verifyPayload(publicKey,payload,signature){
  try{return nodeVerify(null,Buffer.from(stableStringify(payload)),publicKeyObject(publicKey),Buffer.from(signature,'base64'))}
  catch{return false}
}
