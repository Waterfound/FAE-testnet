/**
 * HPA-UC-001 / HP-05 — real FAE core candidate-only single-miner fee settlement.
 * A separate fee-credit-only opt-in must NOT activate PPLNS or change v4 defaults.
 * Uses authentic Ed25519 transfers, frozen canonical v4 history, mined PoW and
 * actual appendBlockFromSubmission; no mock node or consensus substitution.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {generateKeyPairSync, sign} from 'node:crypto';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createAuthoritativeV4PeerNode} from '../../sovereign-forge/node/authoritative/fae-v4-peer-node.mjs';
import {legacyBlocks} from '../../sovereign-forge/tests/legacy-testnet-fixture.mjs';
import {
  NETWORK,emptyState,appendBlockFromFeed,appendBlockFromSubmission,
  createMiningTemplate,acceptTxInto,txPayload,expectedReward,issued
} from '../../sovereign-forge/node/authoritative/fae-v4-core.mjs';
import {stableStringify} from '../../sovereign-forge/node/authoritative/canonical.mjs';
import {hashHex,leadingZeroBits,sha256} from '../../sovereign-forge/node/authoritative/crypto.mjs';
import {encodeAddress} from '../../sovereign-forge/node/authoritative/address.mjs';
import {PPLNS_COINBASE_ACTIVATION_HEIGHT} from '../../sovereign-forge/node/authoritative/pplns-activation.mjs';

function wallet(){
  const {privateKey,publicKey}=generateKeyPairSync('ed25519');
  const key=publicKey.export({format:'der',type:'spki'});
  return {privateKey,pub:key.toString('base64'),address:encodeAddress(sha256(key).subarray(0,20),'faet')};
}
function paidTx(owner,input,amount,fee){
  const raw={version:2,network:NETWORK,inputs:[input],
    outputs:[{address:owner.address,amount_atoms:(BigInt(amount)-BigInt(fee)).toString()}],
    public_key_spki:owner.pub};
  const signature=sign(null,Buffer.from(stableStringify(txPayload({...raw,signature:''}))),owner.privateKey).toString('base64');
  return {...raw,signature};
}
function frozen(){
  let state=emptyState();
  for(const b of legacyBlocks)state=appendBlockFromFeed(state,b,new Map(),{activationHeight:null});
  return state;
}
function solve(header,{limit=8_000_000}={}){
  for(let nonce=0;nonce<limit;nonce++){
    const hash=hashHex({...header,nonce});
    if(leadingZeroBits(hash)>=header.difficulty_bits)return {nonce,hash};
  }
  throw new Error('bounded authentic PoW search exhausted');
}
function mine(state,address,{feeCreditActivationHeight=null}={}){
  const opts={activationHeight:null,feeCreditActivationHeight};
  const template=createMiningTemplate(state,address,opts);
  const {nonce,hash}=solve(template.header);
  const submission={header:template.header,nonce,hash,txids:template.txids,
    ...(template.coinbase_outputs?{coinbase_outputs:template.coinbase_outputs}:{})};
  const next=appendBlockFromSubmission(state,submission,opts);
  return {template,next,hash,submission};
}
function fixture(){
  const owner=wallet(),miner=wallet();let state=frozen();
  state=mine(state,owner.address).next;
  const input=state.chain.at(-1).hash+':0';
  const fee=250000n;
  const tx=acceptTxInto(state,paidTx(owner,input,state.utxos[input].amount_atoms,fee));
  assert.equal(tx.fee_atoms,fee.toString());
  return {state,miner,tx,fee};
}
function unspent(s){return Object.values(s.utxos).reduce((n,u)=>n+(u.spent?0n:BigInt(u.amount_atoms)),0n)}

test('HP05-FC-01 source control: v4 fee remains uncredited with both activations absent',()=>{
  const {state,miner,fee}=fixture(),before=unspent(state);
  assert.equal(PPLNS_COINBASE_ACTIVATION_HEIGHT,null);
  const {template,next,hash}=mine(state,miner.address);
  assert.equal(template.header.fee_atoms,undefined);
  assert.equal(template.coinbase_outputs,undefined);
  assert.equal(next.utxos[hash+':0'].amount_atoms,expectedReward(state,state.chain.length+1).toString());
  assert.equal(unspent(next)-before,expectedReward(state,state.chain.length+1)-fee);
});

test('HP05-FC-02 RED→GREEN: fee-only shadow pays exactly actual signed fee without PPLNS',()=>{
  const {state,miner,fee,tx}=fixture(),height=state.chain.length+1;
  const priorIssued=issued(state),priorUnspent=unspent(state),subsidy=expectedReward(state,height);
  const {template,next,hash}=mine(state,miner.address,{feeCreditActivationHeight:height});
  assert.ok(template.txids.includes(tx.txid));
  assert.equal(template.header.coinbase_mode,'direct');
  assert.equal(template.header.fee_atoms,fee.toString());
  assert.deepEqual(template.coinbase_outputs,[{address:miner.address,amount_atoms:(subsidy+fee).toString()}]);
  assert.equal(next.utxos[hash+':0'].amount_atoms,(subsidy+fee).toString());
  assert.equal(issued(next)-priorIssued,subsidy,'fees transfer existing atoms; they never mint new subsidy');
  assert.equal(unspent(next)-priorUnspent,subsidy,'valid fee is conserved and credited');
});

test('HP05-FC-03 negative: exact-PoW miner fee overcredit fails without state mutation',()=>{
  const {state,miner}=fixture(),height=state.chain.length+1,opts={activationHeight:null,feeCreditActivationHeight:height};
  const t=createMiningTemplate(state,miner.address,opts);
  assert.ok(Array.isArray(t.coinbase_outputs),'fee-only shadow must exist');
  const before=stableStringify(state),fee=BigInt(t.header.fee_atoms)+1n;
  const outputs=[{address:miner.address,amount_atoms:(BigInt(t.header.reward_atoms)+fee).toString()}];
  const header={...t.header,fee_atoms:fee.toString(),coinbase_root:hashHex(outputs)};
  const proof=solve(header);
  assert.throws(()=>appendBlockFromSubmission(state,{header,...proof,txids:t.txids,coinbase_outputs:outputs},opts));
  assert.equal(stableStringify(state),before);
});

test('HP05-FC-04 negative: fee-only activation cannot enable split/PPLNS outputs',()=>{
  const {state,miner}=fixture(),height=state.chain.length+1,opts={activationHeight:null,feeCreditActivationHeight:height};
  const t=createMiningTemplate(state,miner.address,opts);
  assert.equal(t.header.coinbase_mode,'direct');
  const before=stableStringify(state),header={...t.header,coinbase_mode:'pplns-direct'};
  const proof=solve(header);
  assert.throws(()=>appendBlockFromSubmission(state,{header,...proof,txids:t.txids,coinbase_outputs:t.coinbase_outputs},opts),/fee_credit_requires_direct_coinbase/);
  assert.equal(stableStringify(state),before);
});

test('HP05-FC-05 fee from a confirmed block cannot be paid again in a subsequent empty block',()=>{
  const {state,miner,fee}=fixture(),height=state.chain.length+1;
  const first=mine(state,miner.address,{feeCreditActivationHeight:height});
  const second=mine(first.next,miner.address,{feeCreditActivationHeight:height});
  assert.equal(first.template.header.fee_atoms,fee.toString());
  assert.deepEqual(second.template.txids,[]);
  assert.equal(second.template.header.fee_atoms,'0');
  assert.equal(second.next.utxos[second.hash+':0'].amount_atoms,expectedReward(first.next,height+1).toString());
});


test('HP05-FC-06 valid fee settlement replays from genuine source feed; pre-activation replay fails closed',()=>{
  const {state,miner,tx,fee}=fixture(),height=state.chain.length+1;
  const opts={activationHeight:null,feeCreditActivationHeight:height},before=stableStringify(state);
  const mined=mine(state,miner.address,{feeCreditActivationHeight:height});
  const block=mined.next.chain.at(-1),authenticatedTx=new Map([[tx.txid,structuredClone(state.transactions[tx.txid])]]);
  const recovered=appendBlockFromFeed(state,block,authenticatedTx,opts);
  assert.equal(stableStringify(recovered),stableStringify(mined.next),'feed replay must reconstruct exactly the same canonical state');
  assert.equal(recovered.utxos[mined.hash+':0'].amount_atoms,
    (expectedReward(state,height)+fee).toString());
  assert.throws(()=>appendBlockFromFeed(state,block,authenticatedTx,
    {activationHeight:null,feeCreditActivationHeight:null}),/premature_coinbase_v1_fields/);
  assert.equal(stableStringify(state),before,'replay and rejected reactivation must not mutate source');
});

test('HP05-FC-07 mutually exclusive same-parent valid forks credit fee only to respective canonical candidate',()=>{
  const {state,miner,tx,fee}=fixture(),rival=wallet(),height=state.chain.length+1,subsidy=expectedReward(state,height);
  const original=stableStringify(state);
  const one=mine(state,miner.address,{feeCreditActivationHeight:height});
  const two=mine(state,rival.address,{feeCreditActivationHeight:height});
  assert.notEqual(one.hash,two.hash,'distinct destination generates distinct valid PoW block');
  assert.equal(one.next.utxos[one.hash+':0'].address,miner.address);
  assert.equal(two.next.utxos[two.hash+':0'].address,rival.address);
  assert.equal(one.next.utxos[one.hash+':0'].amount_atoms,(subsidy+fee).toString());
  assert.equal(two.next.utxos[two.hash+':0'].amount_atoms,(subsidy+fee).toString());
  assert.equal(one.next.transactions[tx.txid].status,'confirmed');
  assert.equal(two.next.transactions[tx.txid].status,'confirmed');
  assert.equal(one.next.utxos[two.hash+':0'],undefined,'different noncanonical fork cannot pay into selected branch');
  assert.equal(two.next.utxos[one.hash+':0'],undefined);
  assert.equal(stableStringify(state),original);
  // This tests fork-local monetary integrity, not winner selection or the peer reorg protocol.
});


test('HP05-FC-08: actual HTTP peer fee-only mined block survives disk restart; default peer refuses it',async()=>{
  const {state,miner,tx,fee}=fixture(),height=state.chain.length+1,subsidy=expectedReward(state,height);
  const tempDir=await mkdtemp(join(tmpdir(),'fae-hp05-shadow-')),dataFile=join(tempDir,'node.json');
  let peer=null,restarted=null;
  try{
    peer=createAuthoritativeV4PeerNode({
      host:'127.0.0.1',port:0,dataFile,initialState:state,syncIntervalMs:0,
      activationHeight:null,feeCreditActivationHeight:height
    });
    await peer.start();
    const url=peer.baseUrl();
    const response=await fetch(url+'/template?address='+encodeURIComponent(miner.address));
    assert.equal(response.status,200);
    const template=await response.json();
    assert.ok(template.txids.includes(tx.txid));
    assert.equal(template.header.fee_atoms,fee.toString(),'actual HTTP peer must supply fee-paying template');
    assert.equal(template.header.coinbase_mode,'direct');
    assert.equal(template.coinbase_outputs[0].amount_atoms,(subsidy+fee).toString());
    const {nonce,hash}=solve(template.header);
    const accepted=await fetch(url+'/submit-block',{method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({header:template.header,nonce,hash,txids:template.txids,coinbase_outputs:template.coinbase_outputs})});
    assert.equal(accepted.status,200,'source HTTP node must accept real PoW block with exact fee settlement');
    const balance=await fetch(url+'/balance?address='+encodeURIComponent(miner.address)).then(x=>x.json());
    assert.equal(balance.balance_atoms,(subsidy+fee).toString());
    await peer.close();peer=null;

    restarted=createAuthoritativeV4PeerNode({host:'127.0.0.1',port:0,dataFile,syncIntervalMs:0,
      activationHeight:null,feeCreditActivationHeight:height});
    await restarted.start();
    const balanceAfter=await fetch(restarted.baseUrl()+'/balance?address='+encodeURIComponent(miner.address)).then(x=>x.json());
    assert.equal(balanceAfter.balance_atoms,(subsidy+fee).toString());
    await restarted.close();restarted=null;

    const defaultPeer=createAuthoritativeV4PeerNode({host:'127.0.0.1',port:0,dataFile,syncIntervalMs:0});
    await assert.rejects(defaultPeer.start(),/premature_coinbase_v1_fields/,
      'default v4 must not silently accept an opt-in fee-credit chain');
    await defaultPeer.close().catch(()=>{});
  }finally{
    if(peer)await peer.close().catch(()=>{});
    if(restarted)await restarted.close().catch(()=>{});
    await rm(tempDir,{recursive:true,force:true});
  }
});
