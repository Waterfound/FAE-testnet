import {identityIdFromPublicKey,signEnvelope,verifyEnvelope} from './node-identity.mjs';

export const COORDINATOR_ROTATION_KIND='coordinator-rotation';
export const COORDINATOR_ROTATION_VERSION=1;
export const MAX_ROTATION_CHAIN=32;

function normalizeEndpoint(value){
  const url=new URL(String(value));
  if(url.protocol!=='http:'&&url.protocol!=='https:')throw new Error('Coordinator rotation endpoint must use HTTP(S)');
  if(url.username||url.password)throw new Error('Coordinator rotation endpoint cannot contain credentials');
  url.hash='';url.search='';url.pathname=url.pathname.replace(/\/$/,'');
  return url.toString().replace(/\/$/,'');
}
function validId(value){return /^[0-9a-f]{64}$/.test(String(value??''))}
function validSequence(value){return Number.isSafeInteger(Number(value))&&Number(value)>=1}

export function createCoordinatorRotationCertificate({oldIdentity,newPublicKey,networkId,endpoint,sequence,effectiveAt=new Date().toISOString(),reason='planned coordinator identity rotation'}={}){
  if(!oldIdentity?.id||!oldIdentity?.privateKeyPem||!oldIdentity?.publicKeyBase64)throw new Error('Old coordinator identity with private key is required');
  const toPublicKey=String(newPublicKey??'');if(!toPublicKey)throw new Error('New coordinator public key is required');
  const toCoordinatorId=identityIdFromPublicKey(toPublicKey);if(!validId(toCoordinatorId)||toCoordinatorId===oldIdentity.id)throw new Error('Rotation requires a distinct valid new coordinator identity');
  if(typeof networkId!=='string'||!networkId)throw new Error('Coordinator rotation network is required');
  const canonicalEndpoint=normalizeEndpoint(endpoint);
  if(!validSequence(sequence))throw new Error('Coordinator rotation sequence must be a positive safe integer');
  const effective=Date.parse(effectiveAt);if(!Number.isFinite(effective))throw new Error('Coordinator rotation effective time is invalid');
  if(typeof reason!=='string'||reason.trim().length<8||reason.trim().length>256)throw new Error('Coordinator rotation requires a meaningful bounded reason');
  return signEnvelope(oldIdentity,COORDINATOR_ROTATION_KIND,{rotationVersion:COORDINATOR_ROTATION_VERSION,network:networkId,endpoint:canonicalEndpoint,sequence:Number(sequence),fromCoordinatorId:oldIdentity.id,toCoordinatorId,toPublicKey,effectiveAt:new Date(effective).toISOString(),reason:reason.trim()});
}

export function verifyCoordinatorRotationCertificate(certificate,{expectedFromId=null,expectedFromPublicKey=null,networkId,endpoint,expectedSequence=null,now=Date.now()}={}){
  if(!certificate||certificate.kind!==COORDINATOR_ROTATION_KIND)throw new Error('Invalid coordinator rotation certificate');
  const payload=verifyEnvelope(certificate,{kind:COORDINATOR_ROTATION_KIND,expectedSignerId:expectedFromId,maxAgeMs:Infinity});
  if(payload?.rotationVersion!==COORDINATOR_ROTATION_VERSION)throw new Error('Unsupported coordinator rotation certificate version');
  if(expectedFromPublicKey&&certificate.signer.publicKey!==expectedFromPublicKey)throw new Error('Coordinator rotation old public key mismatch');
  if(payload.fromCoordinatorId!==certificate.signer.id)throw new Error('Coordinator rotation signer/from mismatch');
  if(!validId(payload.fromCoordinatorId)||!validId(payload.toCoordinatorId)||payload.fromCoordinatorId===payload.toCoordinatorId)throw new Error('Coordinator rotation identity fields are invalid');
  if(identityIdFromPublicKey(payload.toPublicKey)!==payload.toCoordinatorId)throw new Error('Coordinator rotation new id/public-key mismatch');
  if(payload.network!==networkId)throw new Error('Coordinator rotation network mismatch');
  if(normalizeEndpoint(payload.endpoint)!==normalizeEndpoint(endpoint))throw new Error('Coordinator rotation endpoint mismatch');
  if(!validSequence(payload.sequence))throw new Error('Coordinator rotation sequence is invalid');
  if(expectedSequence!=null&&Number(payload.sequence)!==Number(expectedSequence))throw new Error('Coordinator rotation sequence mismatch');
  const effective=Date.parse(payload.effectiveAt);if(!Number.isFinite(effective)||effective>Number(now)+60_000)throw new Error('Coordinator rotation is not yet effective');
  return{...payload,signerPublicKey:certificate.signer.publicKey,certificate};
}

export function verifyCoordinatorRotationChain(chain,{fromCoordinatorId,fromPublicKey,networkId,endpoint,startSequence=0,targetCoordinatorId=null,targetPublicKey=null,now=Date.now()}={}){
  if(!Array.isArray(chain)||chain.length<1||chain.length>MAX_ROTATION_CHAIN)throw new Error('Coordinator rotation chain length is invalid');
  if(!validId(fromCoordinatorId)||typeof fromPublicKey!=='string'||!fromPublicKey)throw new Error('Coordinator rotation chain requires a trusted starting identity');
  if(identityIdFromPublicKey(fromPublicKey)!==fromCoordinatorId)throw new Error('Coordinator rotation starting id/public-key mismatch');
  let currentId=fromCoordinatorId,currentPublicKey=fromPublicKey,sequence=Number(startSequence)||0;
  const verified=[];
  for(const certificate of chain){
    const item=verifyCoordinatorRotationCertificate(certificate,{expectedFromId:currentId,expectedFromPublicKey:currentPublicKey,networkId,endpoint,expectedSequence:sequence+1,now});
    verified.push(item);currentId=item.toCoordinatorId;currentPublicKey=item.toPublicKey;sequence=item.sequence;
  }
  if(targetCoordinatorId&&currentId!==targetCoordinatorId)throw new Error('Coordinator rotation chain does not reach descriptor identity');
  if(targetPublicKey&&currentPublicKey!==targetPublicKey)throw new Error('Coordinator rotation chain does not reach descriptor public key');
  return{coordinatorId:currentId,publicKey:currentPublicKey,sequence,verified};
}
