import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign as nodeSign} from 'node:crypto';
import {
 NETWORK, MAX_MEMPOOL_TXS, emptyState, cloneState, acceptTxInto,
 verifyTxCrypto, txPayload
} from '../../sovereign-forge/node/authoritative/fae-v4-core.mjs';
import {stableStringify} from '../../sovereign-forge/node/authoritative/canonical.mjs';
import {sha256} from '../../sovereign-forge/node/authoritative/crypto.mjs';
import {encodeAddress} from '../../sovereign-forge/node/authoritative/address.mjs';
import {trialFeeAwareAdmission,candidateFeeOrderedTxids} from './fee-aware-shadow-policy.mjs';

function wallet(){
 const {privateKey,publicKey}=generateKeyPairSync('ed25519');
 const spki=publicKey.export({format:'der',type:'spki'});
 return {privateKey,pub:spki.toString('base64'),address:encodeAddress(sha256(spki).subarray(0,20),'faet')};
}
function sign(owner,input,amount,fee=0n){
 const unsigned={version:2,network:NETWORK,inputs:[input],
  outputs:[{address:owner.address,amount_atoms:(BigInt(amount)-fee).toString()}],
  public_key_spki:owner.pub};
 const signature=nodeSign(null,Buffer.from(stableStringify(txPayload({...unsigned,signature:''}))),owner.privateKey).toString('base64');
 return {...unsigned,signature};
}
function seed(state,owner,id,amount='1000000000'){
 state.utxos[id]={outpoint:id,address:owner.address,amount_atoms:amount,created_height:0,spent:false,spent_by:null};
}
function deepPool(){
 const miner=wallet(),other=wallet(),state=emptyState(),amount='1000000000';
 seed(state,miner,'miner:0',amount); seed(state,other,'other:0',amount);
 let parent='miner:0';
 for(let i=0;i<MAX_MEMPOOL_TXS;i++){
  const admitted=acceptTxInto(state,sign(miner,parent,amount));
  parent=admitted.txid+':0';
 }
 return {state,miner,other,amount,parent};
}
const fixture=deepPool();
test('signed valid high-fee tx enters 4096-deep saturated pool only on atomically copied state',()=>{
 const {state,other,amount}=fixture,original=stableStringify(state);
 const raw=sign(other,'other:0',amount,1000000n);
 assert.equal(verifyTxCrypto(raw).ok,true);
 const r=trialFeeAwareAdmission(state,raw);
 assert.equal(r.status,'admitted');
 assert.equal(r.state.mempoolOrder.length,MAX_MEMPOOL_TXS);
 assert.equal(r.fee_atoms,'1000000');
 assert.deepEqual(r.evicted,[state.mempoolOrder.at(-1)]);
 assert.equal(r.state.mempoolSpends['other:0'],r.txid);
 assert.equal(stableStringify(state),original);
 assert.ok(!r.state.transactions[r.evicted[0]]);
 const reboot=JSON.parse(JSON.stringify(r.state));
 assert.equal(stableStringify(reboot),stableStringify(r.state));
});
test('zero and insufficient fee cannot displace a full zero-fee mempool',()=>{
 const {state,other,amount}=fixture;
 const r=trialFeeAwareAdmission(state,sign(other,'other:0',amount));
 assert.equal(r.status,'rejected');
 assert.equal(r.reason,'no_better_fee_package');
 assert.equal(r.state,null);
});
test('invalid signature cannot trigger eviction even with large stated fee',()=>{
 const {state,other,amount}=fixture;
 const bad={...sign(other,'other:0',amount,1000000n),signature:'AA=='};
 const before=stableStringify(state),r=trialFeeAwareAdmission(state,bad);
 assert.equal(r.status,'rejected');
 assert.equal(r.state,null);
 assert.equal(stableStringify(state),before);
});
test('incoming spent child depends on protected pending ancestor; no evictions violate that protection',()=>{
 const {state,miner,amount,parent}=fixture;
 const r=trialFeeAwareAdmission(state,sign(miner,parent,amount,1000000n));
 assert.equal(r.status,'rejected');
 assert.equal(r.reason,'no_better_fee_package');
});
test('source mempool index corruption fails closed without mutation',()=>{
 const {state,other,amount}=fixture,wrong=cloneState(state);
 delete wrong.mempoolOutputs[fixture.parent];
 const before=stableStringify(wrong);
 const r=trialFeeAwareAdmission(wrong,sign(other,'other:0',amount,1000000n));
 assert.equal(r.reason,'invalid_source_indexes');
 assert.equal(r.state,null);
 assert.equal(stableStringify(wrong),before);
});
test('real-core ancestor fee package gets priority over unrelated low-fee tx (shadow preview)',()=>{
 const state=emptyState(),a=wallet(),b=wallet(),amount='1000000000';
 seed(state,a,'a:0',amount);seed(state,b,'b:0',amount);
 const parent=acceptTxInto(state,sign(a,'a:0',amount));
 const small=acceptTxInto(state,sign(b,'b:0',amount,200000n));
 const child=acceptTxInto(state,sign(a,parent.txid+':0',amount,2000000n));
 const sorted=candidateFeeOrderedTxids(state,{limit:3});
 assert.deepEqual(sorted,[parent.txid,child.txid,small.txid]);
 assert.deepEqual(candidateFeeOrderedTxids(state,{limit:2}),[parent.txid,child.txid]);
 assert.equal(state.mempoolOrder[1],small.txid,'active source remains FIFO');
});
test('no duplicate intake and no mutated policy constants',()=>{
 const {state}=fixture;
 assert.equal(MAX_MEMPOOL_TXS,4096);
 assert.equal(state.mempoolOrder.length,4096);
 assert.throws(()=>candidateFeeOrderedTxids(state,{limit:5000}),/invalid_template_limit/);
 assert.equal(trialFeeAwareAdmission(state,{},{}).status,'rejected');
});
