import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign as signBytes} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createAuthoritativeV4PeerNode} from '../../sovereign-forge/node/authoritative/fae-v4-peer-node.mjs';
import {NETWORK,MAX_MEMPOOL_TXS,emptyState,appendBlockFromFeed,
 createMiningTemplate,appendBlockFromSubmission,acceptTxInto,cloneState,
 reconcileDetachedTransactions,preferred,txPayload} from '../../sovereign-forge/node/authoritative/fae-v4-core.mjs';
import {legacyBlocks} from '../../sovereign-forge/tests/legacy-testnet-fixture.mjs';
import {stableStringify} from '../../sovereign-forge/node/authoritative/canonical.mjs';
import {sha256,hashHex,leadingZeroBits} from '../../sovereign-forge/node/authoritative/crypto.mjs';
import {encodeAddress} from '../../sovereign-forge/node/authoritative/address.mjs';
import {assertPendingIndexes,simulateFeeAwareAdmission} from './mempool-fee-aware-shadow-candidate.mjs';
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

test('HPA-W2-R4: authenticated higher-work peer sync uses explicit bounded reorg recovery and persists exact state',async t=>{
 const {candidate,previous,incoming,lastId}=scenario();
 const dir=await mkdtemp(join(tmpdir(),'fae-hpa-reorg-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const mainFile=join(dir,'main-state.json'),identityFile=join(dir,'main-identity.json');
 let invoked=0;
 const local=createAuthoritativeV4PeerNode({initialState:previous,dataFile:mainFile,
   identityFile,candidateReorgRecovery:(fork,old)=>{
     invoked++;
     return recoverDetachedFeeAware(fork,old);
   }});
 const remote=createAuthoritativeV4PeerNode({initialState:candidate,candidateTxAdmission:simulateFeeAwareAdmission});
 await local.start();await remote.start();
 try{
  const before=local.getState().chain.at(-1).hash;
  const outcome=await local.syncPeer(remote.baseUrl());
  assert.equal(outcome.adopted,true);
  assert.equal(invoked,1,'the source-owned guarded callback must be reached');
  assert.notEqual(local.getState().chain.at(-1).hash,before);
  assert.equal(local.getState().chain.at(-1).hash,candidate.chain.at(-1).hash);
  assert.equal(local.getState().transactions[incoming.txid]?.fee_atoms,'1000000');
  assertPendingIndexes(local.getState());
  assert.equal(outcome.reaccepted,1,'one authentic detached high-fee transaction recovered');
  assert.equal(outcome.repropagated,1,'authenticated sender must repropagate to saturated opt-in peer');
  const receiver=remote.getState();
  assertPendingIndexes(receiver);
  assert.equal(receiver.mempoolOrder.length,MAX_MEMPOOL_TXS,'receiver never exceeds source mempool bound');
  assert.equal(receiver.transactions[incoming.txid]?.fee_atoms,'1000000','second full-pool peer received the exact signed transaction');
  assert.equal(receiver.transactions[lastId],undefined,'full receiving mempool evicts a lower-fee leaf');
  assert.deepEqual(receiver.chain.map(b=>b.hash),candidate.chain.map(b=>b.hash),'receiver validated chain remains immutable during encrypted transaction relay');
 }finally{await local.close();await remote.close()}
 const cold=createAuthoritativeV4PeerNode({dataFile:mainFile,identityFile});
 await cold.start();
 try{
   assert.equal(cold.getState().transactions[incoming.txid]?.fee_atoms,'1000000');
   assert.equal(cold.getState().chain.at(-1).hash,candidate.chain.at(-1).hash);
 }finally{await cold.close()}
});
test('HPA-W2-R5: authenticated reorg rejects a malicious callback that swaps validated chain identity',async t=>{
 const {candidate,previous}=scenario();
 const local=createAuthoritativeV4PeerNode({initialState:previous,
   candidateReorgRecovery:()=>({state:cloneState(previous),reacceptedRecords:[],rejected:0})});
 const remote=createAuthoritativeV4PeerNode({initialState:candidate});
 await local.start();await remote.start();
 t.after(()=>Promise.all([local.close(),remote.close()]));
 const original=stableStringify(local.getState());
 await assert.rejects(local.syncPeer(remote.baseUrl()),/candidate_reorg_chain_mutation/);
 assert.equal(stableStringify(local.getState()),original,'malicious candidate must never alter local persisted state');
});

test('HPA-W2-R6: full-pool default remote refuses detached repropagation; local recovered tip and tx remain valid',async t=>{
 const {candidate,previous,incoming}=scenario();
 const local=createAuthoritativeV4PeerNode({initialState:previous,candidateReorgRecovery:recoverDetachedFeeAware});
 const unchangedDefault=createAuthoritativeV4PeerNode({initialState:candidate});
 await local.start();await unchangedDefault.start();
 t.after(()=>Promise.all([local.close(),unchangedDefault.close()]));
 const result=await local.syncPeer(unchangedDefault.baseUrl());
 assert.equal(result.adopted,true);
 assert.equal(result.reaccepted,1);
 assert.equal(result.repropagated,0,'default full-pool peer must reject without opt-in');
 const remote=unchangedDefault.getState();
 assert.equal(remote.transactions[incoming.txid],undefined);
 assert.equal(remote.mempoolOrder.length,MAX_MEMPOOL_TXS);
 assert.deepEqual(remote.chain.map(x=>x.hash),candidate.chain.map(x=>x.hash));
 assert.equal(local.getState().transactions[incoming.txid]?.status,'pending',
   'remote rejection does not roll back a legitimate local preferred-chain adoption');
 assertPendingIndexes(remote);
 assertPendingIndexes(local.getState());
});

test('HPA-W2-R7: duplicate callback records fail before adoption or relay amplification',async t=>{
 const {candidate,previous}=scenario();
 const local=createAuthoritativeV4PeerNode({initialState:previous,
   candidateReorgRecovery:(fork,old)=>{
     const recovered=recoverDetachedFeeAware(fork,old),record=recovered.reacceptedRecords[0];
     return {...recovered,reacceptedRecords:[record,record]};
   }});
 const remote=createAuthoritativeV4PeerNode({initialState:candidate});
 await local.start();await remote.start();
 t.after(()=>Promise.all([local.close(),remote.close()]));
 const before=stableStringify(local.getState());
 await assert.rejects(local.syncPeer(remote.baseUrl()),/candidate_reorg_duplicate_reacceptance/);
 assert.equal(stableStringify(local.getState()),before,'duplicate callback result cannot adopt or mutate state');
});

test('HPA-W2-R8: final dropped count includes a FIFO reacceptance later evicted by fee-aware recovery',()=>{
 const owner=wallet(),other=wallet();
 let common=emptyState();
 for(const block of legacyBlocks)common=appendBlockFromFeed(common,block,new Map(),{activationHeight:null});
 common=mine(common,owner.address);const chainCoin=common.chain.at(-1).hash+':0';
 common=mine(common,owner.address);const lowCoin=common.chain.at(-1).hash+':0';
 common=mine(common,owner.address);const highCoin=common.chain.at(-1).hash+':0';
 const previous=cloneState(common);
 const low=acceptTxInto(previous,signed(owner,lowCoin,previous.utxos[lowCoin].amount_atoms,1n));
 const high=acceptTxInto(previous,signed(owner,highCoin,previous.utxos[highCoin].amount_atoms,1000000n));
 let candidate=mine(common,other.address),input=chainCoin,atoms=BigInt(candidate.utxos[chainCoin].amount_atoms);
 for(let i=0;i<MAX_MEMPOOL_TXS-1;i++){
  const rec=acceptTxInto(candidate,signed(owner,input,atoms,100n));
  input=rec.txid+':0';atoms-=100n;
 }
 const fifo=reconcileDetachedTransactions(cloneState(candidate),cloneState(previous));
 assert.equal(fifo.reacceptedRecords.length,1);
 assert.equal(fifo.reacceptedRecords[0].txid,low.txid);
 assert.equal(fifo.rejected,1);
 const result=recoverDetachedFeeAware(candidate,previous);
 assert.equal(result.state.transactions[low.txid],undefined,'low-fee FIFO reacceptance is the cheapest eviction');
 assert.equal(result.state.transactions[high.txid]?.status,'pending');
 assert.deepEqual(result.reacceptedRecords.map(x=>x.txid),[high.txid]);
 assert.equal(result.rejected,1,'one of two detached transactions remains dropped in the final state');
 assert.equal(result.reacceptedRecords.length+result.rejected,2,'final accounting conserves detached records');
 assertPendingIndexes(result.state);
});
