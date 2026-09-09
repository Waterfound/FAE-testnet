import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';
import {generateNodeIdentity,signEnvelope} from '../sovereign-forge/node/authoritative/node-identity.mjs';

const NETWORK='fairyelf-public-testnet-v4';
const BASE='https://coordinator.example';
const identityA=generateNodeIdentity(),identityB=generateNodeIdentity();
const sharedStorage=new Map();

function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));return value}
function stable(value){return JSON.stringify(canonical(value))}
function normalizeCoordinatorUrl(value){try{const url=new URL(String(value));if(url.username||url.password)return null;const local=url.hostname==='localhost'||url.hostname==='127.0.0.1'||url.hostname==='[::1]';if(url.protocol!=='https:'&&!(url.protocol==='http:'&&local))return null;url.hash='';url.search='';url.pathname=url.pathname.replace(/\/$/,'');return url.toString().replace(/\/$/,'')}catch{return null}}
function descriptor(identity,{endpoint=BASE,validUntil=Date.now()+15*60_000}={}){const issuedAt=new Date().toISOString();return signEnvelope(identity,'coordinator-descriptor',{descriptorVersion:1,type:'fairyelf-share-coordinator',coordinatorId:identity.id,network:NETWORK,endpoint,mode:'pplns-direct-pay',windowSize:2048,shareDifficultyDelta:6,upstreamNodeIdentity:null,issuedAt,validUntil:new Date(validUntil).toISOString()})}
function work(identity){return{ok:true,coordinatorId:identity.id,workProof:{signer:{id:identity.id,publicKey:identity.publicKeyBase64}}}}

const trustSource=await readFile(new URL('../coordinator-trust.js',import.meta.url),'utf8');

function makeSession(identity,{descriptorEndpoint=BASE}={}){
  const calls={descriptor:0,work:0};
  const localStorage={getItem:key=>sharedStorage.get(key)??null,setItem:(key,value)=>sharedStorage.set(key,String(value)),removeItem:key=>sharedStorage.delete(key)};
  const context={
    window:null,localStorage,crypto:webcrypto,TextEncoder,Uint8Array,URL,Date,JSON,Object,Array,Number,String,Map,Set,Promise,Error,structuredClone,
    NETWORK,E:new TextEncoder(),stable,normalizeCoordinatorUrl,coordinatorIdentityByBase:new Map(),
    protocolError(message,code='COORDINATOR_PROTOCOL'){const error=new Error(message);error.code=code;return error},
    bytesHex(bytes){return[...new Uint8Array(bytes)].map(byte=>byte.toString(16).padStart(2,'0')).join('')},
    async sh(bytes){return new Uint8Array(await webcrypto.subtle.digest('SHA-256',bytes))},
    fb(value){return Uint8Array.from(Buffer.from(String(value),'base64'))},
    async coordinatorApi(base,path){
      assert.equal(base,BASE);
      if(path==='/descriptor'){calls.descriptor++;return{ok:true,descriptor:descriptor(identity,{endpoint:descriptorEndpoint})}}
      if(path==='/work'){calls.work++;return work(identity)}
      throw new Error('unexpected path '+path);
    }
  };
  context.window=context;vm.createContext(context);vm.runInContext(trustSource,context,{filename:'coordinator-trust.js'});return{context,calls};
}

// First contact pins identity A and allows work only after the signed descriptor verifies.
const first=makeSession(identityA);const firstWork=await first.context.coordinatorApi(BASE,'/work');assert.equal(firstWork.coordinatorId,identityA.id);assert.equal(first.calls.descriptor,1);assert.equal(first.calls.work,1);
const stored=JSON.parse(sharedStorage.get('fae-coordinator-trust-v1'));assert.equal(stored[BASE].coordinatorId,identityA.id);assert.equal(stored[BASE].publicKey,identityA.publicKeyBase64);assert.equal(stored[BASE].endpoint,BASE);

// A new browser session accepts the same cryptographic identity.
const reloadA=makeSession(identityA);const reloadedWork=await reloadA.context.coordinatorApi(BASE,'/work');assert.equal(reloadedWork.coordinatorId,identityA.id);assert.equal(reloadA.calls.work,1);

// A validly signed but different identity on the same endpoint is rejected before /work.
const swapped=makeSession(identityB);let swapError=null;try{await swapped.context.coordinatorApi(BASE,'/work')}catch(error){swapError=error}assert.equal(swapError?.code,'COORDINATOR_TRUST');assert.match(swapError?.message||'',/identity changed since first trusted contact/i);assert.equal(swapped.calls.descriptor,1);assert.equal(swapped.calls.work,0);
const afterSwap=JSON.parse(sharedStorage.get('fae-coordinator-trust-v1'));assert.equal(afterSwap[BASE].coordinatorId,identityA.id);

// Even the pinned identity cannot sign a descriptor for another endpoint and use it here.
const wrongEndpoint=makeSession(identityA,{descriptorEndpoint:'https://other-coordinator.example'});let endpointError=null;try{await wrongEndpoint.context.coordinatorApi(BASE,'/work')}catch(error){endpointError=error}assert.equal(endpointError?.code,'COORDINATOR_TRUST');assert.match(endpointError?.message||'',/endpoint mismatch/i);assert.equal(wrongEndpoint.calls.work,0);

// Corrupted persistent trust is fail-closed and never silently reset.
sharedStorage.set('fae-coordinator-trust-v1','{broken-json');const corrupt=makeSession(identityA);let corruptError=null;try{await corrupt.context.coordinatorApi(BASE,'/work')}catch(error){corruptError=error}assert.equal(corruptError?.code,'COORDINATOR_TRUST');assert.match(corruptError?.message||'',/trust store is malformed/i);assert.equal(corrupt.calls.work,0);assert.equal(sharedStorage.get('fae-coordinator-trust-v1'),'{broken-json');

console.log('FAE coordinator descriptor signature, persistent TOFU continuity, endpoint binding and fail-closed trust-store checks passed.');
