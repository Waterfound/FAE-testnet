/** HPA-UC-001 W3: source-owned guard and exact ShareLedger BWH counterexample. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {PPLNS_COINBASE_ACTIVATION_HEIGHT,activationConfigured,isPplnsCoinbaseActive} from '../../sovereign-forge/node/authoritative/pplns-activation.mjs';
import {ShareLedger,ShareCoordinator,allocatePplnsOutputs} from '../../sovereign-forge/node/authoritative/share-coordinator.mjs';
import {encodeAddress} from '../../sovereign-forge/node/authoritative/address.mjs';
import {assessCurrentPplnsAdmission,requireFreshStrategicAuthority} from './pplns-strategic-risk-guard.mjs';
const honest='honest',infiltrator='infiltrator';
function share(log,address,i){
  return log.append({jobId:'job-'+i,address,nonce:i,hash:'0'.repeat(64),
    shareDifficultyBits:12,blockDifficultyBits:18,height:1,previousBlockHash:'0'.repeat(64)});
}
test('HPA-W3-01: frozen PPLNS activation is absent, not economic proof',()=>{
  assert.equal(PPLNS_COINBASE_ACTIVATION_HEIGHT,null);
  assert.equal(activationConfigured(),false);
  assert.equal(isPplnsCoinbaseActive(1),false);
  assert.equal(isPplnsCoinbaseActive(Number.MAX_SAFE_INTEGER),false);
  const result=assessCurrentPplnsAdmission();
  assert.equal(result.mainnet_bwh_faw_economic_proof,false);
  assert.equal(result.active_pool_consensus,false);
});
test('HPA-W3-02: direct mining unaffected by inactive PPLNS candidate',async()=>{
  const coordinator=new ShareCoordinator();
  const valid=encodeAddress(Buffer.alloc(20,7),'faet');
  await assert.rejects(coordinator.createWork(valid),/PPLNS multi-output coinbase activation required/);
  assert.equal(coordinator.jobs.size,0);
  assert.equal(coordinator.multiOutputCoinbaseActive,false);
});
test('HPA-W3-03: a proposed activation height fails closed until strategic authority exists',()=>{
  assert.throws(()=>requireFreshStrategicAuthority({activationHeight:1}),e=>e.code==='HPA_POOL_STRATEGIC_ACTIVATION_NOT_ADMITTED');
  assert.throws(()=>requireFreshStrategicAuthority({activationHeight:600000}),e=>e.code==='HPA_POOL_STRATEGIC_ACTIVATION_NOT_ADMITTED');
  assert.equal(requireFreshStrategicAuthority({activationHeight:null}).mainnet_bwh_faw_economic_proof,false);
});
test('HPA-W3-04: actual 2048 ShareLedger retains 25% infiltrator payout weight after undisclosed full block',()=>{
  const ledger=new ShareLedger({windowSize:2048});
  for(let i=0;i<2048;i++)share(ledger,i%4===0?infiltrator:honest,i);
  const weights=Object.fromEntries(ledger.weights(honest).map(x=>[x.address,Number(x.weight)]));
  assert.deepEqual(weights,{honest:1536,infiltrator:512});
  const before=ledger.summary().lastEntryHash;
  // A miner's private undisclosed full-difficulty solution is invisible to
  // the coordinator; deliberately no append or submit operation occurs.
  const privateSolution={found:true,published:false};
  assert.equal(privateSolution.published,false);
  assert.equal(ledger.summary().lastEntryHash,before);
  const after=Object.fromEntries(ledger.weights(honest).map(x=>[x.address,Number(x.weight)]));
  assert.deepEqual(after,weights);
  const outputs=allocatePplnsOutputs(1000000n,ledger.weights(honest));
  assert.equal(outputs.find(x=>x.address===infiltrator).amount_atoms,'250000');
  assert.equal(outputs.find(x=>x.address===honest).amount_atoms,'750000');
  assert.equal(outputs.reduce((s,x)=>s+BigInt(x.amount_atoms),0n),1000000n);
});
test('HPA-W3-05: infiltrator weight disappears only after full honest-window displacement',()=>{
  const ledger=new ShareLedger({windowSize:2048});
  for(let i=0;i<2048;i++)share(ledger,i%4===0?infiltrator:honest,i);
  for(let i=2048;i<2560;i++)share(ledger,honest,i);
  const weight=Object.fromEntries(ledger.weights(honest).map(x=>[x.address,Number(x.weight)]));
  assert.equal(weight.infiltrator,384);
  assert.equal(weight.honest,1664);
  for(let i=2560;i<4096;i++)share(ledger,honest,i);
  const end=ledger.weights(honest);
  assert.deepEqual(end,[{address:honest,weight:2048n}]);
});
test('HPA-W3-06: ShareLedger rejects replayed share identity, without minting additional payout weight',()=>{
  const ledger=new ShareLedger({windowSize:2048});
  share(ledger,infiltrator,1);
  assert.throws(()=>share(ledger,infiltrator,1),/Duplicate share/);
  assert.equal(ledger.summary().totalShares,1);
});
