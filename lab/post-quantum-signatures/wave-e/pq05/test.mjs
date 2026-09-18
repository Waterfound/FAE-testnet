import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes, sign as edSign } from 'node:crypto';
import { encodeAddress } from '../../../../sovereign-forge/node/authoritative/address.mjs';
import { normalizeTx, txPayload, verifyTxCrypto } from '../../../../sovereign-forge/node/authoritative/fae-v4-core.mjs';
import { stableStringify as activeStableStringify } from '../../../../sovereign-forge/node/authoritative/canonical.mjs';
import {
  MLDSA_SCHEMES, SHADOW_KIND, SHADOW_NETWORK, SHADOW_VERSION,
  SIGNING_DOMAIN, signHybridTransaction, signingBytes,
  verifyHybridTransaction, shadowTxid
} from './hybrid-transaction.mjs';

const result={
  schema:'FAE_PQ05_HYBRID_TRANSACTION_SHADOW_EVIDENCE_V1',
  result:'PASS',
  parameter_sets:[],
  checks:{},
  activation_authorized:false,
  private_material_emitted:false
};

function clone(v){return structuredClone(v)}
function b64(v){return Buffer.from(v).toString('base64')}

const {privateKey:edPrivate,publicKey:edPublic}=generateKeyPairSync('ed25519');
const edSpki=edPublic.export({format:'der',type:'spki'}).toString('base64');
const recipient=encodeAddress(randomBytes(20),'faet');
const input='0'.repeat(64)+':0';

for(const [parameterSet,scheme] of Object.entries(MLDSA_SCHEMES)){
  const seed=randomBytes(scheme.lengths.seed);
  const keys=scheme.keygen(seed);
  const unsigned={
    kind:SHADOW_KIND,
    shadow_version:SHADOW_VERSION,
    network:SHADOW_NETWORK,
    inputs:[input],
    outputs:[{address:recipient,amount_atoms:'1000'}],
    ed25519_public_key_spki:edSpki,
    mldsa_parameter_set:parameterSet,
    mldsa_public_key:b64(keys.publicKey)
  };
  const signed=signHybridTransaction(unsigned,edPrivate,keys.secretKey);
  const verified=verifyHybridTransaction(signed);
  assert.equal(verified.ok,true,parameterSet+' hybrid verify');

  const signedAgain=signHybridTransaction(unsigned,edPrivate,keys.secretKey);
  assert.equal(signedAgain.ed25519_signature,signed.ed25519_signature,'Ed25519 deterministic');
  assert.equal(signedAgain.mldsa_signature,signed.mldsa_signature,'ML-DSA deterministic test mode');
  assert.equal(shadowTxid(signedAgain),shadowTxid(signed),'deterministic txid');

  const stripEd=clone(signed); delete stripEd.ed25519_signature;
  assert.equal(verifyHybridTransaction(stripEd).ok,false,'strip Ed25519 rejected');
  const stripMl=clone(signed); delete stripMl.mldsa_signature;
  assert.equal(verifyHybridTransaction(stripMl).ok,false,'strip ML-DSA rejected');

  const tampered=clone(signed); tampered.outputs[0].amount_atoms='1001';
  assert.equal(verifyHybridTransaction(tampered).ok,false,'payload tamper rejected');

  const {publicKey:wrongEd}=generateKeyPairSync('ed25519');
  const wrongEdTx=clone(signed);
  wrongEdTx.ed25519_public_key_spki=wrongEd.export({format:'der',type:'spki'}).toString('base64');
  const wrongEdMessage=signingBytes(wrongEdTx);
  wrongEdTx.mldsa_signature=b64(scheme.sign(wrongEdMessage,keys.secretKey,{extraEntropy:false}));
  assert.equal(verifyHybridTransaction(wrongEdTx).ok,false,'wrong Ed25519 key rejected');

  const otherKeys=scheme.keygen(randomBytes(scheme.lengths.seed));
  const wrongMlTx=clone(signed);
  wrongMlTx.mldsa_public_key=b64(otherKeys.publicKey);
  wrongMlTx.ed25519_signature=b64(edSign(null,signingBytes(wrongMlTx),edPrivate));
  assert.equal(verifyHybridTransaction(wrongMlTx).ok,false,'wrong ML-DSA key rejected');

  const parameterSets=Object.keys(MLDSA_SCHEMES);
  const otherSet=parameterSets[(parameterSets.indexOf(parameterSet)+1)%parameterSets.length];
  const substituted=clone(signed);
  substituted.mldsa_parameter_set=otherSet;
  substituted.ed25519_signature=b64(edSign(null,signingBytes(substituted),edPrivate));
  assert.equal(verifyHybridTransaction(substituted).ok,false,'parameter substitution rejected');

  const replay=clone(signed);
  const wrongDomain={...JSON.parse(activeStableStringify({
    kind:unsigned.kind,shadow_version:unsigned.shadow_version,network:unsigned.network,inputs:unsigned.inputs,outputs:unsigned.outputs,
    ed25519_public_key_spki:unsigned.ed25519_public_key_spki,mldsa_parameter_set:unsigned.mldsa_parameter_set,mldsa_public_key:unsigned.mldsa_public_key
  })),domain:'FAIRYELF_TX_V2'};
  const wrongBytes=Buffer.from(activeStableStringify(wrongDomain));
  replay.ed25519_signature=b64(edSign(null,wrongBytes,edPrivate));
  replay.mldsa_signature=b64(scheme.sign(wrongBytes,keys.secretKey,{extraEntropy:false}));
  assert.equal(verifyHybridTransaction(replay).ok,false,'cross-domain replay rejected');

  assert.equal(verifyTxCrypto(signed).ok,false,'active Transaction v2 verifier rejects shadow');

  const activeTx={
    version:2,network:SHADOW_NETWORK,inputs:[input],outputs:[{address:recipient,amount_atoms:'1000'}],
    public_key_spki:edSpki,signature:''
  };
  const activeNorm=normalizeTx(activeTx);
  activeTx.signature=b64(edSign(null,Buffer.from(activeStableStringify(txPayload(activeNorm))),edPrivate));
  assert.equal(verifyTxCrypto(activeTx).ok,true,'control Transaction v2 is cryptographically valid');
  assert.equal(verifyHybridTransaction(activeTx).ok,false,'shadow parser rejects Transaction v2');

  result.parameter_sets.push(parameterSet);
}
result.checks={
  both_signatures_required:'PASS',
  canonical_serialization:'PASS',
  deterministic_txid:'PASS',
  tamper_rejection:'PASS',
  wrong_key_rejection:'PASS',
  signature_stripping_rejection:'PASS',
  parameter_substitution_rejection:'PASS',
  domain_replay_rejection:'PASS',
  active_v2_rejects_shadow:'PASS',
  shadow_rejects_active_v2:'PASS',
  all_parameter_sets:'PASS'
};
console.log(JSON.stringify(result,null,2));
