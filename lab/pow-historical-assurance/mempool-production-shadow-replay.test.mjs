/**
 * PF-12 / Element 2 — SHADOW-ONLY production-core mempool replay.
 *
 * The active node always rejects a transaction at a full 4096-entry mempool.
 * This executable counterfactual proves whether atomic cleanup of the leaf
 * transaction's real indexes *could* permit an independently signed higher-
 * fee valid transaction on a CLONED state. Never modifies the node or v4 rules.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign as nodeSign} from 'node:crypto';
import {
 NETWORK,MAX_MEMPOOL_TXS,emptyState,cloneState,acceptTxInto,txPayload,verifyTxCrypto
} from '../../sovereign-forge/node/authoritative/fae-v4-core.mjs';
import {stableStringify} from '../../sovereign-forge/node/authoritative/canonical.mjs';
import {sha256} from '../../sovereign-forge/node/authoritative/crypto.mjs';
import {encodeAddress} from '../../sovereign-forge/node/authoritative/address.mjs';

function wallet(){
  const {privateKey,publicKey}=generateKeyPairSync('ed25519');
  const spki=publicKey.export({format:'der',type:'spki'});
  return {privateKey,pub:spki.toString('base64'),
    address:encodeAddress(sha256(spki).subarray(0,20),'faet')};
}
function signed(owner,input,amount,fee=0n){
  const output=(BigInt(amount)-BigInt(fee)).toString();
  const unsigned={version:2,network:NETWORK,inputs:[input],
    outputs:[{address:owner.address,amount_atoms:output}],public_key_spki:owner.pub};
  const signature=nodeSign(null,Buffer.from(stableStringify(txPayload({...unsigned,signature:''}))),owner.privateKey).toString('base64');
  return {...unsigned,signature};
}
function seed(state,owner,outpoint,amount='1000000000'){
  state.utxos[outpoint]={outpoint,address:owner.address,amount_atoms:amount,created_height:0,spent:false,spent_by:null};
}
function full(){
  const attacker=wallet(),victim=wallet(),state=emptyState(),amount='1000000000';
  seed(state,attacker,'attacker:0',amount);
  seed(state,victim,'victim:0',amount);
  let predecessor='attacker:0';
  for(let i=0;i<MAX_MEMPOOL_TXS;i++){
    const t=acceptTxInto(state,signed(attacker,predecessor,amount));
    predecessor=t.txid+':0';
  }
  return {state,attacker,victim,amount,lastTxId:state.mempoolOrder.at(-1)};
}
function verifyIndexes(state){
  const seen=new Set(state.mempoolOrder);
  assert.equal(seen.size,state.mempoolOrder.length);
  assert.ok(seen.size<=MAX_MEMPOOL_TXS);
  for(const id of seen){
    const rec=state.transactions[id];
    assert.ok(rec&&rec.status==='pending','missing live transaction');
    for(const input of rec.inputs)assert.equal(state.mempoolSpends[input],id,'input spend not indexed');
    for(const [i,output] of rec.outputs.entries()){
      const indexed=state.mempoolOutputs[id+':'+i];
      assert.ok(indexed,'missing indexed pending output');
      assert.equal(indexed.address,output.address);
      assert.equal(indexed.amount_atoms,output.amount_atoms);
    }
  }
  for(const [outpoint,txid] of Object.entries(state.mempoolSpends)){
    assert.ok(seen.has(txid),'orphan input reservation: '+outpoint);
  }
  for(const [outpoint,output] of Object.entries(state.mempoolOutputs)){
    assert.ok(seen.has(output.txid),'orphan pending output: '+outpoint);
  }
}
/** Leaf-only atomic prototype. Real policy must handle descendants and fee economics. */
function releaseLeafOnShadow(source,id){
  const shadow=cloneState(source);
  const rec=shadow.transactions[id];
  assert.ok(rec&&rec.status==='pending','leaf candidate must be currently pending');
  assert.ok(shadow.mempoolOrder.includes(id),'leaf candidate must belong to mempool');
  for(const outputIndex of rec.outputs.keys()){
    assert.ok(!shadow.mempoolSpends[id+':'+outputIndex],'cannot evict a transaction with descendants');
  }
  shadow.mempoolOrder=shadow.mempoolOrder.filter(x=>x!==id);
  for(const input of rec.inputs){
    assert.equal(shadow.mempoolSpends[input],id);
    delete shadow.mempoolSpends[input];
  }
  for(const index of rec.outputs.keys())delete shadow.mempoolOutputs[id+':'+index];
  delete shadow.transactions[id];
  verifyIndexes(shadow);
  return {shadow,removed:rec};
}
test('PF-12: real 4096-deep zero-fee chain rejects independent valid high-fee transfer in active core',()=>{
  const {state,victim,amount}=full();
  verifyIndexes(state);
  const incoming=signed(victim,'victim:0',amount,1000000n);
  assert.equal(verifyTxCrypto(incoming).ok,true);
  const before=stableStringify(state);
  assert.throws(()=>acceptTxInto(state,incoming),e=>e.code==='mempool_full');
  assert.equal(stableStringify(state),before,'node-state mutation after rejection is forbidden');
});
test('PF-12: leaf-only shadow cleanup preserves all three mempool indexes and admits real signed high-fee tx',()=>{
  const {state,victim,amount,lastTxId}=full();
  const original=stableStringify(state);
  const incoming=signed(victim,'victim:0',amount,1000000n);
  const {shadow,removed}=releaseLeafOnShadow(state,lastTxId);
  assert.equal(removed.fee_atoms,'0');
  const accepted=acceptTxInto(shadow,incoming);
  assert.equal(accepted.fee_atoms,'1000000');
  assert.equal(accepted.status,'pending');
  assert.equal(shadow.mempoolOrder.length,MAX_MEMPOOL_TXS);
  assert.ok(shadow.mempoolOrder.includes(accepted.txid));
  assert.ok(!shadow.transactions[lastTxId]);
  assert.equal(shadow.mempoolSpends['victim:0'],accepted.txid);
  assert.equal(shadow.mempoolSpends['attacker:0'],state.mempoolSpends['attacker:0']);
  verifyIndexes(shadow);
  assert.equal(stableStringify(state),original,'counterfactual must not change original authoritative state');
  const restored=JSON.parse(JSON.stringify(shadow));
  verifyIndexes(restored);
  assert.equal(stableStringify(restored),stableStringify(shadow),'restart-shape stability');
});
test('PF-12: evicting a non-leaf would orphan a child, and is strictly rejected without mutation',()=>{
  const {state}=full();
  const before=stableStringify(state);
  assert.throws(()=>releaseLeafOnShadow(state,state.mempoolOrder[0]),/descendants/);
  assert.equal(stableStringify(state),before);
});
test('PF-12: invalid signed incoming transaction must not acquire evicted capacity',()=>{
  const {state,victim,amount,lastTxId}=full(),original=stableStringify(state);
  const bogus={...signed(victim,'victim:0',amount,1000000n),signature:'AA=='};
  assert.equal(verifyTxCrypto(bogus).ok,false);
  assert.throws(()=>acceptTxInto(state,bogus),e=>e.code==='mempool_full');
  const {shadow}=releaseLeafOnShadow(state,lastTxId);
  assert.throws(()=>acceptTxInto(shadow,bogus),e=>e.code==='invalid_signature');
  assert.equal(stableStringify(state),original);
  verifyIndexes(shadow);
});
