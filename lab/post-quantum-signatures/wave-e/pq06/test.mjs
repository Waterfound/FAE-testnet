import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomBytes, webcrypto } from 'node:crypto';
import vm from 'node:vm';
import {
  MLDSA_SCHEMES, deriveLegacySeed, derivePQSeed, deriveShadowKeyMaterial,
  parsePublicMetadata, recoverAgainstMetadata, serializePublicMetadata
} from './shadow-wallet.mjs';

const elements=new Map();
function fakeElement(){return{hidden:false,tabIndex:0,addEventListener(){},setAttribute(){},classList:{add(){},remove(){},toggle(){}}}}
const context={
  crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,Array,Map,BigInt,Error,String,Number,Object,JSON,atob,btoa,console,
  localStorage:{setItem(){},getItem(){return null}},
  document:{getElementById(id){if(!elements.has(id))elements.set(id,fakeElement());return elements.get(id)}}
};
context.window=context; vm.createContext(context);
for(const file of ['bip39-en.js','core.js','wallet-crypto.js']){
  vm.runInContext(await readFile(new URL('../../../../'+file,import.meta.url),'utf8'),context,{filename:file});
}
const active=context.FAEWalletCrypto;
const wordList=Array.from(context.FAE_BIP39_WORDS);
const entropy=Uint8Array.from(randomBytes(32));
const mnemonic=await active.mnemonicFromEntropy(entropy);
const passphrase=randomBytes(16).toString('hex');

const activeBlank=await active.deriveAddressRecords(mnemonic,'',5);
const activeProtected=await active.deriveAddressRecords(mnemonic,passphrase,5);
for(let i=0;i<5;i++){
  const blank=deriveShadowKeyMaterial(mnemonic,'','ML-DSA-65',i,wordList).publicMetadata;
  const protectedRecord=deriveShadowKeyMaterial(mnemonic,passphrase,'ML-DSA-65',i,wordList).publicMetadata;
  assert.equal(blank.legacy_address,activeBlank.addresses[i].address,'blank legacy address parity '+i);
  assert.equal(blank.legacy_public_key_spki,activeBlank.addresses[i].pub,'blank legacy public-key parity '+i);
  assert.equal(protectedRecord.legacy_address,activeProtected.addresses[i].address,'protected legacy address parity '+i);
  assert.equal(protectedRecord.legacy_public_key_spki,activeProtected.addresses[i].pub,'protected legacy public-key parity '+i);
}

const setRecords={};
for(const set of Object.keys(MLDSA_SCHEMES)){
  const a=deriveShadowKeyMaterial(mnemonic,passphrase,set,0,wordList);
  const b=deriveShadowKeyMaterial(mnemonic,passphrase,set,0,wordList);
  assert.deepEqual(a.publicMetadata,b.publicMetadata,'deterministic PQ re-derivation '+set);
  assert.equal('mnemonic' in a.publicMetadata,false);
  assert.equal('passphrase' in a.publicMetadata,false);
  assert.equal('mldsaSecretKey' in a.publicMetadata,false);
  setRecords[set]=a.publicMetadata;
}
assert.equal(new Set(Object.values(setRecords).map(x=>x.mldsa_public_key)).size,3,'parameter sets separated');

const seed44=derivePQSeed(mnemonic,passphrase,'ML-DSA-44',0,wordList);
const seed65=derivePQSeed(mnemonic,passphrase,'ML-DSA-65',0,wordList);
const seed87=derivePQSeed(mnemonic,passphrase,'ML-DSA-87',0,wordList);
assert.equal(new Set([seed44.toString('hex'),seed65.toString('hex'),seed87.toString('hex')]).size,3,'PQ domain parameter separation');
assert.notEqual(derivePQSeed(mnemonic,passphrase,'ML-DSA-65',0,wordList).toString('hex'),derivePQSeed(mnemonic,passphrase,'ML-DSA-65',1,wordList).toString('hex'),'index separation');
assert.notEqual(derivePQSeed(mnemonic,passphrase,'ML-DSA-65',0,wordList).toString('hex'),derivePQSeed(mnemonic,passphrase+'x','ML-DSA-65',0,wordList).toString('hex'),'passphrase separation');
assert.notEqual(deriveLegacySeed(mnemonic,passphrase,0,wordList).toString('hex'),derivePQSeed(mnemonic,passphrase,'ML-DSA-65',0,wordList).toString('hex'),'legacy/PQ domain separation');

const material=deriveShadowKeyMaterial(mnemonic,passphrase,'ML-DSA-65',2,wordList);
const persisted=serializePublicMetadata(material.publicMetadata);
const restored=parsePublicMetadata(persisted);
assert.deepEqual(restored,material.publicMetadata,'public metadata roundtrip');
const recovered=recoverAgainstMetadata(mnemonic,passphrase,persisted,wordList);
assert.deepEqual(recovered.publicMetadata,material.publicMetadata,'restart/recovery roundtrip');

const corrupted=JSON.parse(persisted);
const pk=Buffer.from(corrupted.mldsa_public_key,'base64'); pk[0]^=1; corrupted.mldsa_public_key=pk.toString('base64');
assert.throws(()=>parsePublicMetadata(corrupted),/fingerprint/,'corrupted backup rejected');
assert.throws(()=>recoverAgainstMetadata(mnemonic,passphrase+'wrong',persisted,wordList),/recovery_mismatch/,'wrong passphrase rejected');
assert.throws(()=>deriveShadowKeyMaterial(mnemonic.replace(/^\S+/,'notaword'),'','ML-DSA-65',0,wordList),/unknown_mnemonic_word/,'corrupt mnemonic rejected');

console.log(JSON.stringify({
  schema:'FAE_PQ06_WALLET_MIGRATION_SHADOW_EVIDENCE_V1',
  result:'PASS',
  legacy_identity_parity:{blank_passphrase_addresses:5,protected_passphrase_addresses:5,result:'PASS'},
  pq_parameter_sets:Object.keys(MLDSA_SCHEMES),
  deterministic_recovery:'PASS',
  parameter_set_domain_separation:'PASS',
  address_index_domain_separation:'PASS',
  passphrase_separation:'PASS',
  legacy_pq_domain_separation:'PASS',
  public_metadata_restart_roundtrip:'PASS',
  corrupted_backup_rejection:'PASS',
  wrong_passphrase_rejection:'PASS',
  corrupted_mnemonic_rejection:'PASS',
  private_material_emitted:false,
  activation_authorized:false
},null,2));
