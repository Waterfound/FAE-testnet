import {chmodSync,existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {generateKeyPairSync} from 'node:crypto';
import {publicKeyToBase64,sha256,signPayload,verifyPayload} from './crypto.mjs';

export const AUTH_DOMAIN='FAIRYELF_AUTH_V1';
const DEFAULT_MAX_AGE_MS=5*60_000;

export function identityIdFromPublicKey(publicKeyBase64){return sha256(Buffer.from(publicKeyBase64,'base64')).toString('hex')}

export function generateNodeIdentity(){
  const {privateKey,publicKey}=generateKeyPairSync('ed25519');
  const privateKeyPem=privateKey.export({type:'pkcs8',format:'pem'});
  const publicKeyPem=publicKey.export({type:'spki',format:'pem'});
  const publicKeyBase64=publicKeyToBase64(publicKeyPem);
  return {format:1,algorithm:'ed25519',id:identityIdFromPublicKey(publicKeyBase64),privateKeyPem,publicKeyPem,publicKeyBase64};
}

export function saveNodeIdentity(path,identity){
  mkdirSync(dirname(path),{recursive:true});
  writeFileSync(path,`${JSON.stringify(identity,null,2)}\n`,{mode:0o600,flag:'wx'});
  chmodSync(path,0o600);
  return identity;
}

export function loadNodeIdentity(path){
  const parsed=JSON.parse(readFileSync(path,'utf8'));
  if(parsed.format!==1||parsed.algorithm!=='ed25519'||!parsed.privateKeyPem||!parsed.publicKeyBase64)throw new Error('Malformed Fairyelf node identity');
  const expectedId=identityIdFromPublicKey(parsed.publicKeyBase64);
  if(parsed.id!==expectedId)throw new Error('Node identity id/public-key mismatch');
  return parsed;
}

export function loadOrCreateNodeIdentity(path=null){
  if(!path)return generateNodeIdentity();
  if(existsSync(path))return loadNodeIdentity(path);
  return saveNodeIdentity(path,generateNodeIdentity());
}

export function signEnvelope(identity,kind,payload){
  const issuedAt=new Date().toISOString();
  const signed={domain:AUTH_DOMAIN,version:1,kind,signer:{id:identity.id,publicKey:identity.publicKeyBase64},issuedAt,payload};
  return {...signed,signature:signPayload(identity.privateKeyPem,signed)};
}

export function verifyEnvelope(envelope,{kind=null,expectedSignerId=null,maxAgeMs=DEFAULT_MAX_AGE_MS,allowFutureMs=60_000}={}){
  if(!envelope||envelope.domain!==AUTH_DOMAIN||envelope.version!==1)throw new Error('Invalid signed envelope');
  if(kind&&envelope.kind!==kind)throw new Error('Unexpected signed-envelope kind');
  if(!envelope.signer?.id||!envelope.signer?.publicKey||!envelope.signature)throw new Error('Incomplete signed envelope');
  if(identityIdFromPublicKey(envelope.signer.publicKey)!==envelope.signer.id)throw new Error('Envelope signer id mismatch');
  if(expectedSignerId&&envelope.signer.id!==expectedSignerId)throw new Error('Signed response came from a different peer identity');
  const issued=Date.parse(envelope.issuedAt);
  if(!Number.isFinite(issued))throw new Error('Invalid envelope time');
  const age=Date.now()-issued;
  if(age>maxAgeMs)throw new Error('Signed envelope is stale');
  if(age<-allowFutureMs)throw new Error('Signed envelope is too far in the future');
  const {signature,...signed}=envelope;
  if(!verifyPayload(envelope.signer.publicKey,signed,signature))throw new Error('Invalid signed-envelope signature');
  return envelope.payload;
}
