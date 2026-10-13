/** PCC-001: isolated W2 fee-shadow x W3 payout composition proof.
 * This tests simultaneous source import and invariant preservation; it does
 * NOT activate policy, pool, fee revenue or consensus and does NOT establish
 * full end-to-end production integration or mainnet economic security.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign as edSign} from 'node:crypto';
import {NETWORK,emptyState,txPayload} from '../../sovereign-forge/node/authoritative/fae-v4-core.mjs';
import {stableStringify} from '../../sovereign-forge/node/authoritative/canonical.mjs';
import {sha256} from '../../sovereign-forge/node/authoritative/crypto.mjs';
import {encodeAddress} from '../../sovereign-forge/node/authoritative/address.mjs';
import {allocatePplnsOutputs} from '../../sovereign-forge/node/authoritative/share-coordinator.mjs';
import {PPLNS_COINBASE_ACTIVATION_HEIGHT,isPplnsCoinbaseActive} from '../../sovereign-forge/node/authoritative/pplns-activation.mjs';
import {simulateFeeAwareAdmission,selectFeeSensitiveTemplateCandidate} from './mempool-fee-aware-shadow-candidate.mjs';

function wallet(){
  const {privateKey,publicKey}=generateKeyPairSync('ed25519');
  const spki=publicKey.export({format:'der',type:'spki'});
  return {privateKey,spki:spki.toString('base64'),address:encodeAddress(sha256(spki).subarray(0,20),'faet')};
}
function signedTransfer(w,outpoint,feeAtoms){
  const unsigned={version:2,network:NETWORK,inputs:[outpoint],
    outputs:[{address:w.address,amount_atoms:(1000000n-feeAtoms).toString()}],public_key_spki:w.spki};
  const signature=edSign(null,Buffer.from(stableStringify(txPayload({...unsigned,signature:''}))),w.privateKey).toString('base64');
  return {...unsigned,signature};
}

test('PCC-W2W3-01: signed W2 fee admission and W3 PPLNS allocation coexist without policy activation',()=>{
  const alice=wallet(),bob=wallet(),original=emptyState();
  original.utxos['pcc-input:0']={outpoint:'pcc-input:0',address:alice.address,amount_atoms:'1000000',created_height:0,spent:false,spent_by:null};
  const frozen=stableStringify(original);
  const admitted=simulateFeeAwareAdmission(original,signedTransfer(alice,'pcc-input:0',250000n));
  assert.equal(admitted.decision,'admitted_without_eviction');
  assert.equal(admitted.fee_atoms,'250000');
  assert.equal(stableStringify(original),frozen,'isolated W2 simulation must not mutate authoritative input');
  const shadow=selectFeeSensitiveTemplateCandidate(admitted.state,{limit:1});
  assert.equal(shadow.template_policy,'FEE_SENSITIVE_SHADOW_ONLY');
  assert.deepEqual(shadow.txids,[admitted.admitted]);
  assert.equal(shadow.fee_atoms,'250000');
  assert.equal(shadow.source_state_mutated,false);
  const outputs=allocatePplnsOutputs('1000',[{address:alice.address,weight:3n},{address:bob.address,weight:1n}]);
  assert.deepEqual(outputs.map(x=>x.amount_atoms),['750','250']);
  assert.equal(outputs.reduce((n,x)=>n+BigInt(x.amount_atoms),0n),1000n);
  assert.equal(PPLNS_COINBASE_ACTIVATION_HEIGHT,null);
  assert.equal(isPplnsCoinbaseActive(1_000_000),false);
  assert.equal(stableStringify(original),frozen,'W3 payout arithmetic must not mutate original mempool');
});

test('PCC-W2W3-02: W2 signed fee rejects forged signature without influencing W3 payout state',()=>{
  const alice=wallet(),bob=wallet(),state=emptyState();
  state.utxos['pcc-negative:0']={outpoint:'pcc-negative:0',address:alice.address,amount_atoms:'1000000',created_height:0,spent:false,spent_by:null};
  const frozen=stableStringify(state),real=signedTransfer(alice,'pcc-negative:0',250000n);
  assert.throws(()=>simulateFeeAwareAdmission(state,{...real,signature:'AA=='}),e=>e.code==='invalid_signature');
  assert.equal(stableStringify(state),frozen);
  const outputs=allocatePplnsOutputs('1000',[{address:alice.address,weight:3n},{address:bob.address,weight:1n}]);
  assert.equal(outputs.reduce((n,x)=>n+BigInt(x.amount_atoms),0n),1000n);
  assert.equal(isPplnsCoinbaseActive(1_000_000),false);
});
