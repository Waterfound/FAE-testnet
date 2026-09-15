import assert from 'node:assert/strict';
import {generateKeyPairSync,sign as nodeSign} from 'node:crypto';
import {encodeAddress} from '../node/authoritative/address.mjs';
import {hashHex,leadingZeroBits,sha256} from '../node/authoritative/crypto.mjs';
import {stableStringify} from '../node/authoritative/canonical.mjs';
import {
  NETWORK,
  emptyState,
  createMiningTemplate,
  appendBlockFromSubmission
} from '../node/authoritative/fae-v4-core.mjs';
import {
  ACTIVATION_STATE_TRANSITION_STATUS,
  DEFAULT_COINBASE_MATURITY_BLOCKS,
  freezeStateTransitionPolicy,
  coinbaseMaturityVerdict,
  spendableOutputsWithMaturity,
  walletViewWithMaturity,
  acceptTxIntoWithMaturity,
  reconcileDetachedTransactionsWithMaturity
} from '../node/authoritative/activation-state-transition-candidate.mjs';

const NO_PPLNS_ACTIVATION=Number.MAX_SAFE_INTEGER;
const H=4;
const policy=freezeStateTransitionPolicy({activationHeight:H,coinbaseMaturityBlocks:2});

function wallet(){
  const{privateKey,publicKey}=generateKeyPairSync('ed25519');
  const spki=publicKey.export({type:'spki',format:'der'});
  return{privateKey,pub:spki.toString('base64'),address:encodeAddress(sha256(spki).subarray(0,20),'faet')};
}
function signedTx(from,inputs,outputs){
  const unsigned={version:2,network:NETWORK,inputs,outputs,public_key_spki:from.pub};
  const payload={domain:'FAIRYELF_TX_V2',network:NETWORK,inputs,outputs,public_key_spki:from.pub};
  const signature=nodeSign(null,Buffer.from(stableStringify(payload)),from.privateKey).toString('base64');
  return{...unsigned,signature};
}
function mine(header){
  for(let nonce=0;nonce<10_000_000;nonce++){
    const hash=hashHex({...header,nonce});
    if(leadingZeroBits(hash)>=header.difficulty_bits)return{nonce,hash};
  }
  throw new Error('pow_search_exhausted');
}
function mineNext(state,address){
  const template=createMiningTemplate(state,address,{activationHeight:NO_PPLNS_ACTIVATION});
  const pow=mine(template.header);
  return appendBlockFromSubmission(state,{header:template.header,nonce:pow.nonce,hash:pow.hash,txids:template.txids},{activationHeight:NO_PPLNS_ACTIVATION});
}

assert.equal(ACTIVATION_STATE_TRANSITION_STATUS,'candidate-not-active-consensus');
assert.equal(policy.activation_height,H);
assert.equal(policy.coinbase_maturity_blocks,2);

const alice=wallet(),bob=wallet(),carol=wallet(),miner=wallet();
let state=emptyState();

// Height 1: Alice's coinbase exists but is not spendable in block 2 under the
// candidate maturity rule. Wallet balance and wallet spendability must diverge.
state=mineNext(state,alice.address);
const coinbase1=`${state.chain[0].hash}:0`;
let view=walletViewWithMaturity(state,alice.address,{policy});
assert.equal(view.spend_height,2);
assert.equal(view.confirmed_balance_atoms,'1000000000');
assert.equal(view.confirmed_spendable_atoms,'0');
assert.equal(view.immature_coinbase_atoms,'1000000000');
assert.equal(spendableOutputsWithMaturity(state,alice.address,{policy}).length,0);

const premature=signedTx(alice,[coinbase1],[
  {address:bob.address,amount_atoms:'100000000'},
  {address:alice.address,amount_atoms:'899999000'}
]);
assert.throws(
  ()=>acceptTxIntoWithMaturity(state,premature,{policy}),
  error=>error?.code==='immature_coinbase'&&error?.outpoint===coinbase1
);

// Height 2: coinbase #1 becomes spendable for block 3 while the height-2
// coinbase remains immature. This proves exact maturity-boundary behavior.
state=mineNext(state,miner.address);
const snapshotHMinus2=structuredClone(state);
view=walletViewWithMaturity(state,alice.address,{policy});
assert.equal(view.spend_height,3);
assert.equal(view.confirmed_spendable_atoms,'1000000000');
assert.equal(view.immature_coinbase_atoms,'0');
assert.equal(coinbaseMaturityVerdict(state,coinbase1,{spendHeight:3,policy}).confirmations_before_spend,2);

// Height 3 = H-1: confirm a transaction funded by a matured coinbase.
const tx1=signedTx(alice,[coinbase1],[
  {address:bob.address,amount_atoms:'100000000'},
  {address:alice.address,amount_atoms:'899999000'}
]);
const accepted1=acceptTxIntoWithMaturity(state,tx1,{policy});
const tx1id=accepted1.txid;
state=mineNext(state,miner.address);
assert.equal(state.transactions[tx1id].confirmed_height,H-1);
assert.equal(state.transactions[tx1id].status,'confirmed');

// A child transaction created at H-1 spends ordinary transaction change and is
// confirmed in H. State/mempool/UTXO semantics therefore cross activation.
const tx2=signedTx(alice,[`${tx1id}:1`],[
  {address:carol.address,amount_atoms:'200000000'},
  {address:alice.address,amount_atoms:'699998000'}
]);
const accepted2=acceptTxIntoWithMaturity(state,tx2,{policy});
const tx2id=accepted2.txid;
assert.equal(state.transactions[tx2id].status,'pending');
assert.ok(state.mempoolOrder.includes(tx2id));
state=mineNext(state,miner.address);
assert.equal(state.chain.at(-1).height,H);
assert.equal(state.transactions[tx2id].confirmed_height,H);
assert.equal(state.transactions[tx2id].status,'confirmed');
assert.equal(state.utxos[`${tx1id}:1`].spent_by,tx2id);
assert.equal(state.utxos[`${tx2id}:1`].spent,false);

// Restart from serialized state must preserve wallet/UTXO interpretation exactly.
const restarted=JSON.parse(JSON.stringify(state));
assert.deepEqual(
  walletViewWithMaturity(restarted,alice.address,{policy}),
  walletViewWithMaturity(state,alice.address,{policy})
);
const mainAtH=structuredClone(state);

// Reorg from H back to H-2, then rebuild an alternate H-1/H branch without the
// two transactions. Detached parent+child must re-enter the mempool in dependency
// order: tx1 first creates a pending output, tx2 then consumes it.
let alternate=structuredClone(snapshotHMinus2);
alternate=mineNext(alternate,miner.address);
alternate=mineNext(alternate,miner.address);
assert.equal(alternate.chain.at(-1).height,H);
const reconciled=reconcileDetachedTransactionsWithMaturity(alternate,mainAtH,{policy});
assert.equal(reconciled.rejected,0);
assert.deepEqual(reconciled.reacceptedRecords.map(record=>record.txid),[tx1id,tx2id]);
assert.equal(reconciled.state.transactions[tx1id].status,'pending');
assert.equal(reconciled.state.transactions[tx2id].status,'pending');
assert.equal(reconciled.state.mempoolSpends[coinbase1],tx1id);
assert.equal(reconciled.state.mempoolSpends[`${tx1id}:1`],tx2id);

// If the alternate branch legitimately spends the same mature coinbase first,
// the detached parent and child must fail closed rather than be resurrected.
let conflicting=structuredClone(snapshotHMinus2);
const conflictTx=signedTx(alice,[coinbase1],[
  {address:carol.address,amount_atoms:'300000000'},
  {address:alice.address,amount_atoms:'699999000'}
]);
acceptTxIntoWithMaturity(conflicting,conflictTx,{policy});
conflicting=mineNext(conflicting,miner.address);
conflicting=mineNext(conflicting,miner.address);
const conflictReconcile=reconcileDetachedTransactionsWithMaturity(conflicting,mainAtH,{policy});
assert.equal(conflictReconcile.reacceptedRecords.length,0);
assert.equal(conflictReconcile.rejected,2);
assert.deepEqual(new Set(conflictReconcile.rejectedRecords.map(row=>row.txid)),new Set([tx1id,tx2id]));

// Freeze the preferred 200-block maturity as a candidate default without mining
// 200 blocks or changing authoritative consensus. A height-1 coinbase is not
// spendable in block 200 (age 199), and is spendable in block 201 (age 200).
const defaultPolicy=freezeStateTransitionPolicy({activationHeight:H});
assert.equal(defaultPolicy.coinbase_maturity_blocks,DEFAULT_COINBASE_MATURITY_BLOCKS);
assert.equal(DEFAULT_COINBASE_MATURITY_BLOCKS,200);
const syntheticHash='a'.repeat(64);
const synthetic={chain:[{height:1,hash:syntheticHash}],transactions:{},utxos:{[`${syntheticHash}:0`]:{outpoint:`${syntheticHash}:0`,address:alice.address,amount_atoms:'1',created_height:1,spent:false}},mempoolSpends:{},mempoolOutputs:{},mempoolOrder:[]};
assert.equal(coinbaseMaturityVerdict(synthetic,`${syntheticHash}:0`,{spendHeight:200,policy:defaultPolicy}).ok,false);
assert.equal(coinbaseMaturityVerdict(synthetic,`${syntheticHash}:0`,{spendHeight:201,policy:defaultPolicy}).ok,true);

console.log(JSON.stringify({
  status:'PASS',
  authority:'candidate-not-active-consensus',
  activation_height:H,
  candidate_coinbase_maturity_blocks:DEFAULT_COINBASE_MATURITY_BLOCKS,
  h_minus_1_parent_confirmed:true,
  h_child_confirmed:true,
  restart_wallet_parity:true,
  detached_parent_child_reaccepted:true,
  conflicting_detached_fail_closed:true
}));
