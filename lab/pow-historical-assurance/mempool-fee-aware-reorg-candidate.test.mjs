import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign as signBytes} from 'node:crypto';
import {NETWORK,MAX_MEMPOOL_TXS,emptyState,appendBlockFromFeed,
 createMiningTemplate,appendBlockFromSubmission,acceptTxInto,cloneState,
 reconcileDetachedTransactions,preferred,txPayload} from '../../sovereign-forge/node/authoritative/fae-v4-core.mjs';
import {legacyBlocks} from '../../sovereign-forge/tests/legacy-testnet-fixture.mjs';
import {stableStringify} from '../../sovereign-forge/node/authoritative/canonical.mjs';
import {sha256,hashHex,leadingZeroBits} from '../../sovereign-forge/node/authoritative/crypto.mjs';
import {encodeAddress} from '../../sovereign-forge/node/authoritative/address.mjs';
import {assertPendingIndexes} from './mempool-fee-aware-shadow-candidate.mjs';
import {recoverDetachedFeeAware} from './mempool-fee-aware-reorg-candidate.mjs';
function wallet(){
 const{privateKey,publicKey}=generateKeyPairSync('ed25519');
 const pub=publicKey.export({format:'der',type:'spki'});
 return{privateKey,encoded:pub.toString('base64'),address:encodeAddress(sha256(pub).subarray(0,20),'faet')};
}
function signed(w,input,atoms,fee=0n){
 const raw={version:2,network:NETWORK,inputs:[input],outputs:[{address:w.address,amount_atoms:(BigInt(atoms)-fee).toString()}],public_key_spki:w.encoded};
 return {...raw,signature:signBytes(null,Buffer.from(stableStringify(txPayload({...raw,signature:''}))),w.privateKey).toString('base64')};
}
function mine(state,address){
 const template=createMiningTemplate(state,address);
 for(let nonce=0;nonce<8000000;nonce++){
  const hash=hashHex({...template.header,nonce});
  if(leadingZeroBits(hash)>=template.header.difficulty_bits){
   return appendBlockFromSubmission(state,{header:template.header,nonce,hash,txids:template.txids});
  }
 }
 throw new Error('bounded_work_search_exhausted');
}
function scenario(){
 const owner=wallet(),other=wallet();
 let common=emptyState();
 for(const block of legacyBlocks)common=appendBlockFromFeed(common,block,new Map(),{activationHeight:null});
 common=mine(common,owner.address);const zeroCoin=common.chain.at(-1).hash+':0';
 common=mine(common,owner.address);const feeCoin=common.chain.at(-1).hash+':0';
 const previous=cloneState(common);
 const incoming=acceptTxInto(previous,signed(owner,feeCoin,previous.utxos[feeCoin].amount_atoms,1000000n));
 let candidate=mine(common,other.address);
 let input=zeroCoin,firstId=null,lastId=null;
 for(let i=0;i<MAX_MEMPOOL_TXS;i++){
  const rec=acceptTxInto(candidate,signed(owner,input,candidate.utxos[zeroCoin].amount_atoms));
  if(!firstId)firstId=rec.txid;lastId=rec.txid;input=rec.txid+':0';
 }
 assert.ok(preferred(candidate,previous));
 assertPendingIndexes(candidate);assertPendingIndexes(previous);
 return{candidate,previous,incoming,firstId,lastId};
}
test('HPA-W2-R1: genuine higher-work fork plus 4096 pending zero-fee chain drops detached fee under default FIFO',()=>{
 const {candidate,previous,incoming}=scenario();
 const stateHash=stableStringify(candidate),old=stableStringify(previous);
 const dropped=reconcileDetachedTransactions(cloneState(candidate),cloneState(previous));
 assert.equal(dropped.reacceptedRecords.length,0);
 assert.equal(dropped.rejected,1);
 assert.equal(dropped.state.transactions[incoming.txid],undefined);
 assert.equal(stableStringify(candidate),stateHash);
 assert.equal(stableStringify(previous),old);
});
test('HPA-W2-R2: bounded candidate recovers source-signed detached high fee without mutating either original valid fork',()=>{
 const {candidate,previous,incoming,lastId}=scenario();
 const sourceHash=stableStringify(candidate),previousHash=stableStringify(previous);
 const result=recoverDetachedFeeAware(candidate,previous);
 assert.equal(result.disposition,'isolated_fee_aware_reorg_candidate_only');
 assert.equal(result.state.transactions[incoming.txid]?.fee_atoms,'1000000');
 assert.equal(result.state.transactions[lastId],undefined);
 assert.ok(result.evicted.includes(lastId));
 assert.equal(result.reacceptedRecords.length,1);
 assert.equal(result.rejected,0);
 assert.equal(result.state.mempoolOrder.length,MAX_MEMPOOL_TXS);
 assert.deepEqual(result.state.chain.map(x=>x.hash),candidate.chain.map(x=>x.hash));
 assertPendingIndexes(result.state);
 assert.equal(stableStringify(candidate),sourceHash);
 assert.equal(stableStringify(previous),previousHash);
});
test('HPA-W2-R3: reject nonpreferred branch and invalid continuation bounds fail closed',()=>{
 const {candidate,previous}=scenario(),a=stableStringify(candidate),b=stableStringify(previous);
 assert.throws(()=>recoverDetachedFeeAware(previous,candidate),e=>e.code==='nonpreferred_reorg');
 for(const n of [0,-1,4097,NaN])assert.throws(
  ()=>recoverDetachedFeeAware(candidate,previous,{maxAttempts:n}),
  e=>e.code==='invalid_recovery_bound');
 assert.equal(stableStringify(candidate),a);
 assert.equal(stableStringify(previous),b);
});
