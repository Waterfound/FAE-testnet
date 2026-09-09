import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';
import {generateNodeIdentity,signEnvelope} from '../sovereign-forge/node/authoritative/node-identity.mjs';
import {createCoordinatorRotationCertificate} from '../sovereign-forge/node/authoritative/coordinator-rotation.mjs';

const NETWORK='fairyelf-public-testnet-v4',BASE='https://coordinator.example';
const A=generateNodeIdentity(),B=generateNodeIdentity(),C=generateNodeIdentity();
const sharedStorage=new Map();
const trustSource=await readFile(new URL('../coordinator-trust.js',import.meta.url),'utf8');

function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));return value}
function stable(value){return JSON.stringify(canonical(value))}
function normalizeCoordinatorUrl(value){try{const url=new URL(String(value));if(url.username||url.password)return null;const local=url.hostname==='localhost'||url.hostname==='127.0.0.1'||url.hostname==='[::1]';if(url.protocol!=='https:'&&!(url.protocol==='http:'&&local))return null;url.hash='';url.search='';url.pathname=url.pathname.replace(/\/$/,'');return url.toString().replace(/\/$/,'')}catch{return null}}
function descriptor(identity){const issuedAt=new Date().toISOString();return signEnvelope(identity,'coordinator-descriptor',{descriptorVersion:1,type:'fairyelf-share-coordinator',coordinatorId:identity.id,network:NETWORK,endpoint:BASE,mode:'pplns-direct-pay',windowSize:2048,shareDifficultyDelta:6,upstreamNodeIdentity:null,issuedAt,validUntil:new Date(Date.now()+15*60_000).toISOString()})}
function makeSession(identity,rotationChain=[]){
  const calls={descriptor:0,work:0},localStorage={getItem:key=>sharedStorage.get(key)??null,setItem:(key,value)=>sharedStorage.set(key,String(value)),removeItem:key=>sharedStorage.delete(key)};
  const context={window:null,localStorage,crypto:webcrypto,TextEncoder,Uint8Array,URL,Date,JSON,Object,Array,Number,String,Map,Set,Promise,Error,structuredClone,NETWORK,E:new TextEncoder(),stable,normalizeCoordinatorUrl,coordinatorIdentityByBase:new Map(),
    protocolError(message,code='COORDINATOR_PROTOCOL'){const error=new Error(message);error.code=code;return error},
    bytesHex(bytes){return[...new Uint8Array(bytes)].map(byte=>byte.toString(16).padStart(2,'0')).join('')},
    async sh(bytes){return new Uint8Array(await webcrypto.subtle.digest('SHA-256',bytes))},
    fb(value){return Uint8Array.from(Buffer.from(String(value),'base64'))},
    async coordinatorApi(base,path){assert.equal(base,BASE);if(path==='/descriptor'){calls.descriptor++;return{ok:true,descriptor:descriptor(identity),rotation_chain:structuredClone(rotationChain)}}if(path==='/work'){calls.work++;return{ok:true,coordinatorId:identity.id,workProof:{signer:{id:identity.id,publicKey:identity.publicKeyBase64}}}}throw new Error('unexpected path '+path)}
  };
  context.window=context;vm.createContext(context);vm.runInContext(trustSource,context,{filename:'coordinator-trust.js'});return{context,calls};
}
async function expectTrustFailure(session,pattern){let error=null;try{await session.context.coordinatorApi(BASE,'/work')}catch(caught){error=caught}assert.equal(error?.code,'COORDINATOR_TRUST');assert.match(error?.message||'',pattern);assert.equal(session.calls.work,0);return error}
function pin(){return JSON.parse(sharedStorage.get('fae-coordinator-trust-v1'))[BASE]}

// First contact stays ordinary TOFU and creates sequence zero.
const first=makeSession(A);assert.equal((await first.context.coordinatorApi(BASE,'/work')).coordinatorId,A.id);assert.equal(first.calls.work,1);assert.equal(pin().coordinatorId,A.id);assert.equal(pin().rotationSequence,0);const pinA=sharedStorage.get('fae-coordinator-trust-v1');

// Silent replacement remains forbidden.
await expectTrustFailure(makeSession(B),/without a bounded rotation chain/i);assert.equal(pin().coordinatorId,A.id);

// A pre-authorizes B with a durable cryptographic certificate.
const certAB=createCoordinatorRotationCertificate({oldIdentity:A,newPublicKey:B.publicKeyBase64,networkId:NETWORK,endpoint:BASE,sequence:1,reason:'planned coordinator key rotation A to B'});
const rotatedB=makeSession(B,[certAB]);assert.equal((await rotatedB.context.coordinatorApi(BASE,'/work')).coordinatorId,B.id);assert.equal(pin().coordinatorId,B.id);assert.equal(pin().publicKey,B.publicKeyBase64);assert.equal(pin().rotationSequence,1);assert.equal(pin().rotations.length,1);

// Replaying A->B cannot roll a client already on B back to A.
await expectTrustFailure(makeSession(A,[certAB]),/no new authorization/i);assert.equal(pin().coordinatorId,B.id);

// B can authorize C with the next exact sequence.
const certBC=createCoordinatorRotationCertificate({oldIdentity:B,newPublicKey:C.publicKeyBase64,networkId:NETWORK,endpoint:BASE,sequence:2,reason:'planned coordinator key rotation B to C'});
const rotatedC=makeSession(C,[certAB,certBC]);assert.equal((await rotatedC.context.coordinatorApi(BASE,'/work')).coordinatorId,C.id);assert.equal(pin().coordinatorId,C.id);assert.equal(pin().rotationSequence,2);assert.equal(pin().rotations.length,2);const pinC=sharedStorage.get('fae-coordinator-trust-v1');

// A browser absent since A can verify the entire A->B->C history without trusting an intermediary source.
sharedStorage.set('fae-coordinator-trust-v1',pinA);const offlineToC=makeSession(C,[certAB,certBC]);assert.equal((await offlineToC.context.coordinatorApi(BASE,'/work')).coordinatorId,C.id);assert.equal(pin().rotationSequence,2);

// Sequence gaps are rejected even when signed by the correct old identity.
sharedStorage.set('fae-coordinator-trust-v1',pinA);const gap=createCoordinatorRotationCertificate({oldIdentity:A,newPublicKey:B.publicKeyBase64,networkId:NETWORK,endpoint:BASE,sequence:2,reason:'invalid sequence gap attack certificate'});await expectTrustFailure(makeSession(B,[gap]),/sequence mismatch/i);

// Reordered chains cannot manufacture continuity.
sharedStorage.set('fae-coordinator-trust-v1',pinA);await expectTrustFailure(makeSession(C,[certBC,certAB]),/currently trusted identity|sequence mismatch/i);

// Endpoint-bound certificates cannot be replayed on the canonical endpoint.
const wrongEndpoint=createCoordinatorRotationCertificate({oldIdentity:A,newPublicKey:B.publicKeyBase64,networkId:NETWORK,endpoint:'https://other-coordinator.example',sequence:1,reason:'wrong endpoint rotation attack certificate'});sharedStorage.set('fae-coordinator-trust-v1',pinA);await expectTrustFailure(makeSession(B,[wrongEndpoint]),/endpoint mismatch/i);

// A certificate cannot become effective before its declared time.
const future=createCoordinatorRotationCertificate({oldIdentity:A,newPublicKey:B.publicKeyBase64,networkId:NETWORK,endpoint:BASE,sequence:1,effectiveAt:new Date(Date.now()+60*60_000).toISOString(),reason:'future effective rotation authorization test'});sharedStorage.set('fae-coordinator-trust-v1',pinA);await expectTrustFailure(makeSession(B,[future]),/not yet effective/i);

// A client already at C cannot be rolled back to B with the historical full chain.
sharedStorage.set('fae-coordinator-trust-v1',pinC);await expectTrustFailure(makeSession(B,[certAB,certBC]),/no new authorization/i);assert.equal(pin().coordinatorId,C.id);

console.log('FAE coordinator cryptographic A->B->C rotation, offline catch-up, sequence, endpoint, future-time and rollback/replay attacks passed.');
