import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ml_dsa44, ml_dsa65, ml_dsa87 } from '@noble/post-quantum/ml-dsa.js';
const input=process.argv[2];if(!input)throw new Error('public state path required');
const state=JSON.parse(await readFile(input,'utf8'));
const schemes={'ML-DSA-44':ml_dsa44,'ML-DSA-65':ml_dsa65,'ML-DSA-87':ml_dsa87};
const canon=v=>Array.isArray(v)?v.map(canon):(v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canon(v[k])])):v);
const stable=v=>JSON.stringify(canon(v));
let checked=0;
for(const e of state.entries){
  const tx=e.transaction, scheme=schemes[tx.mldsa_parameter_set];assert.ok(scheme);
  const core={kind:tx.kind,shadow_version:tx.shadow_version,network:tx.network,inputs:tx.inputs,outputs:tx.outputs,ed25519_public_key_spki:tx.ed25519_public_key_spki,mldsa_parameter_set:tx.mldsa_parameter_set,mldsa_public_key:tx.mldsa_public_key};
  const msg=new TextEncoder().encode(stable({domain:'FAIRYELF_PQ_HYBRID_TX_V1',...core}));
  assert.equal(scheme.verify(Uint8Array.from(Buffer.from(tx.mldsa_signature,'base64')),msg,Uint8Array.from(Buffer.from(tx.mldsa_public_key,'base64'))),true);
  const edKey=await crypto.subtle.importKey('spki',Buffer.from(tx.ed25519_public_key_spki,'base64'),{name:'Ed25519'},false,['verify']);
  assert.equal(await crypto.subtle.verify('Ed25519',edKey,Buffer.from(tx.ed25519_signature,'base64'),msg),true);
  checked++;
}
console.log(JSON.stringify({schema:'FAE_PQ10_BROWSER_FACING_EVIDENCE_V1',result:'PASS',conditions:'browser',entries_verified:checked,
webcrypto_ed25519:'PASS',noble_mldsa:'PASS',physical_device_claim:false,private_material_emitted:false,activation_authorized:false},null,2));
