import assert from 'node:assert/strict';
import {generateKeyPairSync,sign as nodeSign} from 'node:crypto';
import {stableStringify} from '../node/authoritative/canonical.mjs';
import {encodeAddress} from '../node/authoritative/address.mjs';
import {hashHex,leadingZeroBits,sha256} from '../node/authoritative/crypto.mjs';
import {
  NETWORK,emptyState,appendBlockFromFeed,createMiningTemplate,appendBlockFromSubmission,
  acceptTxInto,balanceAtoms,spendableOutputs
} from '../node/authoritative/fae-v4-core.mjs';
import {
  freezeStateTransitionPolicy,replayTransition,connectTransitionBlock,
  walletTransitionView,coinbaseMaturityForCreationHeight,CANDIDATE_COINBASE_MATURITY_BLOCKS
} from '../node/authoritative/activation-state-transition-candidate.mjs';
import {legacyBlocks} from './legacy-testnet-fixture.mjs';

const NO_PPLNS_ACTIVATION=Number.MAX_SAFE_INTEGER;
const H=13;
const policy=freezeStateTransitionPolicy({activationHeight:H});

function wallet(){
  const{privateKey,publicKey}=generateKeyPairSync('ed25519');
  const spki=publicKey.export({type:'spki',format:'der'});
  return{privateKey,pub:spki.toString('base64'),address:encodeAddress(sha256(spki).subarray(0,20),'faet')};
}
function signedTx(from,inputs,outputs){
  const unsigned={version:2,network:NETWORK,inputs,outputs,public_key_spki:from.pub};
  const payload={domain:'FAIRYELF_TX_V2',network:NETWORK,inputs,outputs,public_key_spki:from.pub};
  return{...unsigned,signature:nodeSign(null,Buffer.from(stableStringify(payload)),from.privateKey).toString('base64')};
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
  return appendBlockFromSubmission(
    state,
    {header:template.header,nonce:pow.nonce,hash:pow.hash,txids:template.txids,coinbase_outputs:template.coinbase_outputs??null},
    {activationHeight:NO_PPLNS_ACTIVATION}
  );
}
function oracleLegacyBlock(block){
  return{
    height:Number(block.height),hash:String(block.hash),
    coinbase_outputs:[{address:String(block.miner_address),amount_atoms:String(block.reward_atoms)}],
    transactions:[]
  };
}
function balancesFromCore(state){
  const result=new Map();
  for(const u of Object.values(state.utxos))if(!u.spent)result.set(u.address,(result.get(u.address)??0n)+BigInt(u.amount_atoms));
  return result;
}
function balancesFromOracle(state){
  const result=new Map();
  for(const u of Object.values(state.utxos))if(!u.spent_by)result.set(u.address,(result.get(u.address)??0n)+BigInt(u.amount_atoms));
  return result;
}
function mapStrings(map){return Object.fromEntries([...map.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,v.toString()]));}

assert.equal(CANDIDATE_COINBASE_MATURITY_BLOCKS,200);
assert.equal(coinbaseMaturityForCreationHeight(H-1,policy),0);
assert.equal(coinbaseMaturityForCreationHeight(H,policy),200);

// Reconstruct the exact immutable v4 H1-H11 history in the real core and in the
// Colony-B state oracle. Before activation, the oracle must not invent a state or
// economic difference merely because its outpoint serialization is different.
let core=emptyState();
const feedRecords=new Map();
for(const block of legacyBlocks)core=appendBlockFromFeed(core,structuredClone(block),feedRecords,{activationHeight:NO_PPLNS_ACTIVATION});
let oracle=replayTransition(legacyBlocks.map(oracleLegacyBlock),policy);
assert.equal(core.chain.length,11);assert.equal(oracle.height,11);
assert.deepEqual(mapStrings(balancesFromOracle(oracle)),mapStrings(balancesFromCore(core)));

const alice=wallet(),bob=wallet(),miner=wallet();

// Mine H12 in the real core, immediately before the candidate transition. Mirror
// the exact block hash/reward into B. H12 is legacy under the candidate policy.
core=mineNext(core,alice.address);
const h12=core.chain.at(-1);
oracle=connectTransitionBlock(oracle,{
  height:12,hash:h12.hash,coinbase_outputs:[{address:alice.address,amount_atoms:h12.reward_atoms}],transactions:[]
},policy);
assert.equal(coinbaseMaturityForCreationHeight(12,policy),0);
assert.equal(walletTransitionView(oracle,alice.address,policy,{spendHeight:13}).spendable_atoms,balanceAtoms(core,alice.address).toString());

// Spend the same H12 coinbase at H13 in both implementations. The real core uses
// hash:0 while the transition oracle deliberately namespaces coinbase outpoints as
// hash:coinbase:0; the economic state must still agree through the boundary.
const actualInput=`${h12.hash}:0`;
const mirrorInput=`${h12.hash}:coinbase:0`;
const raw=signedTx(alice,[actualInput],[
  {address:bob.address,amount_atoms:'100000000'},
  {address:alice.address,amount_atoms:'899999000'}
]);
const accepted=acceptTxInto(core,raw);
const mirrorTx={
  txid:accepted.txid,inputs:[mirrorInput],
  outputs:accepted.outputs.map(row=>({address:row.address,amount_atoms:String(row.amount_atoms)})),
  mempool_seq:accepted.mempool_seq
};
core=mineNext(core,miner.address);
const h13=core.chain.at(-1);
oracle=connectTransitionBlock(oracle,{
  height:13,hash:h13.hash,coinbase_outputs:[{address:miner.address,amount_atoms:h13.reward_atoms}],transactions:[mirrorTx]
},policy);

assert.equal(core.transactions[accepted.txid].status,'confirmed');
assert.equal(core.transactions[accepted.txid].confirmed_height,13);
assert.equal(oracle.transactions[accepted.txid].status,'confirmed');
assert.equal(oracle.transactions[accepted.txid].confirmed_height,13);
assert.equal(balanceAtoms(core,bob.address).toString(),walletTransitionView(oracle,bob.address,policy,{spendHeight:14}).confirmed_atoms);
assert.equal(balanceAtoms(core,alice.address).toString(),walletTransitionView(oracle,alice.address,policy,{spendHeight:14}).confirmed_atoms);

// The first intentional divergence occurs for the H13 coinbase itself: v4 remains
// immediately spendable, while the non-authoritative candidate transition freezes
// a 200-block maturity for coinbases created at/after H. This proves the oracle did
// not drift earlier than its declared version boundary.
const coreH13Spendable=spendableOutputs(core,miner.address).some(row=>row.outpoint===`${h13.hash}:0`);
const candidateMiner=walletTransitionView(oracle,miner.address,policy,{spendHeight:14});
assert.equal(coreH13Spendable,true);
assert.equal(candidateMiner.confirmed_atoms,h13.reward_atoms);
assert.equal(candidateMiner.spendable_atoms,'0');
assert.equal(candidateMiner.immature_coinbase_atoms,h13.reward_atoms);

console.log(JSON.stringify({
  status:'PASS',scope:'post-integration-differential',candidate_only:true,
  historical_core_oracle_balance_parity:true,
  h_minus_1_coinbase_spend_parity:true,
  h_transaction_confirmation_parity:true,
  first_intentional_divergence:'H coinbase maturity',
  candidate_coinbase_maturity_blocks:CANDIDATE_COINBASE_MATURITY_BLOCKS,
  authoritative_core_unchanged:true
}));
