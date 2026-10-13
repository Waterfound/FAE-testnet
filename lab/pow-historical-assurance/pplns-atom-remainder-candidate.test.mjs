/**
 * HPA-W3-65..69: actual FAE PPLNS allocator finite-atom counterexamples,
 * bounded quantitative candidate alternative and explicit economics HOLD.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {ShareLedger,allocatePplnsOutputs} from '../../sovereign-forge/node/authoritative/share-coordinator.mjs';
import {encodeAddress} from '../../sovereign-forge/node/authoritative/address.mjs';
import {allocateLargestRemainderCandidate as alternative} from './pplns-atom-remainder-candidate.mjs';
import {legacyBlocks} from '../../sovereign-forge/tests/legacy-testnet-fixture.mjs';

function sourceWindow(){
  const ledger=new ShareLedger({windowSize:2048});
  const addresses=[11,22,33].map(n=>encodeAddress(Buffer.alloc(20,n),'faet')).sort();
  for(let i=0;i<3;i++)ledger.append({
    jobId:'rounding-source-'+i,address:addresses[i],nonce:i,
    hash:'0'.repeat(64),shareDifficultyBits:8,blockDifficultyBits:12,
    height:12,previousBlockHash:'a'.repeat(64)
  });
  return {ledger,addresses,weights:ledger.weights(addresses[0])};
}
function distribution(outputs){return new Map(outputs.map(x=>[x.address,BigInt(x.amount_atoms)]))}
function sum(outputs){return outputs.reduce((s,x)=>s+BigInt(x.amount_atoms),0n)}

test('HPA-W3-65: actual FAE allocator deterministically awards a one-atom round entirely to the last sorted address',()=>{
  const {addresses,weights}=sourceWindow();
  const payout=allocatePplnsOutputs(1n,weights);
  assert.equal(sum(payout),1n);
  assert.deepEqual(payout,[{address:addresses[2],amount_atoms:'1'}]);
  for(let i=0;i<40;i++)
    assert.deepEqual(allocatePplnsOutputs(1n,weights),payout);
  // No falsified assertion of a real current-v4 active PPLNS pool.
});

test('HPA-W3-66: cumulative source last-index remainder bias exceeds one atom in a bounded many-payee example',()=>{
  const {addresses,weights}=sourceWindow();
  // 2 atomic reward for 3 equal authentic shares: first two FLOOR to zero;
  // the last receives 2 atoms, twice its exact expected 2/3 entitlement.
  const payout=allocatePplnsOutputs(2n,weights);
  assert.deepEqual(payout,[{address:addresses[2],amount_atoms:'2'}]);
  assert.equal(sum(payout),2n);
  assert.equal(distribution(payout).get(addresses[0])??0n,0n);
});

test('HPA-W3-67: largest-remainder alternative conserves reward with <1-atom individual ideal allocation error',()=>{
  const {weights,addresses}=sourceWindow();
  for(const value of [0n,1n,2n,3n,4n,7n,1000n,100000001n]){
    const payouts=alternative(value,weights,{tipHash:'b'.repeat(64)});
    assert.equal(sum(payouts),value);
    const amounts=distribution(payouts);
    const totalWeight=weights.reduce((s,x)=>s+x.weight,0n);
    for(const w of weights){
      const allocated=amounts.get(w.address)??0n;
      const delta=(allocated*totalWeight)-(value*w.weight);
      assert.ok(delta>-totalWeight&&delta<totalWeight,
        'each candidate payout must lie within one atomic unit of entitlement');
    }
    assert.deepEqual([...amounts.keys()],addresses.filter(a=>amounts.has(a)));
  }
});

test('HPA-W3-68: bounded public tip seeds vary the remainder winner; original allocator has immutable last-address advantage',()=>{
  const {weights,addresses}=sourceWindow();
  const winners=new Set();
  for(let i=0;i<32;i++){
    const seed=i.toString(16).padStart(64,'0');
    const one=alternative(1n,weights,{tipHash:seed});
    assert.equal(sum(one),1n);
    winners.add(one[0].address);
    assert.equal(allocatePplnsOutputs(1n,weights)[0].address,addresses[2]);
    assert.deepEqual(alternative(1n,weights,{tipHash:seed}),one,
      'candidate must be deterministic for an exact source tip');
  }
  assert.ok(winners.size>=2,
    'tie-breaking with a varying public tip cannot always select the lexicographic last address');
});

test('HPA-W3-69: malformed weights, address spoofing, source-type coercion and absent external tip fail closed',()=>{
  const {weights}=sourceWindow();
  for(const [total,entries,tip] of [
    [-1n,weights,'a'.repeat(64)],
    [1,weights,'a'.repeat(64)],
    [1n,weights,'not-a-real-tip'],
    [1n,[{...weights[0],weight:0n}], 'a'.repeat(64)],
    [1n,[weights[0],weights[0]],'a'.repeat(64)],
    [1n,[{address:'not-an-address',weight:1n}],'a'.repeat(64)],
    [1n,[{...weights[0],weight:1.5}],'a'.repeat(64)]
  ]){
    assert.throws(()=>alternative(total,entries,{tipHash:tip}));
  }
  // Neither the original nor the alternative proves anti-Sybil economics.
  // Publicly known tie seeds could themselves create address-grinding incentives.
});

test('HPA-W3-80: under a PUBLIC recorded PoW tip, changing only an attacker payout address selects winner of one-atom tie',()=>{
  const tipHash=legacyBlocks[0].hash;
  assert.match(tipHash,/^[0-9a-f]{64}$/);
  const honest=encodeAddress(Buffer.alloc(20,96),'faet');
  let win=null,loss=null;
  for(let i=0;i<128;i++){
    const bytes=Buffer.alloc(20);bytes.writeUInt16BE(i+512,18);
    const attacker=encodeAddress(bytes,'faet');
    const weights=[{address:honest,weight:1n},{address:attacker,weight:1n}]
      .sort((a,b)=>a.address.localeCompare(b.address));
    const payout=alternative(1n,weights,{tipHash});
    assert.equal(sum(payout),1n);
    if(payout[0].address===attacker)win??=attacker;
    else loss??=attacker;
  }
  assert.ok(win&&loss,'public tie determinism allows a chooser to screen winning and losing payout identities');
  assert.notEqual(win,loss);
  // Conditional known-tip payout identity selection, NOT measured on-chain
  // address-grinding profitability or proof of active PPLNS exploitation.
});

test('HPA-W3-81: splitting the SAME two attacker shares into two addresses can improve their 3-atom largest-remainder payout',()=>{
  const honest=encodeAddress(Buffer.alloc(20,111),'faet');
  const attacker=encodeAddress(Buffer.alloc(20,112),'faet');
  const split1=encodeAddress(Buffer.alloc(20,113),'faet');
  const split2=encodeAddress(Buffer.alloc(20,114),'faet');
  const makeLedger=addresses=>{
    const ledger=new ShareLedger({windowSize:2048});
    addresses.forEach((address,i)=>ledger.append({
      jobId:'HPA-W3-81-share-'+i,address,nonce:i,
      hash:'0'.repeat(64),shareDifficultyBits:8,blockDifficultyBits:12,
      height:12,previousBlockHash:legacyBlocks.at(-1).hash
    }));
    return ledger;
  };
  const before=makeLedger([honest,honest,attacker,attacker]);
  const after=makeLedger([honest,honest,split1,split2]);
  assert.equal(before.summary().totalShares,after.summary().totalShares);
  const beforeWeights=before.weights(honest),afterWeights=after.weights(honest);
  assert.equal(beforeWeights.reduce((s,w)=>s+w.weight,0n),4n);
  assert.equal(afterWeights.reduce((s,w)=>s+w.weight,0n),4n);
  let counterexample=null;
  for(const block of legacyBlocks){
    const initial=distribution(alternative(3n,beforeWeights,{tipHash:block.hash}));
    const sybil=distribution(alternative(3n,afterWeights,{tipHash:block.hash}));
    const directAtoms=initial.get(attacker)??0n;
    const splitAtoms=(sybil.get(split1)??0n)+(sybil.get(split2)??0n);
    assert.equal(splitAtoms,2n,'split receives both largest individual remainders despite same source shares');
    assert.equal(sum(alternative(3n,afterWeights,{tipHash:block.hash})),3n);
    if(directAtoms===1n){
      counterexample={tip:block.hash,directAtoms,splitAtoms};
      break;
    }
  }
  assert.ok(counterexample,'an authentic recorded tip demonstrates +1 atom Sybil gain in isolated candidate');
  assert.equal(counterexample.splitAtoms-counterexample.directAtoms,1n);
  // Demonstrates conditional address-splitting incentive, not current-v4
  // pool activation, per-share profit, final identity policy or ASIC safety.
});
