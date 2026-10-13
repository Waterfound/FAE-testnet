/** PCC-001: composed source W2 #315 + W3 #317 cross-frontier negative.
 * Only isolated shadow fee selection + frozen PPLNS. No activation.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign as signBytes} from 'node:crypto';
import {NETWORK,emptyState,acceptTxInto,txPayload,expectedReward} from '../../sovereign-forge/node/authoritative/fae-v4-core.mjs';
import {stableStringify} from '../../sovereign-forge/node/authoritative/canonical.mjs';
import {sha256} from '../../sovereign-forge/node/authoritative/crypto.mjs';
import {encodeAddress} from '../../sovereign-forge/node/authoritative/address.mjs';
import {PPLNS_COINBASE_ACTIVATION_HEIGHT} from '../../sovereign-forge/node/authoritative/pplns-activation.mjs';
import {ShareCoordinator,allocatePplnsOutputs} from '../../sovereign-forge/node/authoritative/share-coordinator.mjs';
import {selectFeeSensitiveTemplateCandidate} from './mempool-fee-aware-shadow-candidate.mjs';

test('PCC-I01: real signed W2 fee shadow cannot activate or fund unearned W3 pool rewards',async()=>{
  const state=emptyState();
  const {privateKey,publicKey}=generateKeyPairSync('ed25519');
  const spki=publicKey.export({format:'der',type:'spki'});
  const address=encodeAddress(sha256(spki).subarray(0,20),'faet');
  const input='pcc:0',atoms='1000000000',fee=1000000n;
  state.utxos[input]={outpoint:input,address,amount_atoms:atoms,created_height:0,spent:false,spent_by:null};
  const unsigned={version:2,network:NETWORK,inputs:[input],
    outputs:[{address,amount_atoms:(BigInt(atoms)-fee).toString()}],
    public_key_spki:spki.toString('base64')};
  const signature=signBytes(null,Buffer.from(stableStringify(txPayload({...unsigned,signature:''}))),privateKey).toString('base64');
  const admitted=acceptTxInto(state,{...unsigned,signature});
  const before=stableStringify(state);
  const selected=selectFeeSensitiveTemplateCandidate(state);
  assert.deepEqual(selected.txids,[admitted.txid]);
  assert.equal(selected.fee_atoms,fee.toString());
  assert.equal(selected.source_state_mutated,false);
  assert.equal(stableStringify(state),before);
  assert.equal(PPLNS_COINBASE_ACTIVATION_HEIGHT,null);
  const reward=expectedReward(state,1);
  const outputs=allocatePplnsOutputs(reward.toString(),[{address,weight:'1'}]);
  assert.deepEqual(outputs,[{address,amount_atoms:reward.toString()}]);
  assert.notEqual(outputs[0].amount_atoms,(reward+fee).toString());
  const inactivePool=new ShareCoordinator();
  await assert.rejects(inactivePool.createWork(address),/PPLNS multi-output coinbase activation required/);
  assert.equal(inactivePool.jobs.size,0);
});
