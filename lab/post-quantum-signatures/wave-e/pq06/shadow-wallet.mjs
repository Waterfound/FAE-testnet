import { createHash, createPrivateKey, createPublicKey, hkdfSync, pbkdf2Sync } from 'node:crypto';
import { ml_dsa44, ml_dsa65, ml_dsa87 } from '@noble/post-quantum/ml-dsa.js';
import { encodeAddress } from '../../../../sovereign-forge/node/authoritative/address.mjs';

export const LEGACY_SALT='FAIRYELF_PUBLIC_TESTNET_V4';
export const LEGACY_INFO='FAIRYELF_ED25519_ADDRESS_V1';
export const PQ_SALT='FAIRYELF_PQ_SHADOW_V1';
export const PQ_INFO='FAIRYELF_PQ_MLDSA_DERIVATION_V1';
export const PUBLIC_SCHEMA='FAE_PQ_SHADOW_WALLET_PUBLIC_V1';
export const MLDSA_SCHEMES={'ML-DSA-44':ml_dsa44,'ML-DSA-65':ml_dsa65,'ML-DSA-87':ml_dsa87};
const PKCS8_PREFIX=Buffer.from([0x30,0x2e,0x02,0x01,0x00,0x30,0x05,0x06,0x03,0x2b,0x65,0x70,0x04,0x22,0x04,0x20]);

function sha256(v){return createHash('sha256').update(v).digest()}
function hkdf32(root,salt,info){return Buffer.from(hkdfSync('sha256',Buffer.from(root),Buffer.from(salt),Buffer.from(info),32))}
function strictB64(value,label){
  if(typeof value!=='string'||value.length===0||value.length%4!==0||!/^[A-Za-z0-9+/]+={0,2}$/.test(value))throw new Error('invalid_'+label);
  const b=Buffer.from(value,'base64'); if(b.toString('base64')!==value)throw new Error('invalid_'+label); return b;
}
export function entropyFromMnemonic(mnemonic,wordList){
  if(!Array.isArray(wordList)||wordList.length!==2048)throw new Error('invalid_word_list');
  const words=String(mnemonic).normalize('NFKD').trim().toLowerCase().split(/\s+/);
  if(words.length!==24)throw new Error('mnemonic_must_have_24_words');
  const index=new Map(wordList.map((w,i)=>[w,i]));
  let bits='';
  for(const word of words){const n=index.get(word);if(n===undefined)throw new Error('unknown_mnemonic_word');bits+=n.toString(2).padStart(11,'0')}
  const entropy=Buffer.from(Array.from({length:32},(_,i)=>parseInt(bits.slice(i*8,i*8+8),2)));
  const expected=parseInt(bits.slice(256,264),2);
  if(sha256(entropy)[0]!==expected)throw new Error('mnemonic_checksum_mismatch');
  return entropy;
}
export function recoveryRoot(mnemonic,passphrase,wordList){
  const entropy=entropyFromMnemonic(mnemonic,wordList);
  if(String(passphrase).length===0)return{entropy,root:Buffer.from(entropy),passphraseProtected:false};
  const root=pbkdf2Sync(
    Buffer.from(String(mnemonic).normalize('NFKD')),
    Buffer.from('mnemonic'+String(passphrase).normalize('NFKD')),
    2048,64,'sha512'
  );
  return{entropy,root,passphraseProtected:true};
}
export function deriveLegacySeed(mnemonic,passphrase,index,wordList){
  if(!Number.isInteger(index)||index<0)throw new Error('invalid_index');
  const {entropy,root,passphraseProtected}=recoveryRoot(mnemonic,passphrase,wordList);
  if(!passphraseProtected&&index===0)return Buffer.from(entropy);
  return hkdf32(root,LEGACY_SALT,LEGACY_INFO+':'+index);
}
export function derivePQSeed(mnemonic,passphrase,parameterSet,index,wordList){
  if(!MLDSA_SCHEMES[parameterSet])throw new Error('unsupported_mldsa_parameter_set');
  if(!Number.isInteger(index)||index<0)throw new Error('invalid_index');
  const {root}=recoveryRoot(mnemonic,passphrase,wordList);
  return hkdf32(root,PQ_SALT,PQ_INFO+':'+parameterSet+':'+index);
}
function legacyPublicFromSeed(seed){
  const der=Buffer.concat([PKCS8_PREFIX,Buffer.from(seed)]);
  const priv=createPrivateKey({key:der,format:'der',type:'pkcs8'});
  const pub=createPublicKey(priv).export({format:'der',type:'spki'});
  return{privateKey:priv,publicKeySpki:Buffer.from(pub),address:encodeAddress(sha256(pub).subarray(0,20),'faet')};
}
export function deriveShadowKeyMaterial(mnemonic,passphrase,parameterSet,index,wordList){
  const legacySeed=deriveLegacySeed(mnemonic,passphrase,index,wordList);
  const legacy=legacyPublicFromSeed(legacySeed);
  const pqSeed=derivePQSeed(mnemonic,passphrase,parameterSet,index,wordList);
  const pq=MLDSA_SCHEMES[parameterSet].keygen(pqSeed);
  const pqPublic=Buffer.from(pq.publicKey);
  const publicMetadata={
    schema:PUBLIC_SCHEMA,
    index,
    mldsa_parameter_set:parameterSet,
    legacy_address:legacy.address,
    legacy_public_key_spki:legacy.publicKeySpki.toString('base64'),
    mldsa_public_key:pqPublic.toString('base64'),
    mldsa_public_key_sha256:sha256(pqPublic).toString('hex')
  };
  return{publicMetadata,legacyPrivateKey:legacy.privateKey,mldsaSecretKey:pq.secretKey};
}
export function parsePublicMetadata(raw){
  const m=typeof raw==='string'?JSON.parse(raw):structuredClone(raw);
  if(!m||m.schema!==PUBLIC_SCHEMA||!Number.isInteger(m.index)||m.index<0)throw new Error('invalid_public_metadata');
  const scheme=MLDSA_SCHEMES[m.mldsa_parameter_set]; if(!scheme)throw new Error('unsupported_mldsa_parameter_set');
  if(typeof m.legacy_address!=='string'||!m.legacy_address.startsWith('faet1'))throw new Error('invalid_legacy_address');
  strictB64(m.legacy_public_key_spki,'legacy_public_key_spki');
  const pq=strictB64(m.mldsa_public_key,'mldsa_public_key');
  if(pq.length!==scheme.lengths.publicKey)throw new Error('wrong_mldsa_public_key_size');
  if(sha256(pq).toString('hex')!==m.mldsa_public_key_sha256)throw new Error('pq_public_fingerprint_mismatch');
  return m;
}
export function serializePublicMetadata(metadata){
  const m=parsePublicMetadata(metadata);
  return JSON.stringify(Object.fromEntries(Object.keys(m).sort().map(k=>[k,m[k])));
}
export function recoverAgainstMetadata(mnemonic,passphrase,metadata,wordList){
  const expected=parsePublicMetadata(metadata);
  const actual=deriveShadowKeyMaterial(mnemonic,passphrase,expected.mldsa_parameter_set,expected.index,wordList);
  const a=actual.publicMetadata;
  for(const k of ['legacy_address','legacy_public_key_spki','mldsa_public_key','mldsa_public_key_sha256']){
    if(a[k]!==expected[k])throw new Error('recovery_mismatch_'+k);
  }
  return actual;
}
