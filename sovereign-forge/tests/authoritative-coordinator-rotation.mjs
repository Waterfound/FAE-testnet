import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateNodeIdentity,saveNodeIdentity} from '../node/authoritative/node-identity.mjs';
import {createCoordinatorRotationCertificate,verifyCoordinatorRotationCertificate,verifyCoordinatorRotationChain} from '../node/authoritative/coordinator-rotation.mjs';
import {CANDIDATE_FUNCTION_PATH} from '../node/authoritative/pplns-http-adapter.mjs';
import {createShareCoordinatorRuntime} from '../node/fae-share-coordinator-v1-candidate.mjs';

const NETWORK='fairyelf-public-testnet-v4',ENDPOINT='https://coordinator.example',CANDIDATE='https://backend.example'+CANDIDATE_FUNCTION_PATH;

function identities(){return[generateNodeIdentity(),generateNodeIdentity(),generateNodeIdentity()]}

test('coordinator rotation chain is old-key authorized, endpoint/network bound and strictly monotonic',()=>{
  const[A,B,C]=identities(),ab=createCoordinatorRotationCertificate({oldIdentity:A,newPublicKey:B.publicKeyBase64,networkId:NETWORK,endpoint:ENDPOINT,sequence:1,reason:'planned rotation from coordinator A to B'}),bc=createCoordinatorRotationCertificate({oldIdentity:B,newPublicKey:C.publicKeyBase64,networkId:NETWORK,endpoint:ENDPOINT,sequence:2,reason:'planned rotation from coordinator B to C'});
  const one=verifyCoordinatorRotationCertificate(ab,{expectedFromId:A.id,expectedFromPublicKey:A.publicKeyBase64,networkId:NETWORK,endpoint:ENDPOINT,expectedSequence:1});assert.equal(one.toCoordinatorId,B.id);assert.equal(one.toPublicKey,B.publicKeyBase64);
  const chain=verifyCoordinatorRotationChain([ab,bc],{fromCoordinatorId:A.id,fromPublicKey:A.publicKeyBase64,networkId:NETWORK,endpoint:ENDPOINT,startSequence:0,targetCoordinatorId:C.id,targetPublicKey:C.publicKeyBase64});assert.equal(chain.coordinatorId,C.id);assert.equal(chain.sequence,2);assert.equal(chain.verified.length,2);

  const tampered=structuredClone(ab);tampered.payload.reason='tampered after signing';assert.throws(()=>verifyCoordinatorRotationChain([tampered],{fromCoordinatorId:A.id,fromPublicKey:A.publicKeyBase64,networkId:NETWORK,endpoint:ENDPOINT,startSequence:0}),/signature/i);
  const gap=createCoordinatorRotationCertificate({oldIdentity:A,newPublicKey:B.publicKeyBase64,networkId:NETWORK,endpoint:ENDPOINT,sequence:2,reason:'sequence gap attack should fail validation'});assert.throws(()=>verifyCoordinatorRotationChain([gap],{fromCoordinatorId:A.id,fromPublicKey:A.publicKeyBase64,networkId:NETWORK,endpoint:ENDPOINT,startSequence:0}),/sequence mismatch/i);
  assert.throws(()=>verifyCoordinatorRotationChain([bc,ab],{fromCoordinatorId:A.id,fromPublicKey:A.publicKeyBase64,networkId:NETWORK,endpoint:ENDPOINT,startSequence:0}),/different peer identity|old public key|sequence/i);
  assert.throws(()=>verifyCoordinatorRotationChain([ab],{fromCoordinatorId:A.id,fromPublicKey:A.publicKeyBase64,networkId:NETWORK,endpoint:'https://other.example',startSequence:0}),/endpoint mismatch/i);
  assert.throws(()=>verifyCoordinatorRotationChain([ab],{fromCoordinatorId:A.id,fromPublicKey:A.publicKeyBase64,networkId:'other-network',endpoint:ENDPOINT,startSequence:0}),/network mismatch/i);
  const future=createCoordinatorRotationCertificate({oldIdentity:A,newPublicKey:B.publicKeyBase64,networkId:NETWORK,endpoint:ENDPOINT,sequence:1,effectiveAt:new Date(Date.now()+60*60_000).toISOString(),reason:'future effective rotation should fail now'});assert.throws(()=>verifyCoordinatorRotationChain([future],{fromCoordinatorId:A.id,fromPublicKey:A.publicKeyBase64,networkId:NETWORK,endpoint:ENDPOINT,startSequence:0}),/not yet effective/i);
});

test('coordinator runtime publishes only a rotation chain that terminates at its current identity',async t=>{
  const[A,B,C]=identities(),ab=createCoordinatorRotationCertificate({oldIdentity:A,newPublicKey:B.publicKeyBase64,networkId:NETWORK,endpoint:ENDPOINT,sequence:1,reason:'runtime publication rotation A to B'}),bc=createCoordinatorRotationCertificate({oldIdentity:B,newPublicKey:C.publicKeyBase64,networkId:NETWORK,endpoint:ENDPOINT,sequence:2,reason:'runtime publication rotation B to C'}),dataDir=await mkdtemp(join(tmpdir(),'fae-rotation-runtime-'));t.after(()=>rm(dataDir,{recursive:true,force:true}));
  saveNodeIdentity(join(dataDir,'coordinator-identity.json'),C);
  const runtime=createShareCoordinatorRuntime({dataDir,candidateApiUrl:CANDIDATE,publicUrl:ENDPOINT,networkId:NETWORK,rotationChain:[ab,bc]});assert.equal(runtime.identity.id,C.id);assert.equal(runtime.rotationChain.length,2);assert.equal(runtime.rotationChain[0].signer.id,A.id);assert.equal(runtime.rotationChain[1].signer.id,B.id);
  assert.throws(()=>createShareCoordinatorRuntime({dataDir,candidateApiUrl:CANDIDATE,publicUrl:ENDPOINT,networkId:NETWORK,rotationChain:[ab]}),/does not reach descriptor identity/i);
  const wrongEndpoint=createCoordinatorRotationCertificate({oldIdentity:A,newPublicKey:B.publicKeyBase64,networkId:NETWORK,endpoint:'https://other.example',sequence:1,reason:'runtime wrong endpoint chain must fail'});assert.throws(()=>createShareCoordinatorRuntime({dataDir,candidateApiUrl:CANDIDATE,publicUrl:ENDPOINT,networkId:NETWORK,rotationChain:[wrongEndpoint]}),/endpoint mismatch|does not reach/i);
});
