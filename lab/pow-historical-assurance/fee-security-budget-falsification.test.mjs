/**
 * HPA-UC-001 — source-derived, NEGATIVE assurance for current v4 fee incentives.
 * Candidate-only test; makes no change to testnet node, consensus, fee schedule,
 * mainnet or pool/PPLNS activation. Proof scope: exact current-v4 code snapshot.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {generateKeyPairSync,sign as signBytes} from 'node:crypto';
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
function signTx(w,input,amount,fee){
  const raw={version:2,network:NETWORK,inputs:[input],
    outputs:[{address:w.address,amount_atoms:(BigInt(amount)-BigInt(fee)).toString()}],public_key_spki:w.pub};
  const sig=signBytes(null,Buffer.from(stableStringify(txPayload({...raw,signature:''}))),w.privateKey).toString('base64');
  return {...raw,signature:sig};
}
function frozenHistory(){
  let state=emptyState();
  for(const b of legacyBlocks)state=appendBlockFromFeed(state,b,new Map(),{activationHeight:null});
  assert.equal(state.chain.length,legacyBlocks.length);
  return state;
}
function mine(state,address,{activationHeight=null}={}){
  const template=createMiningTemplate(state,address,{activationHeight});
  for(let nonce=0;nonce<8_000_000;nonce++){
    const hash=hashHex({...template.header,nonce});
    if(leadingZeroBits(hash)>=template.header.difficulty_bits){
      const submission={header:template.header,nonce,hash,txids:template.txids,
        ...(template.coinbase_outputs?{coinbase_outputs:template.coinbase_outputs}:{})};
      const next=appendBlockFromSubmission(state,submission,{activationHeight});
      return {template,next,hash,submission};
    }
  }
  throw new Error('PoW bounded search exhausted');
}
function unspentAtoms(s){return Object.values(s.utxos).reduce((sum,u)=>sum+(u.spent?0n:BigInt(u.amount_atoms)),0n)}
function setupFee(){
  const walletOwner=wallet(),miner=wallet();let state=frozenHistory();
  state=mine(state,walletOwner.address).next;
  const original=state.chain.at(-1).hash+':0',sum=state.utxos[original].amount_atoms;
  const tx=acceptTxInto(state,signTx(walletOwner,original,sum,250000n));
  assert.equal(tx.fee_atoms,'250000');
  return {state,tx,walletOwner,miner};
}
test('HPA-ECON-C1: current unactivated v4 confirms paid fee without miner coinbase fee payout',()=>{
  assert.equal(PPLNS_COINBASE_ACTIVATION_HEIGHT,null,'source default must be inactive');
  const {state,tx,miner}=setupFee();
  const subsidy=expectedReward(state,state.chain.length+1),beforeIssued=issued(state),beforeUnspent=unspentAtoms(state);
  const {template,next,hash}=mine(state,miner.address);
  assert.ok(template.txids.includes(tx.txid));
  assert.equal(template.header.reward_atoms,subsidy.toString());
  assert.equal(template.header.fee_atoms,undefined,'no fee commitment pre-activation');
  assert.equal(template.coinbase_outputs,undefined,'no fee-paying coinbase pre-activation');
  assert.equal(next.transactions[tx.txid].status,'confirmed');
  assert.equal(next.utxos[hash+':0'].amount_atoms,subsidy.toString());
  assert.equal(issued(next)-beforeIssued,subsidy);
  assert.equal(unspentAtoms(next)-beforeUnspent,subsidy-250000n,
    'fee is removed from spendable value, not credited to miner pre-activation');
  assert.notEqual(next.utxos[hash+':0'].amount_atoms,(subsidy+250000n).toString());
});
test('HPA-ECON-C2: tested activation override restores fee payout without issuance inflation (NOT live)',()=>{
  const {state,tx,miner}=setupFee(),height=state.chain.length+1;
  const subsidy=expectedReward(state,height),beforeIssued=issued(state),beforeUnspent=unspentAtoms(state);
  const {template,next,hash}=mine(state,miner.address,{activationHeight:height});
  assert.ok(template.txids.includes(tx.txid));
  assert.equal(template.header.fee_atoms,'250000');
  assert.equal(template.header.coinbase_mode,'direct');
  assert.equal(template.coinbase_outputs.length,1);
  assert.equal(template.coinbase_outputs[0].amount_atoms,(subsidy+250000n).toString());
  assert.equal(next.utxos[hash+':0'].amount_atoms,(subsidy+250000n).toString());
  assert.equal(issued(next)-beforeIssued,subsidy,'fees are transfers, not monetary issuance');
  assert.equal(unspentAtoms(next)-beforeUnspent,subsidy,'miner recaptures fee under isolated explicit activation');
});
test('HPA-ECON-C3: premature fee-paying coinbase is rejected without changing source state',()=>{
  const {state,miner}=setupFee();
  const {submission}=mine(state,miner.address);
  const before=stableStringify(state);
  const hostile={...submission,header:{...submission.header,fee_atoms:'250000'}};
  assert.throws(()=>appendBlockFromSubmission(state,hostile,{activationHeight:null}),
    /premature_coinbase_v1_fields/);
  assert.equal(stableStringify(state),before,'no money-supply or state mutation on rejected claim');
});

function solveForgedHeader(header,{limit=8_000_000}={}){
  for(let nonce=0;nonce<limit;nonce++){
    const hash=hashHex({...header,nonce});
    if(leadingZeroBits(hash)>=Number(header.difficulty_bits))
      return {header,nonce,hash};
  }
  throw new Error('adversarial PoW search exhausted');
}
test('HPA-ECON-C4: confirming a paid-fee block on unchanged v4 never grants miner that fee now or in the next empty block',()=>{
  const {state,tx,miner}=setupFee();
  const first=mine(state,miner.address);
  assert.ok(first.template.txids.includes(tx.txid));
  assert.equal(first.next.utxos[first.hash+':0'].amount_atoms,
    expectedReward(state,state.chain.length+1).toString());
  const second=mine(first.next,miner.address);
  assert.deepEqual(second.template.txids,[]);
  assert.equal(second.template.header.fee_atoms,undefined);
  assert.equal(second.next.utxos[second.hash+':0'].amount_atoms,
    expectedReward(first.next,first.next.chain.length+1).toString());
  assert.equal(second.next.transactions[tx.txid].status,'confirmed');
  assert.equal(PPLNS_COINBASE_ACTIVATION_HEIGHT,null);
});
test('HPA-ECON-C5: independently mined overpaying fee-coinbase with matching fake header/root is rejected by source verifier',()=>{
  const {state,miner}=setupFee(),height=state.chain.length+1,
    t=createMiningTemplate(state,miner.address,{activationHeight:height}),
    before=stableStringify(state);
  const extra=1n, claimed=BigInt(t.header.fee_atoms)+extra;
  const forgedOutputs=[{address:miner.address,
    amount_atoms:(BigInt(t.header.reward_atoms)+claimed).toString()}];
  const forgedHeader={...t.header,fee_atoms:claimed.toString(),
    coinbase_root:hashHex(forgedOutputs)};
  const proof=solveForgedHeader(forgedHeader);
  assert.throws(()=>appendBlockFromSubmission(state,{
    ...proof,txids:t.txids,coinbase_outputs:forgedOutputs
  },{activationHeight:height}),/fee|coinbase|reward|invalid/i);
  assert.equal(stableStringify(state),before);
});
test('HPA-ECON-C6: authentic paid transaction replayed twice in one mined template cannot mint two fee payouts',()=>{
  const {state,tx,miner}=setupFee(),height=state.chain.length+1,
    t=createMiningTemplate(state,miner.address,{activationHeight:height}),
    before=stableStringify(state),doubleFee=BigInt(tx.fee_atoms)*2n,
    txids=[tx.txid,tx.txid];
  const outputs=[{address:miner.address,
    amount_atoms:(BigInt(t.header.reward_atoms)+doubleFee).toString()}];
  const forgedHeader={...t.header,tx_root:hashHex(txids),tx_count:2,
    fee_atoms:doubleFee.toString(),coinbase_root:hashHex(outputs)};
  const proof=solveForgedHeader(forgedHeader);
  assert.throws(()=>appendBlockFromSubmission(state,{
    ...proof,txids,coinbase_outputs:outputs
  },{activationHeight:height}));
  assert.equal(stableStringify(state),before);
  assert.equal(state.transactions[tx.txid].status,'pending');
});
