import assert from 'node:assert/strict';
import { createHash, randomBytes, webcrypto } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import vm from 'node:vm';
import { deriveShadowKeyMaterial, serializePublicMetadata } from '../../wave-e/pq06/shadow-wallet.mjs';
import { MLDSA_SCHEMES, SHADOW_KIND, SHADOW_VERSION, SHADOW_NETWORK, signHybridTransaction, verifyHybridTransaction, shadowTxid, stableStringify } from '../../wave-e/pq05/hybrid-transaction.mjs';

const output=process.argv[2]; if(!output)throw new Error('public state output path required');
const elements=new Map();
function fakeElement(){return{hidden:false,tabIndex:0,addEventListener(){},setAttribute(){},classList:{add(){},remove(){},toggle(){}}}}
const context={crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,Array,Map,BigInt,Error,String,Number,Object,JSON,atob,btoa,console,
localStorage:{setItem(){},getItem(){return null}},document:{getElementById(id){if(!elements.has(id))elements.set(id,fakeElement());return elements.get(id)}}};
context.window=context; vm.createContext(context);
for(const file of ['bip39-en.js','core.js','wallet-crypto.js'])vm.runInContext(await readFile(new URL('../../../../'+file,import.meta.url),'utf8'),context,{filename:file});
const active=context.FAEWalletCrypto, wordList=Array.from(context.FAE_BIP39_WORDS);
const entropy=Uint8Array.from(randomBytes(32)), mnemonic=await active.mnemonicFromEntropy(entropy), passphrase=randomBytes(24).toString('hex');

const newMempool=()=>({format:'FAE_PQ10_SHADOW_MEMPOOL_V1',order:[],transactions:{}});
function insert(mp,tx){const v=verifyHybridTransaction(tx);if(!v.ok)throw new Error('shadow_mempool_reject:'+v.error);if(mp.transactions[v.txid])throw new Error('duplicate_txid');mp.transactions[v.txid]=structuredClone(tx);mp.order.push(v.txid);return v.txid}
const inputFor=(set,i)=>createHash('sha256').update('FAE_PQ10_INPUT').update(set).update(String(i)).digest('hex')+':0';

function buildEntry(set,index){
  const material=deriveShadowKeyMaterial(mnemonic,passphrase,set,index,wordList), metadata=material.publicMetadata;
  const unsigned={kind:SHADOW_KIND,shadow_version:SHADOW_VERSION,network:SHADOW_NETWORK,inputs:[inputFor(set,index)],
    outputs:[{address:metadata.legacy_address,amount_atoms:String(1000+index)}],
    ed25519_public_key_spki:metadata.legacy_public_key_spki,mldsa_parameter_set:set,mldsa_public_key:metadata.mldsa_public_key};
  const transaction=signHybridTransaction(unsigned,material.legacyPrivateKey,material.mldsaSecretKey);
  assert.equal(verifyHybridTransaction(transaction).ok,true,set+' verify');
  return{parameter_set:set,public_metadata:JSON.parse(serializePublicMetadata(metadata)),transaction,txid:shadowTxid(transaction)};
}
const sets=Object.keys(MLDSA_SCHEMES), a=sets.map(buildEntry), b=sets.map(buildEntry);
assert.equal(stableStringify(a),stableStringify(b),'deterministic public replay');
const mempool=newMempool(); for(const e of a)assert.equal(insert(mempool,e.transaction),e.txid);
assert.throws(()=>insert(mempool,a[0].transaction),/duplicate_txid/);
for(const e of a){const stripped=structuredClone(e.transaction);delete stripped.mldsa_signature;const before=stableStringify(mempool);assert.throws(()=>insert(mempool,stripped),/shadow_mempool_reject/);assert.equal(stableStringify(mempool),before)}
const publicState={schema:'FAE_PQ10_PUBLIC_SHADOW_STATE_V1',parameter_sets:sets,entries:a,mempool:{format:mempool.format,order:[...mempool.order],count:mempool.order.length},secret_material_persisted:false,rpc_used:false,active_state_mutated:false};
const serialized=JSON.stringify(publicState,null,2)+'\n'; await writeFile(output,serialized);
console.log(JSON.stringify({schema:'FAE_PQ10_CREATE_PHASE_EVIDENCE_V1',result:'PASS',parameter_sets:sets,entries:a.length,mempool_count:mempool.order.length,
deterministic_in_run_replay:'PASS',duplicate_rejection:'PASS',invalid_before_mutation:'PASS',public_state_sha256:createHash('sha256').update(serialized).digest('hex'),
private_material_emitted:false,rpc_used:false,active_state_mutated:false,activation_authorized:false},null,2));
