import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import vm from 'node:vm';
import { ml_dsa44, ml_dsa65, ml_dsa87 } from '@noble/post-quantum/ml-dsa.js';
import { encodeAddress } from '../../../../sovereign-forge/node/authoritative/address.mjs';
import {
  SHADOW_KIND, SHADOW_VERSION, SHADOW_NETWORK, MLDSA_SCHEMES,
  signHybridTransaction, shadowTxid
} from '../../wave-e/pq05/hybrid-transaction.mjs';
import {
  deriveShadowKeyMaterial, serializePublicMetadata
} from '../../wave-e/pq06/shadow-wallet.mjs';

const output=process.argv[2];
if(!output) throw new Error('output path required');
const PKCS8_PREFIX=Buffer.from([0x30,0x2e,0x02,0x01,0x00,0x30,0x05,0x06,0x03,0x2b,0x65,0x70,0x04,0x22,0x04,0x20]);
const b64=v=>Buffer.from(v).toString('base64');
const clone=v=>structuredClone(v);
const cases=[];

function fixedBytes(n,offset){return Buffer.from(Array.from({length:n},(_,i)=>(i+offset)&255))}
function edKeyFromSeed(seed){
  const priv=createPrivateKey({key:Buffer.concat([PKCS8_PREFIX,Buffer.from(seed)]),format:'der',type:'pkcs8'});
  const pub=createPublicKey(priv);
  return {priv,pub,spki:pub.export({format:'der',type:'spki'})};
}
function push(id,kind,expected,value,extra={}){
  cases.push({id,kind,expected,value,...extra});
}

const ed=edKeyFromSeed(fixedBytes(32,11));
const recipient=encodeAddress(fixedBytes(20,91),'faet');
const input='1'.repeat(64)+':0';
let offset=31;
for(const [set,scheme] of Object.entries(MLDSA_SCHEMES)){
  const keys=scheme.keygen(fixedBytes(scheme.lengths.seed,offset));
  const unsigned={
    kind:SHADOW_KIND,shadow_version:SHADOW_VERSION,network:SHADOW_NETWORK,
    inputs:[input],outputs:[{address:recipient,amount_atoms:'1000'}],
    ed25519_public_key_spki:b64(ed.spki),
    mldsa_parameter_set:set,mldsa_public_key:b64(keys.publicKey)
  };
  const signed=signHybridTransaction(unsigned,ed.priv,keys.secretKey);
  push('tx-valid-'+set,'transaction',true,signed,{expected_txid:shadowTxid(signed)});
  const mutations=[
    ['strip-ed',x=>{delete x.ed25519_signature}],
    ['strip-ml',x=>{delete x.mldsa_signature}],
    ['extra-field',x=>{x.unexpected='x'}],
    ['wrong-kind',x=>{x.kind='FAE_PQ_OTHER'}],
    ['wrong-version',x=>{x.shadow_version=99}],
    ['wrong-network',x=>{x.network='other-network'}],
    ['malformed-ed-b64',x=>{x.ed25519_signature='***='}],
    ['malformed-ml-b64',x=>{x.mldsa_signature='***='}],
    ['tampered-output',x=>{x.outputs[0].amount_atoms='1001'}],
    ['polyglot-v2',x=>{x.version=2;x.public_key_spki=x.ed25519_public_key_spki;x.signature=x.ed25519_signature}]
  ];
  for(const [name,mutate] of mutations){const x=clone(signed);mutate(x);push('tx-'+name+'-'+set,'transaction',false,x)}
  const sets=Object.keys(MLDSA_SCHEMES), other=sets[(sets.indexOf(set)+1)%sets.length];
  const sub=clone(signed);sub.mldsa_parameter_set=other;push('tx-parameter-substitution-'+set,'transaction',false,sub);
  offset+=41;
}

const elements=new Map();
function fakeElement(){return{hidden:false,tabIndex:0,addEventListener(){},setAttribute(){},classList:{add(){},remove(){},toggle(){}}}}
const context={
  crypto:(await import('node:crypto')).webcrypto,TextEncoder,TextDecoder,Uint8Array,Array,Map,BigInt,Error,String,Number,Object,JSON,atob,btoa,console,
  localStorage:{setItem(){},getItem(){return null}},
  document:{getElementById(id){if(!elements.has(id))elements.set(id,fakeElement());return elements.get(id)}}
};
context.window=context;vm.createContext(context);
for(const file of ['bip39-en.js','core.js','wallet-crypto.js']){
  vm.runInContext(await readFile(new URL('../../../../'+file,import.meta.url),'utf8'),context,{filename:file});
}
const active=context.FAEWalletCrypto;
const wordList=Array.from(context.FAE_BIP39_WORDS);
const entropy=Uint8Array.from(fixedBytes(32,151));
const mnemonic=await active.mnemonicFromEntropy(entropy);
const passphrase='pq08-fixed-passphrase';
for(const set of Object.keys(MLDSA_SCHEMES)){
  const m=deriveShadowKeyMaterial(mnemonic,passphrase,set,2,wordList).publicMetadata;
  push('wallet-valid-'+set,'wallet',true,m,{expected_serialized:serializePublicMetadata(m)});
  const mutations=[
    ['missing-pq-key',x=>{delete x.mldsa_public_key}],
    ['missing-fingerprint',x=>{delete x.mldsa_public_key_sha256}],
    ['extra-field',x=>{x.extra='x'}],
    ['wrong-schema',x=>{x.schema='FAE_PQ_SHADOW_WALLET_PUBLIC_V0'}],
    ['negative-index',x=>{x.index=-1}],
    ['bad-fingerprint',x=>{x.mldsa_public_key_sha256='0'.repeat(64)}],
    ['malformed-b64',x=>{x.mldsa_public_key='***='}],
    ['polyglot-legacy',x=>{x.version=2;x.public_key_spki=x.legacy_public_key_spki}]
  ];
  for(const [name,mutate] of mutations){const x=clone(m);mutate(x);push('wallet-'+name+'-'+set,'wallet',false,x)}
  const sets=Object.keys(MLDSA_SCHEMES),other=sets[(sets.indexOf(set)+1)%sets.length];
  const p=clone(m);p.mldsa_parameter_set=other;push('wallet-parameter-substitution-'+set,'wallet',false,p);
}

const doc={
  schema:'FAE_PQ08_DIFFERENTIAL_CORPUS_V1',
  frozen_expected_classes:true,
  generated_from_primary_valid_constructors:true,
  imports_pq07_verdicts:false,
  private_material_emitted:false,
  case_count:cases.length,
  cases
};
await writeFile(output,JSON.stringify(doc,null,2)+'\n');
console.log(JSON.stringify({result:'PASS',case_count:cases.length,output},null,2));
