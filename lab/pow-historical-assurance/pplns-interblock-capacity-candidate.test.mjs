import test from 'node:test';
import assert from 'node:assert/strict';
import {ShareLedger} from '../../sovereign-forge/node/authoritative/share-coordinator.mjs';
import {encodeAddress} from '../../sovereign-forge/node/authoritative/address.mjs';
import {MAX_COINBASE_OUTPUTS,PPLNS_COINBASE_ACTIVATION_HEIGHT}
  from '../../sovereign-forge/node/authoritative/pplns-activation.mjs';
import {minimumDirectCoverageBlocks,simulateDirectAtomRounds}
  from './pplns-interblock-capacity-candidate.mjs';

function sourceWindow(n){
  const ledger=new ShareLedger({windowSize:2048});
  const addresses=[];
  for(let i=0;i<n;i++){
    const bytes=Buffer.alloc(20);
    bytes.writeUInt16BE(i+1,18);
    const address=encodeAddress(bytes,'faet');
    addresses.push(address);
    ledger.append({jobId:'HPA-W3-110-'+i,address,nonce:i,hash:'0'.repeat(64),
      shareDifficultyBits:4,blockDifficultyBits:8,height:1,
      previousBlockHash:'0'.repeat(64)});
  }
  return {ledger,weights:ledger.weights(addresses[0])};
}
const nCases=[1,2,3,10,100,256,257,1024,2048];

test('HPA-W3-110: real ShareLedger 2048-share window and source 256-output cap yield necessary multi-block limits',()=>{
  assert.equal(MAX_COINBASE_OUTPUTS,256);
  assert.equal(PPLNS_COINBASE_ACTIVATION_HEIGHT,null);
  for(const n of nCases){
    const {ledger,weights}=sourceWindow(n);
    assert.equal(weights.length,n);
    assert.equal(ledger.summary().totalShares,n);
    const one=minimumDirectCoverageBlocks({
      beneficiaries:n,rewardAtomsPerBlock:'1'});
    assert.equal(one.minimum_blocks_to_touch_every_payee,n);
    const full=minimumDirectCoverageBlocks({
      beneficiaries:n,rewardAtomsPerBlock:'256'});
    assert.equal(full.minimum_blocks_to_touch_every_payee,Math.ceil(n/256));
    assert.equal(full.guaranteed_future_payment,false);
    assert.equal(full.guaranteed_non_custodial_entitlement,false);
    if(n>256)assert.ok(full.minimum_blocks_to_touch_every_payee>=2);
  }
});
test('HPA-W3-111: zero-subsidy future era has no guaranteed positive-output coverage without verified fees',()=>{
  for(const n of nCases){
    const zero=minimumDirectCoverageBlocks({
      beneficiaries:n,rewardAtomsPerBlock:0n});
    assert.equal(zero.per_block_positive_atom_capacity,0);
    assert.equal(zero.minimum_blocks_to_touch_every_payee,null);
    assert.equal(zero.requires_positive_canonical_rewards,false);
  }
});
test('HPA-W3-112: exact-BigInt one-atom hypothetical rounds conserve value and eventually touch all source payees',()=>{
  for(const n of nCases){
    const {ledger,weights}=sourceWindow(n);
    const before=ledger.summary();
    const model=simulateDirectAtomRounds({
      weights,rewardAtomsPerBlock:'1',blocks:n});
    assert.equal(model.rounds.length,n);
    assert.equal(model.paid.length,n);
    assert.equal(model.total_atoms,String(n));
    assert.equal(model.paid.reduce((s,p)=>s+BigInt(p.amount_atoms),0n),BigInt(n));
    assert.ok(model.paid.every(p=>p.amount_atoms==='1'),
      'conditional equal-weight full-horizon model eventually touches all payees');
    assert.ok(model.rounds.every(r=>r.length===1&&r[0].amount_atoms==='1'));
    assert.deepEqual(ledger.summary(),before,'candidate model cannot credit or alter source shares');
    assert.equal(model.sybil_resistant,false);
    assert.equal(model.policy_activated,false);
  }
});
test('HPA-W3-113: one candidate block cannot directly pay 257–2048 addresses even with 256 subsidy atoms',()=>{
  for(const n of [257,1024,2048]){
    const {weights}=sourceWindow(n);
    const one=simulateDirectAtomRounds({
      weights,rewardAtomsPerBlock:'256',blocks:1});
    assert.equal(one.rounds[0].length,256);
    assert.equal(one.paid.filter(p=>p.amount_atoms!=='0').length,256);
    assert.equal(one.total_atoms,'256');
    assert.equal(one.guaranteed_future_payment,false);
  }
});
test('HPA-W3-114: stable equal source weights need at least eight 256-atom rounds for 2048 direct payees',()=>{
  const {weights}=sourceWindow(2048);
  const model=simulateDirectAtomRounds({
    weights,rewardAtomsPerBlock:'256',blocks:8});
  assert.equal(model.rounds.length,8);
  assert.ok(model.rounds.every(r=>r.length===256));
  assert.ok(model.paid.every(p=>p.amount_atoms==='1'));
  assert.equal(model.total_atoms,'2048');
});
test('HPA-W3-115: source unequal weights are conserved across blocks, not forced into fake equal obligations',()=>{
  const {weights}=sourceWindow(2);
  const weighted=[{...weights[0],weight:2n},{...weights[1],weight:1n}];
  const model=simulateDirectAtomRounds({
    weights:weighted,rewardAtomsPerBlock:1n,blocks:3});
  assert.equal(model.total_atoms,'3');
  assert.deepEqual(model.paid.map(p=>p.amount_atoms),['2','1']);
});
test('HPA-W3-116: public deterministic tie order allows first-atom address selection; NOT Sybil proof',()=>{
  const {weights}=sourceWindow(3);
  const s=[...weights].sort((a,b)=>a.address.localeCompare(b.address));
  const first=simulateDirectAtomRounds({
    weights:s,rewardAtomsPerBlock:1n,blocks:1});
  assert.equal(first.rounds[0][0].address,s[0].address);
  assert.notEqual(first.rounds[0][0].address,s[2].address);
  assert.equal(first.sybil_resistant,false);
  assert.equal(first.tip_independent_but_address_order_sensitive,true);
});
test('HPA-W3-117: a reorg discards hypothetical previous coinbase outputs; a past model receipt is not a future on-chain claim',()=>{
  const {weights}=sourceWindow(3);
  const before=simulateDirectAtomRounds({
    weights,rewardAtomsPerBlock:1n,blocks:3});
  const replay=simulateDirectAtomRounds({
    weights,rewardAtomsPerBlock:1n,blocks:2});
  assert.deepEqual(before.rounds.slice(0,2),replay.rounds);
  assert.notDeepEqual(before.paid,replay.paid);
  assert.equal(replay.guaranteed_future_payment,false);
  assert.equal(replay.guaranteed_non_custodial_entitlement,false);
});
test('HPA-W3-118: malformed, overbudget and duplicated payout model inputs fail closed',()=>{
  const {weights}=sourceWindow(2);
  assert.throws(()=>minimumDirectCoverageBlocks({
    beneficiaries:2049,rewardAtomsPerBlock:'1'}),/invalid_interblock_coverage_inputs/);
  assert.throws(()=>minimumDirectCoverageBlocks({
    beneficiaries:257,rewardAtomsPerBlock:1.5}),/invalid_interblock_coverage_inputs/);
  assert.throws(()=>simulateDirectAtomRounds({
    weights,rewardAtomsPerBlock:'257',blocks:1}),/invalid_interblock_simulation_inputs/);
  assert.throws(()=>simulateDirectAtomRounds({
    weights:[weights[0],weights[0]],rewardAtomsPerBlock:'1',blocks:1}),/duplicate_interblock_payee/);
  assert.throws(()=>simulateDirectAtomRounds({
    weights,rewardAtomsPerBlock:0n,blocks:1}),/invalid_interblock_simulation_inputs/);
  // 2048 * 256 * 100 potential deficit comparisons exceed candidate CPU ceiling.
  const {weights:many}=sourceWindow(2048);
  assert.throws(()=>simulateDirectAtomRounds({
    weights:many,rewardAtomsPerBlock:'256',blocks:100}),
    /interblock_simulation_work_budget_exceeded/);
});

test('HPA-W3-119: source-valid two-share identity splitting gains one atom in a three-block deficit horizon',()=>{
  const {weights}=sourceWindow(4);
  const [honest,unsplit,splitA,splitB]=weights;
  const baseline=simulateDirectAtomRounds({
    weights:[{address:honest.address,weight:2n},{address:unsplit.address,weight:2n}],
    rewardAtomsPerBlock:1n,blocks:3
  });
  const split=simulateDirectAtomRounds({
    weights:[{address:honest.address,weight:2n},
      {address:splitA.address,weight:1n},{address:splitB.address,weight:1n}],
    rewardAtomsPerBlock:1n,blocks:3
  });
  const baselineAttacker=BigInt(baseline.paid.find(p=>p.address===unsplit.address).amount_atoms);
  const splitAttacker=split.paid.filter(p=>p.address!==honest.address)
    .reduce((s,p)=>s+BigInt(p.amount_atoms),0n);
  assert.equal(baselineAttacker,1n);
  assert.equal(splitAttacker,2n);
  assert.equal(splitAttacker-baselineAttacker,1n);
  assert.equal(split.total_atoms,baseline.total_atoms);
  assert.equal(split.sybil_resistant,false);
  assert.equal(split.guaranteed_non_custodial_entitlement,false);
});

test('HPA-W3-120: the demonstrated identity-splitting edge is horizon-dependent, not infinite profit',()=>{
  const {weights}=sourceWindow(4);
  const [honest,unsplit,splitA,splitB]=weights;
  const baseline=simulateDirectAtomRounds({
    weights:[{address:honest.address,weight:2n},{address:unsplit.address,weight:2n}],
    rewardAtomsPerBlock:1n,blocks:4
  });
  const split=simulateDirectAtomRounds({
    weights:[{address:honest.address,weight:2n},
      {address:splitA.address,weight:1n},{address:splitB.address,weight:1n}],
    rewardAtomsPerBlock:1n,blocks:4
  });
  assert.equal(baseline.paid.find(p=>p.address===unsplit.address).amount_atoms,'2');
  assert.equal(split.paid.filter(p=>p.address!==honest.address)
    .reduce((s,p)=>s+BigInt(p.amount_atoms),0n),2n);
  assert.equal(baseline.total_atoms,split.total_atoms);
});

test('HPA-W3-121: identity split is realizable as distinct accepted source ShareLedger shares',()=>{
  const {weights}=sourceWindow(4);
  const [honest,unsplit,splitA,splitB]=weights;
  const mkLedger=(addresses)=>{
    const ledger=new ShareLedger({windowSize:2048});
    addresses.forEach((address,i)=>ledger.append({
      jobId:'HPA-W3-121-'+i,address,nonce:i,hash:'0'.repeat(64),
      shareDifficultyBits:4,blockDifficultyBits:8,height:1,
      previousBlockHash:'0'.repeat(64)
    }));
    return ledger;
  };
  const baselineLedger=mkLedger([honest.address,honest.address,unsplit.address,unsplit.address]);
  const splitLedger=mkLedger([honest.address,honest.address,splitA.address,splitB.address]);
  assert.deepEqual(baselineLedger.weights(honest.address).map(w=>w.weight),[2n,2n]);
  assert.deepEqual(splitLedger.weights(honest.address).map(w=>w.weight),[2n,1n,1n]);
  const baseline=simulateDirectAtomRounds({
    weights:baselineLedger.weights(honest.address),rewardAtomsPerBlock:1n,blocks:3
  });
  const split=simulateDirectAtomRounds({
    weights:splitLedger.weights(honest.address),rewardAtomsPerBlock:1n,blocks:3
  });
  assert.equal(BigInt(baseline.paid.find(p=>p.address===unsplit.address).amount_atoms),1n);
  assert.equal(split.paid.filter(p=>p.address!==honest.address)
    .reduce((s,p)=>s+BigInt(p.amount_atoms),0n),2n);
  assert.equal(baselineLedger.summary().totalShares,splitLedger.summary().totalShares);
  assert.equal(baseline.guaranteed_future_payment,false);
  assert.equal(split.policy_activated,false);
});
