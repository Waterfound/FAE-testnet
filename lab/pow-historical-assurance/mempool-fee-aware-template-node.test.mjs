/**
 * HPA-UC-001 W2 — exact source-owned opt-in mining-template rehearsal.
 * No production policy, consensus, economics or active testnet mutation.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign as signBytes} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {NETWORK,emptyState,txPayload,acceptTxInto,appendBlockFromFeed,
  createMiningTemplate,appendBlockFromSubmission} from '../../sovereign-forge/node/authoritative/fae-v4-core.mjs';
import {legacyBlocks} from '../../sovereign-forge/tests/legacy-testnet-fixture.mjs';
import {createAuthoritativeV4PeerNode,verifyPersistedState} from '../../sovereign-forge/node/authoritative/fae-v4-peer-node.mjs';
import {selectFeeSensitiveTemplateCandidate} from './mempool-fee-aware-shadow-candidate.mjs';
import {stableStringify} from '../../sovereign-forge/node/authoritative/canonical.mjs';
import {hashHex,leadingZeroBits,sha256} from '../../sovereign-forge/node/authoritative/crypto.mjs';
import {encodeAddress} from '../../sovereign-forge/node/authoritative/address.mjs';
const wallet=()=>{
  const {privateKey,publicKey}=generateKeyPairSync('ed25519');
  const pub=publicKey.export({format:'der',type:'spki'});
  return {privateKey,key:pub.toString('base64'),address:encodeAddress(sha256(pub).subarray(0,20),'faet')};
};
function signed(w,input,amount,fee=0n){
  const tx={version:2,network:NETWORK,inputs:[input],
    outputs:[{address:w.address,amount_atoms:(BigInt(amount)-fee).toString()}],public_key_spki:w.key};
  return {...tx,signature:signBytes(null,Buffer.from(stableStringify(txPayload({...tx,signature:''}))),w.privateKey).toString('base64')};
}
function found(header){
  for(let nonce=0;nonce<8_000_000;nonce++){
    const hash=hashHex({...header,nonce});
    if(leadingZeroBits(hash)>=header.difficulty_bits)return {nonce,hash};
  }
  throw new Error('bounded nonce exhausted');
}
function mine(state,address){
  const template=createMiningTemplate(state,address);
  const {nonce,hash}=found(template.header);
  return appendBlockFromSubmission(state,{header:template.header,nonce,hash,txids:template.txids});
}
function startingState(){
  const owner=wallet();let state=emptyState();
  for(const block of legacyBlocks)state=appendBlockFromFeed(state,block,new Map(),{activationHeight:null});
  state=mine(state,owner.address);
  const a=state.chain.at(-1).hash+':0';
  state=mine(state,owner.address);
  const b=state.chain.at(-1).hash+':0';
  const amountA=state.utxos[a].amount_atoms,amountB=state.utxos[b].amount_atoms;
  const parent=acceptTxInto(state,signed(owner,a,amountA,0n));
  const unrelated=acceptTxInto(state,signed(owner,b,amountB,2000n));
  const child=acceptTxInto(state,signed(owner,parent.txid+':0',amountA,1000000n));
  return {state,owner,parent,unrelated,child};
}
async function request(peer,path,options={}){
  const response=await fetch(peer.baseUrl()+path,options);
  return {status:response.status,body:await response.json()};
}
test('HPA-W2-T1 real opt-in template prioritizes ancestor+high-fee child and mines a valid block; default remains FIFO',async t=>{
  const {state,owner,parent,unrelated,child}=startingState();
  const path='/template?address='+encodeURIComponent(owner.address);
  const dir=await mkdtemp(join(tmpdir(),'fae-hpa-w2-template-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const candidate=createAuthoritativeV4PeerNode({initialState:state,
    candidateTemplateSelection:selectFeeSensitiveTemplateCandidate,
    dataFile:join(dir,'state.json'),identityFile:join(dir,'identity.json')});
  const normal=createAuthoritativeV4PeerNode({initialState:state});
  await candidate.start();await normal.start();
  try{
    const original=stableStringify(candidate.getState());
    const defaultTemplate=await request(normal,path),selected=await request(candidate,path);
    assert.equal(defaultTemplate.status,200);
    assert.equal(selected.status,200);
    assert.equal(defaultTemplate.body.template_policy,'snapshot');
    assert.deepEqual(defaultTemplate.body.txids,[parent.txid,unrelated.txid,child.txid],
      'default authoritative miner still uses its original FIFO selection');
    assert.equal(selected.body.template_policy,'fee_sensitive_explicit_candidate');
    assert.deepEqual(selected.body.txids,[parent.txid,child.txid,unrelated.txid],
      'higher aggregate-fee ancestor package is selected before independent lower fee');
    assert.equal(stableStringify(candidate.getState()),original,'candidate template computation cannot mutate peer state');
    const {nonce,hash}=found(selected.body.header);
    const response=await request(candidate,'/submit-block',{method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({header:selected.body.header,nonce,hash,txids:selected.body.txids})});
    assert.equal(response.status,200,JSON.stringify(response.body));
    assert.equal(response.body.tx_count,3);
    const next=candidate.getState();
    for(const rec of [parent,child,unrelated])
      assert.equal(next.transactions[rec.txid]?.status,'confirmed');
    assert.equal(next.chain.at(-1).hash,hash);
    assert.equal(verifyPersistedState(JSON.parse(await readFile(join(dir,'state.json'),'utf8'))).chain.at(-1).hash,hash);
  }finally{await candidate.close();await normal.close()}
  const cold=createAuthoritativeV4PeerNode({dataFile:join(dir,'state.json'),identityFile:join(dir,'identity.json')});
  await cold.start();try{assert.equal(cold.getState().mempoolOrder.length,0)}finally{await cold.close()}
});
test('HPA-W2-T2 hostile candidate selector cannot bypass parent ordering or invent pending txids',async t=>{
  const {state,owner,parent,child}=startingState(),original=stableStringify(state);
  const hostile=[()=>({txids:[child.txid,parent.txid]}),()=>({txids:['f'.repeat(64)]})];
  for(const choose of hostile){
    const peer=createAuthoritativeV4PeerNode({initialState:state,candidateTemplateSelection:choose});
    await peer.start();
    try{
      const response=await request(peer,'/template?address='+encodeURIComponent(owner.address));
      assert.equal(response.status,400);
      assert.ok(['candidate_template_missing_parent','candidate_template_unknown_pending'].includes(response.body.error));
      assert.equal(stableStringify(peer.getState()),original);
    }finally{await peer.close()}
  }
});
