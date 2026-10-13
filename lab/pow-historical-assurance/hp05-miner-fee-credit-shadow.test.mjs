/**
 * HPA-UC-001 / HP-05 — real FAE core candidate-only single-miner fee settlement.
 * A separate fee-credit-only opt-in must NOT activate PPLNS or change v4 defaults.
 * Uses authentic Ed25519 transfers, frozen canonical v4 history, mined PoW and
 * actual appendBlockFromSubmission; no mock node or consensus substitution.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {generateKeyPairSync, sign} from 'node:crypto';
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
