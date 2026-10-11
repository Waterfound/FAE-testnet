/**
 * HPA-UC-001 / W2 — real authoritative peer-state cold-restart rehearsal.
 *
 * All execution is local and ephemeral. The production peer's HTTP ingress and
 * consensus code remain UNCHANGED. Fee-aware admission is performed explicitly
 * against a clone, then installed only through the existing test-owned,
 * replay-validating replaceState method.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign as signBytes} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  NETWORK,MAX_MEMPOOL_TXS,emptyState,createMiningTemplate,appendBlockFromSubmission,
  acceptTxInto,txPayload
} from '../../sovereign-forge/node/authoritative/fae-v4-core.mjs';
import {createAuthoritativeV4PeerNode,verifyPersistedState}
  from '../../sovereign-forge/node/authoritative/fae-v4-peer-node.mjs';
import {stableStringify} from '../../sovereign-forge/node/authoritative/canonical.mjs';
import {hashHex,leadingZeroBits,sha256} from '../../sovereign-forge/node/authoritative/crypto.mjs';
import {encodeAddress} from '../../sovereign-forge/node/authoritative/address.mjs';
import {simulateFeeAwareAdmission,assertPendingIndexes}
  from './mempool-fee-aware-shadow-candidate.mjs';

function wallet(){
  const {privateKey,publicKey}=generateKeyPairSync('ed25519');
  const spki=publicKey.export({format:'der',type:'spki'});
  return {privateKey,pub:spki.toString('base64'),address:encodeAddress(sha256(spki).subarray(0,20),'faet')};
}
function signTx(w,input,amount,fee=0n){
  const raw={version:2,network:NETWORK,inputs:[input],
    outputs:[{address:w.address,amount_atoms:(BigInt(amount)-fee).toString()}],public_key_spki:w.pub};
  return {...raw,signature:signBytes(null,Buffer.from(stableStringify(txPayload({...raw,signature:''}))),w.privateKey).toString('base64')};
}
function mine(state,address){
  const template=createMiningTemplate(state,address),bits=template.header.difficulty_bits;
  for(let nonce=0;nonce<8_000_000;nonce++){
    const hash=hashHex({...template.header,nonce});
    if(leadingZeroBits(hash)>=bits)
      return appendBlockFromSubmission(state,{header:template.header,nonce,hash,txids:template.txids});
  }
  throw new Error('HPA_SHADOW_MINING_BUDGET_EXHAUSTED');
}
async function request(peer,path,options={}){
  const response=await fetch(peer.baseUrl()+path,options);
  return {status:response.status,body:await response.json()};
}
test('HPA-W2 cold process: real chain, 4096 signed chain, guarded fee admission, restart and negative persisted replay',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'fae-hpa-w2-restart-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const file=join(dir,'isolated-state.json'),idFile=join(dir,'isolated-identity.json');
  const w=wallet();let chain=emptyState();
  chain=mine(chain,w.address);const first=chain.chain.at(-1).hash+':0';
  chain=mine(chain,w.address);const second=chain.chain.at(-1).hash+':0';
  const amount=chain.utxos[first].amount_atoms,otherAmount=chain.utxos[second].amount_atoms;
  let input=first;
  for(let i=0;i<MAX_MEMPOOL_TXS;i++){
    const record=acceptTxInto(chain,signTx(w,input,amount));
    input=record.txid+':0';
  }
  assertPendingIndexes(chain);
  let peer=createAuthoritativeV4PeerNode({initialState:chain,dataFile:file,identityFile:idFile});
  await peer.start();
  try{
    assert.equal((await request(peer,'/status')).body.mempool_size,MAX_MEMPOOL_TXS);
    const incoming=signTx(w,second,otherAmount,1000000n),before=stableStringify(peer.getState());
    const rejected=await request(peer,'/submit-tx',{method:'POST',
      headers:{'content-type':'application/json'},body:JSON.stringify({tx:incoming})});
    assert.equal(rejected.status,400);
    assert.equal(rejected.body.error,'mempool_full');
    assert.equal(stableStringify(peer.getState()),before);
    const trial=simulateFeeAwareAdmission(peer.getState(),incoming);
    assert.equal(trial.decision,'admitted_after_shadow_eviction');
    assert.equal(trial.evicted.length,1);
    assert.equal(stableStringify(peer.getState()),before,'admission policy must not mutate live HTTP peer');
    await peer.replaceState(trial.state); // Existing test-only replay-validating method.
    const after=peer.getState();
    assertPendingIndexes(after);
    assert.equal(after.mempoolOrder.length,MAX_MEMPOOL_TXS);
    assert.equal(after.transactions[trial.admitted].fee_atoms,'1000000');
    assert.equal((await request(peer,'/status')).body.mempool_size,MAX_MEMPOOL_TXS);
    const baselineTemplate=await request(peer,'/template?address='+encodeURIComponent(w.address));
    assert.equal(baselineTemplate.status,200);
    assert.ok(!baselineTemplate.body.txids.includes(trial.admitted),
      'production FIFO remains unchanged: candidate is NOT a live fee-sensitive template');
    const persisted=JSON.parse(await readFile(file,'utf8'));
    const audited=verifyPersistedState(persisted);
    assertPendingIndexes(audited);
    assert.equal(audited.transactions[trial.admitted].status,'pending');
    const corrupt=structuredClone(after);
    corrupt.transactions[trial.admitted].signature='AA==';
    const frozen=stableStringify(peer.getState());
    await assert.rejects(peer.replaceState(corrupt));
    assert.equal(stableStringify(peer.getState()),frozen,'rejecting invalid replay must not commit partial state');
  }finally{await peer.close();}
  peer=createAuthoritativeV4PeerNode({dataFile:file,identityFile:idFile});
  await peer.start();
  try{
    const restarted=peer.getState();assertPendingIndexes(restarted);
    assert.equal(restarted.mempoolOrder.length,MAX_MEMPOOL_TXS);
    assert.equal(restarted.transactions[restarted.mempoolOrder.at(-1)].fee_atoms,'1000000');
    assert.equal((await request(peer,'/status')).body.mempool_size,MAX_MEMPOOL_TXS);
  }finally{await peer.close();}
});
