import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, sign as edSign, webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

import { encodeAddress } from '../../../../sovereign-forge/node/authoritative/address.mjs';
import { normalizeTx, txPayload, verifyTxCrypto } from '../../../../sovereign-forge/node/authoritative/fae-v4-core.mjs';
import { stableStringify as activeStableStringify } from '../../../../sovereign-forge/node/authoritative/canonical.mjs';

import {
  MLDSA_SCHEMES,
  SHADOW_KIND,
  SHADOW_NETWORK,
  SHADOW_VERSION,
  signHybridTransaction,
  verifyHybridTransaction
} from '../../wave-e/pq05/hybrid-transaction.mjs';

import {
  PUBLIC_SCHEMA,
  deriveShadowKeyMaterial,
  parsePublicMetadata,
  recoverAgainstMetadata
} from '../../wave-e/pq06/shadow-wallet.mjs';

const cases=[];
const failures=[];

function record(id, category, expected, observed){
  const pass=Object.is(expected,observed);
  cases.push({id,category,expected,observed,pass});
  if(!pass) failures.push(id);
}
function b64(v){return Buffer.from(v).toString('base64')}
function clone(v){return structuredClone(v)}
function mutateBytesB64(value,{extend=false}={}){
  const b=Buffer.from(value,'base64');
  const out=extend?Buffer.concat([b,Buffer.from([0])]):b.subarray(0,Math.max(0,b.length-1));
  return out.toString('base64');
}
function flipB64(value){
  const b=Buffer.from(value,'base64');
  if(b.length) b[0]^=1;
  return b.toString('base64');
}
function sha256Hex(value){return createHash('sha256').update(value).digest('hex')}
function hybridAccept(obj){try{return verifyHybridTransaction(obj).ok===true}catch{return false}}
function activeAccept(obj){try{return verifyTxCrypto(obj).ok===true}catch{return false}}
function shadowWalletAccept(obj){try{parsePublicMetadata(obj);return true}catch{return false}}
function shadowRecoveryAccept(mnemonic,passphrase,metadata,wordList){
  try{recoverAgainstMetadata(mnemonic,passphrase,metadata,wordList);return true}catch{return false}
}

function makeActiveTx({privateKey,publicKeySpki,input,recipient,amount}){
  const tx={
    version:2,
    network:SHADOW_NETWORK,
    inputs:[input],
    outputs:[{address:recipient,amount_atoms:String(amount)}],
    public_key_spki:publicKeySpki,
    signature:''
  };
  const normalized=normalizeTx(tx);
  tx.signature=b64(edSign(null,Buffer.from(activeStableStringify(txPayload(normalized))),privateKey));
  assert.equal(activeAccept(tx),true,'active control must verify');
  return tx;
}

function makeHybridTx({parameterSet,edPrivate,edPublicSpki,mlKeys,input,recipient,amount}){
  const unsigned={
    kind:SHADOW_KIND,
    shadow_version:SHADOW_VERSION,
    network:SHADOW_NETWORK,
    inputs:[input],
    outputs:[{address:recipient,amount_atoms:String(amount)}],
    ed25519_public_key_spki:edPublicSpki,
    mldsa_parameter_set:parameterSet,
    mldsa_public_key:b64(mlKeys.publicKey)
  };
  const signed=signHybridTransaction(unsigned,edPrivate,mlKeys.secretKey);
  assert.equal(hybridAccept(signed),true,'hybrid control must verify');
  return signed;
}

// ---------------------------------------------------------------------------
// Transaction attacks. Every case is generated from ephemeral keys.
// ---------------------------------------------------------------------------
const parameterSets=Object.keys(MLDSA_SCHEMES);
const transactionFixtures={};
for(let s=0;s<parameterSets.length;s++){
  const parameterSet=parameterSets[s];
  const scheme=MLDSA_SCHEMES[parameterSet];
  const edA=generateKeyPairSync('ed25519');
  const edB=generateKeyPairSync('ed25519');
  const edASpki=edA.publicKey.export({format:'der',type:'spki'}).toString('base64');
  const edBSpki=edB.publicKey.export({format:'der',type:'spki'}).toString('base64');
  const mlA=scheme.keygen(randomBytes(scheme.lengths.seed));
  const mlB=scheme.keygen(randomBytes(scheme.lengths.seed));
  const recipient=encodeAddress(randomBytes(20),'faet');
  const inputA=(String(s+1).repeat(64)).slice(0,64)+':0';
  const inputB=(String(s+4).repeat(64)).slice(0,64)+':1';

  const hybridA=makeHybridTx({parameterSet,edPrivate:edA.privateKey,edPublicSpki:edASpki,mlKeys:mlA,input:inputA,recipient,amount:1000+s});
  const hybridB=makeHybridTx({parameterSet,edPrivate:edB.privateKey,edPublicSpki:edBSpki,mlKeys:mlB,input:inputB,recipient,amount:2000+s});
  const activeA=makeActiveTx({privateKey:edA.privateKey,publicKeySpki:edASpki,input:inputA,recipient,amount:1000+s});

  transactionFixtures[parameterSet]={scheme,edA,edB,edASpki,edBSpki,mlA,mlB,hybridA,hybridB,activeA,recipient,inputA};

  record(parameterSet+':valid-hybrid-control','transaction',true,hybridAccept(hybridA));
  record(parameterSet+':active-rejects-pure-hybrid','transaction',false,activeAccept(hybridA));
  record(parameterSet+':shadow-rejects-active-v2','transaction',false,hybridAccept(activeA));

  let x=clone(hybridA); delete x.ed25519_signature;
  record(parameterSet+':strip-ed25519-signature','transaction',false,hybridAccept(x));
  x=clone(hybridA); delete x.mldsa_signature;
  record(parameterSet+':strip-mldsa-signature','transaction',false,hybridAccept(x));
  x=clone(hybridA); x.ed25519_signature='';
  record(parameterSet+':blank-ed25519-signature','transaction',false,hybridAccept(x));
  x=clone(hybridA); x.mldsa_signature='';
  record(parameterSet+':blank-mldsa-signature','transaction',false,hybridAccept(x));

  x=clone(hybridA); x.ed25519_public_key_spki=edBSpki;
  record(parameterSet+':swap-ed25519-public-key','transaction',false,hybridAccept(x));
  x=clone(hybridA); x.mldsa_public_key=b64(mlB.publicKey);
  record(parameterSet+':swap-mldsa-public-key','transaction',false,hybridAccept(x));
  x=clone(hybridA); x.ed25519_signature=hybridB.ed25519_signature;
  record(parameterSet+':swap-ed25519-signature','transaction',false,hybridAccept(x));
  x=clone(hybridA); x.mldsa_signature=hybridB.mldsa_signature;
  record(parameterSet+':swap-mldsa-signature','transaction',false,hybridAccept(x));

  x=clone(hybridA); x.ed25519_signature=activeA.signature;
  record(parameterSet+':replay-v2-signature-into-hybrid','transaction',false,hybridAccept(x));
  x=clone(activeA); x.signature=hybridA.ed25519_signature;
  record(parameterSet+':replay-hybrid-signature-into-v2','transaction',false,activeAccept(x));

  x=clone(hybridA); x.kind='FAE_PQ_HYBRID_TX_V0';
  record(parameterSet+':wrong-kind','transaction',false,hybridAccept(x));
  x=clone(hybridA); x.shadow_version=2;
  record(parameterSet+':wrong-shadow-version','transaction',false,hybridAccept(x));
  x=clone(hybridA); x.network='fairyelf-other-network';
  record(parameterSet+':wrong-network','transaction',false,hybridAccept(x));

  x=clone(hybridA); x.ed25519_public_key_spki='%%%';
  record(parameterSet+':malformed-ed25519-public-key-base64','transaction',false,hybridAccept(x));
  x=clone(hybridA); x.mldsa_public_key='%%%';
  record(parameterSet+':malformed-mldsa-public-key-base64','transaction',false,hybridAccept(x));
  x=clone(hybridA); x.ed25519_signature='%%%';
  record(parameterSet+':malformed-ed25519-signature-base64','transaction',false,hybridAccept(x));
  x=clone(hybridA); x.mldsa_signature='%%%';
  record(parameterSet+':malformed-mldsa-signature-base64','transaction',false,hybridAccept(x));

  x=clone(hybridA); x.ed25519_signature=hybridA.ed25519_signature.replace(/=+$/,'');
  record(parameterSet+':noncanonical-ed25519-base64','transaction',false,hybridAccept(x));
  x=clone(hybridA); x.mldsa_signature=hybridA.mldsa_signature.replace(/=+$/,'');
  record(parameterSet+':noncanonical-mldsa-base64','transaction',false,hybridAccept(x));

  x=clone(hybridA); x.ed25519_signature=mutateBytesB64(hybridA.ed25519_signature);
  record(parameterSet+':truncated-ed25519-signature','transaction',false,hybridAccept(x));
  x=clone(hybridA); x.ed25519_signature=mutateBytesB64(hybridA.ed25519_signature,{extend:true});
  record(parameterSet+':extended-ed25519-signature','transaction',false,hybridAccept(x));
  x=clone(hybridA); x.mldsa_signature=mutateBytesB64(hybridA.mldsa_signature);
  record(parameterSet+':truncated-mldsa-signature','transaction',false,hybridAccept(x));
  x=clone(hybridA); x.mldsa_signature=mutateBytesB64(hybridA.mldsa_signature,{extend:true});
  record(parameterSet+':extended-mldsa-signature','transaction',false,hybridAccept(x));
  x=clone(hybridA); x.mldsa_public_key=mutateBytesB64(hybridA.mldsa_public_key);
  record(parameterSet+':truncated-mldsa-public-key','transaction',false,hybridAccept(x));

  x=clone(hybridA); delete x.outputs;
  record(parameterSet+':partial-hybrid-object','transaction',false,hybridAccept(x));

  // A deliberately dual-shaped object: complete active-v2 view plus complete
  // hybrid view. PQ-07 requires that this can never be accepted by both parsers.
  const polyglot={...hybridA,version:2,public_key_spki:activeA.public_key_spki,signature:activeA.signature};
  const polyHybrid=hybridAccept(polyglot);
  const polyActive=activeAccept(polyglot);
  record(parameterSet+':polyglot-active-control','transaction',true,polyActive);
  record(parameterSet+':polyglot-dual-acceptance','transaction',false,polyHybrid&&polyActive);
}

// Cross-parameter substitutions use exact valid material from another ML-DSA set.
for(let i=0;i<parameterSets.length;i++){
  const a=parameterSets[i];
  const b=parameterSets[(i+1)%parameterSets.length];
  const source=transactionFixtures[a].hybridA;
  const donor=transactionFixtures[b].hybridA;
  let x=clone(source);
  x.mldsa_parameter_set=b;
  x.mldsa_public_key=donor.mldsa_public_key;
  record(a+':cross-parameter-public-key-substitution-to-'+b,'transaction',false,hybridAccept(x));
  x=clone(source);
  x.mldsa_parameter_set=b;
  x.mldsa_public_key=donor.mldsa_public_key;
  x.mldsa_signature=donor.mldsa_signature;
  record(a+':cross-parameter-signature-substitution-to-'+b,'transaction',false,hybridAccept(x));
}

// ---------------------------------------------------------------------------
// Wallet attacks. Active wallet code is loaded read-only in a VM.
// ---------------------------------------------------------------------------
const elements=new Map();
function fakeElement(){return{hidden:false,tabIndex:0,addEventListener(){},setAttribute(){},classList:{add(){},remove(){},toggle(){}}}}
const context={
  crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,Array,Map,BigInt,Error,String,Number,Object,JSON,atob,btoa,console,
  localStorage:{setItem(){},getItem(){return null}},
  document:{getElementById(id){if(!elements.has(id))elements.set(id,fakeElement());return elements.get(id)}}
};
context.window=context;
vm.createContext(context);
for(const file of ['bip39-en.js','core.js','wallet-crypto.js']){
  vm.runInContext(await readFile(new URL('../../../../'+file,import.meta.url),'utf8'),context,{filename:file});
}
const activeWallet=context.FAEWalletCrypto;
const wordList=Array.from(context.FAE_BIP39_WORDS);
const entropy=Uint8Array.from(randomBytes(32));
const mnemonic=await activeWallet.mnemonicFromEntropy(entropy);
const passphrase=randomBytes(16).toString('hex');
const activeRecords=await activeWallet.deriveAddressRecords(mnemonic,passphrase,3);
const shadow=deriveShadowKeyMaterial(mnemonic,passphrase,'ML-DSA-65',1,wordList);
const meta=shadow.publicMetadata;

record('wallet:valid-shadow-metadata','wallet',true,shadowWalletAccept(meta));
record('wallet:valid-shadow-recovery','wallet',true,shadowRecoveryAccept(mnemonic,passphrase,meta,wordList));

let w={
  schema:PUBLIC_SCHEMA,index:1,mldsa_parameter_set:'ML-DSA-65',
  legacy_address:meta.legacy_address,legacy_public_key_spki:meta.legacy_public_key_spki
};
record('wallet:legacy-only-presented-as-upgraded','wallet',false,shadowWalletAccept(w));

w=clone(meta); delete w.mldsa_public_key;
record('wallet:missing-pq-public-key','wallet',false,shadowWalletAccept(w));
w=clone(meta); delete w.mldsa_public_key_sha256;
record('wallet:missing-pq-fingerprint','wallet',false,shadowWalletAccept(w));

w=clone(meta); w.mldsa_parameter_set='ML-DSA-UNKNOWN';
record('wallet:unknown-parameter-set','wallet',false,shadowWalletAccept(w));

w=clone(meta); w.index=2;
record('wallet:changed-index-recovery','wallet',false,shadowRecoveryAccept(mnemonic,passphrase,w,wordList));

w=clone(meta); w.legacy_address=activeRecords.addresses[2].address;
record('wallet:changed-legacy-address-recovery','wallet',false,shadowRecoveryAccept(mnemonic,passphrase,w,wordList));

w=clone(meta); w.legacy_public_key_spki=activeRecords.addresses[2].pub;
record('wallet:changed-legacy-public-key-recovery','wallet',false,shadowRecoveryAccept(mnemonic,passphrase,w,wordList));

w=clone(meta);
w.mldsa_public_key=flipB64(w.mldsa_public_key);
w.mldsa_public_key_sha256=sha256Hex(Buffer.from(w.mldsa_public_key,'base64'));
record('wallet:changed-pq-key-with-recomputed-fingerprint','wallet',false,shadowRecoveryAccept(mnemonic,passphrase,w,wordList));

w=clone(meta); w.mldsa_public_key_sha256='00'.repeat(32);
record('wallet:changed-pq-fingerprint','wallet',false,shadowWalletAccept(w));

record('wallet:wrong-passphrase','wallet',false,shadowRecoveryAccept(mnemonic,passphrase+'-wrong',meta,wordList));
record('wallet:corrupted-mnemonic','wallet',false,shadowRecoveryAccept('notaword '+mnemonic.split(/\s+/).slice(1).join(' '),passphrase,meta,wordList));

w=clone(meta); w.schema='FAE_PQ_SHADOW_WALLET_PUBLIC_V0';
record('wallet:unknown-migration-schema','wallet',false,shadowWalletAccept(w));

w=clone(meta); w.unexpected_field='polyglot-probe';
record('wallet:unexpected-extra-field','wallet',false,shadowWalletAccept(w));

w=clone(meta); delete w.mldsa_public_key; delete w.mldsa_public_key_sha256;
record('wallet:pq-fields-stripped-downgrade','wallet',false,shadowWalletAccept(w));

// Wallet polyglot: valid public PQ metadata plus an ephemeral legacy JWK.
// No secret bytes are ever printed or written to the evidence document.
const legacyJwk=activeRecords.addresses[1].jwk;
const walletPolyglot={...meta,...legacyJwk};
const polyShadowWallet=shadowWalletAccept(walletPolyglot);
let polyLegacyWallet=false;
try{
  await activeWallet.restoreRecordFromJwk(
    walletPolyglot,
    meta.legacy_address,
    meta.legacy_public_key_spki,
    meta.index
  );
  polyLegacyWallet=true;
}catch{}
record('wallet:polyglot-legacy-control','wallet',true,polyLegacyWallet);
record('wallet:polyglot-dual-acceptance','wallet',false,polyShadowWallet&&polyLegacyWallet);

const evidence={
  schema:'FAE_PQ07_ADVERSARIAL_DOWNGRADE_REPLAY_EVIDENCE_V1',
  result:failures.length===0?'PASS':'FAIL',
  frozen_manifest:'lab/post-quantum-signatures/wave-f/pq07/manifest.json',
  parameter_sets:parameterSets,
  case_count:cases.length,
  failed_case_ids:failures,
  cases,
  summary:{
    unauthorized_dual_acceptance:cases.filter(c=>c.id.includes('dual-acceptance')&&c.observed===true).length,
    unauthorized_downgrade_acceptance:failures.length,
    private_material_emitted:false,
    activation_authorized:false
  }
};
console.log(JSON.stringify(evidence,null,2));
if(failures.length) throw new Error('PQ-07 adversarial failures: '+failures.join(', '));
