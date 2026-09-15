import assert from 'node:assert/strict';
import {
  ACTIVATION_STATE_TRANSITION_STATUS,CANDIDATE_COINBASE_MATURITY_BLOCKS,
  freezeStateTransitionPolicy,coinbaseMaturityForCreationHeight,replayTransition,
  connectTransitionBlock,transitionStateDigest,walletTransitionView,
  reconcileTransitionMempool,reorgTransition
} from '../node/authoritative/activation-state-transition-candidate.mjs';

const policy=freezeStateTransitionPolicy({activationHeight:4});
const cb=(address,amount='100')=>[{address,amount_atoms:amount}];
const block=(height,hash,address,transactions=[])=>({height,hash,coinbase_outputs:cb(address),transactions});
const tx=(txid,input,address,amount,mempool_seq=undefined)=>({txid,inputs:[input],outputs:[{address,amount_atoms:String(amount)}],...(mempool_seq===undefined?{}:{mempool_seq})});

assert.equal(ACTIVATION_STATE_TRANSITION_STATUS,'candidate-not-active-consensus');
assert.equal(CANDIDATE_COINBASE_MATURITY_BLOCKS,200);
assert.equal(coinbaseMaturityForCreationHeight(2,policy),0);
assert.equal(coinbaseMaturityForCreationHeight(3,policy),0);
assert.equal(coinbaseMaturityForCreationHeight(4,policy),200);
assert.equal(coinbaseMaturityForCreationHeight(5,policy),200);
assert.equal(coinbaseMaturityForCreationHeight(6,policy),200);

const b1=block(1,'h1','legacy-1');
const b2=block(2,'h2','legacy-2');
const b3=block(3,'h3','legacy-3');
const txA=tx('tx-a','h3:coinbase:0','alice','90',1);
const b4a=block(4,'h4a','candidate-4-a',[txA]);
const txB=tx('tx-b','tx-a:0','bob','80',2);
const b5a=block(5,'h5a','candidate-5-a',[txB]);
const b6a=block(6,'h6a','candidate-6-a');

const state6=replayTransition([b1,b2,b3,b4a,b5a,b6a],policy);
assert.equal(state6.height,6);
assert.equal(state6.transactions['tx-a'].status,'confirmed');
assert.equal(state6.transactions['tx-b'].status,'confirmed');

const candidateWallet=walletTransitionView(state6,'candidate-4-a',policy,{spendHeight:7});
assert.equal(candidateWallet.confirmed_atoms,'100');
assert.equal(candidateWallet.spendable_atoms,'0');
assert.equal(candidateWallet.immature_coinbase_atoms,'100');

const immatureSpend=tx('tx-immature','h4a:coinbase:0','eve','99');
assert.throws(()=>connectTransitionBlock(replayTransition([b1,b2,b3,b4a],policy),block(5,'h5-immature','candidate-5-x',[immatureSpend]),policy),/immature_coinbase/);

// Exact candidate maturity boundary: a coinbase created at H=4 becomes spendable
// at spend height 204 when candidate maturity is 200 blocks.
const maturityChain=[b1,b2,b3,b4a];
for(let height=5;height<=203;height++)maturityChain.push(block(height,`fill-${height}`,`fill-miner-${height}`));
const matureTx=tx('tx-mature','h4a:coinbase:0','mature-recipient','99');
maturityChain.push(block(204,'h204','candidate-204',[matureTx]));
const matureState=replayTransition(maturityChain,policy);
assert.equal(matureState.transactions['tx-mature'].confirmed_height,204);

// Restart/full replay must reconstruct exactly the same state digest.
const serialized=JSON.stringify([b1,b2,b3,b4a,b5a,b6a]);
const restarted=replayTransition(JSON.parse(serialized),policy);
assert.equal(transitionStateDigest(restarted),transitionStateDigest(state6));

// Pending dependency chains are deterministic and may spend earlier mempool outputs.
const base3=replayTransition([b1,b2,b3],policy);
const mem1=tx('mem-1','h1:coinbase:0','pending-1','90',10);
const mem2=tx('mem-2','mem-1:0','pending-2','80',11);
const mempool=reconcileTransitionMempool(base3,[mem2,mem1],policy,{spendHeight:4});
assert.deepEqual(mempool.accepted.map(row=>row.txid),['mem-1','mem-2']);
assert.equal(mempool.dropped.length,0);

// Reorg across activation: old branch spends the H-1 legacy coinbase through a
// two-transaction chain. The replacement branch spends that same input first,
// so both disconnected transactions must fail deterministic re-entry while an
// unrelated pre-existing mempool transaction survives.
const txC=tx('tx-c','h3:coinbase:0','carol','85',1);
const b4b=block(4,'h4b','candidate-4-b',[txC]);
const b5b=block(5,'h5b','candidate-5-b');
const existing=tx('mem-survivor','h2:coinbase:0','dave','95',50);
const reorg=reorgTransition({prefix:[b1,b2,b3],oldBranch:[b4a,b5a],newBranch:[b4b,b5b],existingMempool:[existing]},policy);
assert.deepEqual(reorg.disconnected_txids,['tx-a','tx-b']);
assert.deepEqual(reorg.reentered_txids,[]);
assert.deepEqual(reorg.mempool.accepted.map(row=>row.txid),['mem-survivor']);
assert.ok(reorg.mempool.dropped.some(row=>row.txid==='tx-a'&&row.reason.includes('missing_or_spent_input')));
assert.ok(reorg.mempool.dropped.some(row=>row.txid==='tx-b'&&row.reason.includes('missing_or_spent_input')));
assert.notEqual(reorg.old_digest,reorg.new_digest);

console.log(JSON.stringify({
  status:'PASS',worker:'B',candidate_only:true,activation_height:policy.activation_height,
  candidate_coinbase_maturity_blocks:policy.candidate_coinbase_maturity_blocks,
  boundary_window:['H-2','H-1','H','H+1','H+2'],restart_replay:true,
  wallet_maturity:true,mempool_dependency_replay:true,reorg_conflict_reconciliation:true
}));
