/** Candidate-only acceptance/security tests. No production state or policy changes. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign as signBytes} from 'node:crypto';
import {NETWORK,MAX_MEMPOOL_TXS,emptyState,acceptTxInto,txPayload} from '../../sovereign-forge/node/authoritative/fae-v4-core.mjs';
import {stableStringify} from '../../sovereign-forge/node/authoritative/canonical.mjs';
import {sha256} from '../../sovereign-forge/node/authoritative/crypto.mjs';
import {encodeAddress} from '../../sovereign-forge/node/authoritative/address.mjs';
import {assertPendingIndexes,removeDescendantPackageOnClone,simulateFeeAwareAdmission,selectFeeSensitiveTemplateCandidate} from './mempool-fee-aware-shadow-candidate.mjs';
const stable=s=>stableStringify(s);
function wallet(){
  const {privateKey,publicKey}=generateKeyPairSync('ed25519');
  const spki=publicKey.export({format:'der',type:'spki'});
  return {privateKey,pub:spki.toString('base64'),address:encodeAddress(sha256(spki).subarray(0,20),'faet')};
}
function signed(w,input,amount='1000000000',fee=0n){
  const unsigned={version:2,network:NETWORK,inputs:[input],
    outputs:[{address:w.address,amount_atoms:(BigInt(amount)-fee).toString()}],public_key_spki:w.pub};
  const signature=signBytes(null,Buffer.from(stable(txPayload({...unsigned,signature:''}))),w.privateKey).toString('base64');
  return {...unsigned,signature};
}
function seed(s,w,outpoint,amount='1000000000'){
  s.utxos[outpoint]={outpoint,address:w.address,amount_atoms:amount,created_height:0,spent:false,spent_by:null};
}
function deepChain(){
  const a=wallet(),b=wallet(),s=emptyState(),amount='1000000000';
  seed(s,a,'chain:0',amount);seed(s,b,'outside:0',amount);
  let prev='chain:0';
  for(let i=0;i<MAX_MEMPOOL_TXS;i++)prev=acceptTxInto(s,signed(a,prev,amount)).txid+':0';
  return{s,a,b,amount};
}
const fixture=deepChain();
test('PF-12A: signed higher-fee tx over saturated 4096-chain is admitted on clone only',()=>{
  const {s,b,amount}=fixture,incoming=signed(b,'outside:0',amount,1000000n),before=stable(s);
  const result=simulateFeeAwareAdmission(s,incoming);
  assert.equal(result.decision,'admitted_after_shadow_eviction');
  assert.equal(result.evicted.length,1);
  assert.equal(result.evicted_fee_atoms,'0');
  assert.equal(result.fee_atoms,'1000000');
  assert.equal(result.state.mempoolOrder.length,MAX_MEMPOOL_TXS);
  assertPendingIndexes(result.state);
  assert.equal(stable(s),before,'original must remain immutable');
  assertPendingIndexes(JSON.parse(JSON.stringify(result.state)));
});
test('PF-12B: unprofitable zero-fee replacement is rejected without any source mutation',()=>{
  const{s,b,amount}=fixture,before=stable(s);
  assert.throws(()=>simulateFeeAwareAdmission(s,signed(b,'outside:0',amount,0n)),e=>e.code==='no_fee_qualified_eviction');
  assert.equal(stable(s),before);
});
test('PF-12C: invalid signatures cannot trigger eviction',()=>{
  const{s,b,amount}=fixture,before=stable(s);
  const hostile={...signed(b,'outside:0',amount,1000000n),signature:'AA=='};
  assert.throws(()=>simulateFeeAwareAdmission(s,hostile),e=>e.code==='invalid_signature');
  assert.equal(stable(s),before);
});
test('PF-12D: insufficient UTXO and double-spend cannot trigger eviction',()=>{
  const{s,b,amount}=fixture,before=stable(s);
  const missing=signed(b,'missing:0',amount,1000000n);
  assert.throws(()=>simulateFeeAwareAdmission(s,missing),e=>e.code==='missing_or_spent_input');
  const reserved=signed(fixture.a,'chain:0',amount,1000000n);
  assert.throws(()=>simulateFeeAwareAdmission(s,reserved),e=>e.code==='input_reserved');
  assert.equal(stable(s),before);
});
test('PF-12E: descendant-closed package removal updates real indexes, retains unrelated pending',()=>{
  const a=wallet(),b=wallet(),s=emptyState(),amount='1000000000';
  seed(s,a,'parent:0',amount);seed(s,b,'independent:0',amount);
  const parent=acceptTxInto(s,signed(a,'parent:0',amount));
  const child=acceptTxInto(s,signed(a,parent.txid+':0',amount));
  const independent=acceptTxInto(s,signed(b,'independent:0',amount,10n));
  const before=stable(s);
  const result=removeDescendantPackageOnClone(s,[parent.txid],{cap:3});
  assert.deepEqual(result.evicted,[parent.txid,child.txid]);
  assert.deepEqual(result.state.mempoolOrder,[independent.txid]);
  assert.equal(result.state.mempoolSpends['parent:0'],undefined);
  assert.equal(result.state.mempoolOutputs[parent.txid+':0'],undefined);
  assert.equal(result.state.mempoolSpends['independent:0'],independent.txid);
  assertPendingIndexes(result.state,{cap:3});
  assert.equal(stable(s),before);
});
test('PF-12F: fail closed on orphan reservation; no state auto-repair',()=>{
  const {s}=fixture,corrupt=structuredClone(s);
  corrupt.mempoolSpends['unknown:0']='orphan-id';
  assert.throws(()=>simulateFeeAwareAdmission(corrupt,signed(fixture.b,'outside:0',fixture.amount,1000000n)),e=>e.code==='orphan_reserved_input');
});
test('PF-12G: package-size budget and invalid policy parameters fail closed',()=>{
  const{s,b,amount}=fixture;
  assert.throws(()=>simulateFeeAwareAdmission(s,signed(b,'outside:0',amount,1000000n),{cap:MAX_MEMPOOL_TXS,minFeeIncrementAtoms:0n}),e=>e.code==='invalid_min_fee_increment');
  assert.throws(()=>simulateFeeAwareAdmission(s,signed(b,'outside:0',amount,1000000n),{maxPackageSize:0}),e=>e.code==='invalid_package_limit');
});

test('PF-12H: fee-sensitive shadow template selects high-fee child with its zero-fee ancestor in topological order',()=>{
  const a=wallet(),b=wallet(),s=emptyState(),amount='1000000000';
  seed(s,a,'root:0',amount);seed(s,b,'outside:0',amount);
  const parent=acceptTxInto(s,signed(a,'root:0',amount));
  const child=acceptTxInto(s,signed(a,parent.txid+':0',amount,1000000n));
  const standalone=acceptTxInto(s,signed(b,'outside:0',amount,2000n));
  const before=stable(s);
  const selected=selectFeeSensitiveTemplateCandidate(s,{limit:2});
  assert.deepEqual(selected.txids,[parent.txid,child.txid]);
  assert.equal(selected.fee_atoms,'1000000');
  assert.equal(selected.template_policy,'FEE_SENSITIVE_SHADOW_ONLY');
  assert.deepEqual(selectFeeSensitiveTemplateCandidate(s,{limit:2}),selected,'deterministic replay');
  assert.equal(stable(s),before);
  assert.ok(!selected.txids.includes(standalone.txid));
});
test('PF-12I: one-slot shadow template cannot include dependent high-fee child without its ancestor',()=>{
  const a=wallet(),b=wallet(),s=emptyState(),amount='1000000000';
  seed(s,a,'root:0',amount);seed(s,b,'other:0',amount);
  const parent=acceptTxInto(s,signed(a,'root:0',amount));
  const child=acceptTxInto(s,signed(a,parent.txid+':0',amount,1000000n));
  const independent=acceptTxInto(s,signed(b,'other:0',amount,2000n));
  const selected=selectFeeSensitiveTemplateCandidate(s,{limit:1});
  assert.deepEqual(selected.txids,[independent.txid]);
  assert.ok(!selected.txids.includes(child.txid));
  assert.equal(selected.fee_atoms,'2000');
});
test('PF-12J: non-canonical cycle in pending dependencies must fail closed',()=>{
  const a=wallet(),s=emptyState(),amount='1000000000';
  seed(s,a,'root:0',amount);
  const parent=acceptTxInto(s,signed(a,'root:0',amount));
  const child=acceptTxInto(s,signed(a,parent.txid+':0',amount));
  const corrupt=structuredClone(s);
  delete corrupt.mempoolSpends['root:0'];
  corrupt.transactions[parent.txid].inputs=[child.txid+':0'];
  corrupt.mempoolSpends[child.txid+':0']=parent.txid;
  assertPendingIndexes(corrupt);
  assert.throws(()=>selectFeeSensitiveTemplateCandidate(corrupt),e=>e.code==='cyclic_pending_dependency');
});
test('PF-12K: template selector rejects authority-breaking limits',()=>{
  const {s}=fixture;
  assert.throws(()=>selectFeeSensitiveTemplateCandidate(s,{limit:0}),e=>e.code==='invalid_template_limit');
  assert.throws(()=>selectFeeSensitiveTemplateCandidate(s,{limit:21}),e=>e.code==='invalid_template_limit');
});

test('PF-12L: a forged pending fee cannot distort package scoring',()=>{
  const {s,b,amount}=fixture;
  const corrupted=structuredClone(s),id=corrupted.mempoolOrder.at(-1);
  corrupted.transactions[id].fee_atoms='999999999';
  const before=stable(corrupted);
  assert.throws(()=>assertPendingIndexes(corrupted),e=>e.code==='pending_fee_mismatch');
  assert.throws(()=>simulateFeeAwareAdmission(corrupted,signed(b,'outside:0',amount,1000000n)),
    e=>e.code==='pending_fee_mismatch');
  assert.equal(stable(corrupted),before,'no partial mutation on fee-accounting mismatch');
});

test('PF-12M: candidate fee admission respects a bounded evaluation budget',()=>{
  const {s,b,amount}=fixture,before=stable(s),incoming=signed(b,'outside:0',amount,1000000n);
  assert.throws(()=>simulateFeeAwareAdmission(s,incoming,{maxCandidateVisits:16}),
    e=>e.code==='resource_budget_exceeded');
  assert.equal(stable(s),before);
  assertPendingIndexes(s);
});
test('PF-12N: deep signed chains do not deny mining of bounded valid ancestors',()=>{
  const {s}=fixture,before=stable(s);
  const selected=selectFeeSensitiveTemplateCandidate(s,{limit:20});
  assert.deepEqual(selected.txids,s.mempoolOrder.slice(0,20));
  assert.equal(selected.skipped_depth_count,MAX_MEMPOOL_TXS-128);
  assert.equal(stable(s),before);
});
test('PF-12O: require safe integer evaluation budgets',()=>{
  const {s,b,amount}=fixture,incoming=signed(b,'outside:0',amount,1000000n);
  for(const maxCandidateVisits of [0,-1,1.5,Infinity,16777217,'4096']){
    assert.throws(()=>simulateFeeAwareAdmission(s,incoming,{maxCandidateVisits}),
      e=>e.code==='invalid_resource_budget');
    assert.throws(()=>selectFeeSensitiveTemplateCandidate(s,{maxCandidateVisits}),
      e=>e.code==='invalid_resource_budget');
  }
});
test('PF-12P: small valid ancestor package fits a defined evaluation budget',()=>{
  const a=wallet(),b=wallet(),s=emptyState(),amount='1000000000';
  seed(s,a,'root:0',amount);seed(s,b,'outside:0',amount);
  const parent=acceptTxInto(s,signed(a,'root:0',amount));
  const child=acceptTxInto(s,signed(a,parent.txid+':0',amount,1000000n));
  const independent=acceptTxInto(s,signed(b,'outside:0',amount,2000n));
  const before=stable(s);
  const selected=selectFeeSensitiveTemplateCandidate(s,{limit:2,maxCandidateVisits:256});
  assert.deepEqual(selected.txids,[parent.txid,child.txid]);
  assert.ok(!selected.txids.includes(independent.txid));
  assert.equal(selected.fee_atoms,'1000000');
  assert.throws(()=>selectFeeSensitiveTemplateCandidate(s,{limit:2,maxCandidateVisits:1}),
    e=>e.code==='resource_budget_exceeded');
  assert.equal(stable(s),before);
});

test('PF-12Q: hostile deep zero-fee chain cannot suppress a fully signed independent high-fee template',()=>{
  const a=wallet(),s=removeDescendantPackageOnClone(fixture.s,
    [fixture.s.mempoolOrder.at(-1)]).state;
  const independent=acceptTxInto(s,signed(fixture.b,'outside:0',fixture.amount,1000000n));
  assert.equal(s.mempoolOrder.length,MAX_MEMPOOL_TXS);
  const before=stable(s),selected=selectFeeSensitiveTemplateCandidate(s,{limit:20});
  assert.equal(selected.txids[0],independent.txid);
  assert.equal(selected.txids.length,20);
  assert.ok(selected.skipped_depth_count>0);
  assert.equal(selected.fee_atoms,'1000000');
  assert.equal(stable(s),before);
  assertPendingIndexes(s);
});

test('PF-12R: observed CI resource envelope for full 4096-entry hostile signed mempool (non-production SLA)',()=>{
  const {s,b,amount}=fixture;
  const signedHighFee=signed(b,'outside:0',amount,1000000n);
  const before=stable(s);
  // The host runner is an ephemeral CI VM, NOT a representative FAE mobile,
  // browser, GPU, HBM or ASIC device. These are coarse regression ceilings
  // only, and no unmeasured mainnet latency guarantee follows from a PASS.
  const envelope={maxElapsedMs:45000,maxProcessRssBytes:1024*1024*1024};
  function observe(name,fn){
    const cpuBefore=process.cpuUsage(),start=process.hrtime.bigint();
    const result=fn();
    const elapsedMs=Number(process.hrtime.bigint()-start)/1e6;
    const cpu=process.cpuUsage(cpuBefore);
    const mem=process.memoryUsage();
    const metrics={name,node:process.version,platform:process.platform,arch:process.arch,
      pendingBefore:s.mempoolOrder.length,elapsed_ms:Math.round(elapsedMs*1000)/1000,
      cpu_user_ms:cpu.user/1000,cpu_system_ms:cpu.system/1000,
      rss_bytes:mem.rss,heap_used_bytes:mem.heapUsed,
      max_rss_bytes:process.resourceUsage().maxRSS*1024,
      indicative_only:true,representative_device:false};
    console.log('HPA_W2_CI_RESOURCE_EVIDENCE '+JSON.stringify(metrics));
    assert.ok(elapsedMs<envelope.maxElapsedMs,
      name+' exceeded non-production CI time regression envelope');
    assert.ok(mem.rss<envelope.maxProcessRssBytes,
      name+' exceeded non-production CI RSS regression envelope');
    return result;
  }
  const admission=observe('fullpool_fee_admission',()=>simulateFeeAwareAdmission(s,signedHighFee));
  assert.equal(admission.decision,'admitted_after_shadow_eviction');
  assert.equal(admission.state.mempoolOrder.length,MAX_MEMPOOL_TXS);
  assertPendingIndexes(admission.state);
  const selection=observe('fullpool_ancestor_template',()=>selectFeeSensitiveTemplateCandidate(admission.state,{limit:20}));
  assert.equal(selection.txids[0],admission.admitted);
  assert.equal(selection.txids.length,20);
  assert.equal(selection.fee_atoms,'1000000');
  assert.equal(stable(s),before,'benchmark cannot mutate source');
  assert.equal(selection.source_state_mutated,false);
});

test('PF-12S: repeated 4096 independent signed transactions resource sensitivity, with real source scoring',()=>{
  const a=wallet(),b=wallet(),s=emptyState(),amount='1000000000';
  seed(s,b,'fee-input:0',amount);
  for(let i=0;i<MAX_MEMPOOL_TXS;i++){
    const input='independent-'+i+':0';
    seed(s,a,input,amount);
    acceptTxInto(s,signed(a,input,amount));
  }
  assert.equal(s.mempoolOrder.length,MAX_MEMPOOL_TXS);
  assertPendingIndexes(s);
  const before=stable(s),highFee=signed(b,'fee-input:0',amount,1000000n);
  const observations=[];
  function observe(operation,run,fn){
    const beforeCpu=process.cpuUsage(),t=process.hrtime.bigint();
    const result=fn(),elapsed=Number(process.hrtime.bigint()-t)/1e6;
    const cpu=process.cpuUsage(beforeCpu),mem=process.memoryUsage();
    const o={operation,run,topology:'4096_independent_signed_pending',
      elapsed_ms:+elapsed.toFixed(3),cpu_user_ms:cpu.user/1000,
      cpu_system_ms:cpu.system/1000,rss_bytes:mem.rss,
      node:process.version,platform:process.platform,arch:process.arch,
      indicative_only:true,representative_device:false};
    observations.push(o);
    assert.ok(elapsed<45000,'candidate operation exceeded non-production regression latency');
    assert.ok(mem.rss<1024*1024*1024,'candidate process RSS exceeded 1GiB regression bound');
    return result;
  }
  for(let i=0;i<3;i++){
    const admitted=observe('flat_fullpool_fee_admission',i,()=>simulateFeeAwareAdmission(s,highFee));
    assert.equal(admitted.decision,'admitted_after_shadow_eviction');
    assert.equal(admitted.state.mempoolOrder.length,MAX_MEMPOOL_TXS);
    assertPendingIndexes(admitted.state);
    const selected=observe('flat_fullpool_fee_template',i,()=>selectFeeSensitiveTemplateCandidate(admitted.state,{limit:20}));
    assert.equal(selected.txids[0],admitted.admitted);
    assert.equal(selected.fee_atoms,'1000000');
    assert.equal(selected.txids.length,20);
    assert.equal(selected.skipped_depth_count,0);
  }
  for(const name of ['flat_fullpool_fee_admission','flat_fullpool_fee_template']){
    const rows=observations.filter(x=>x.operation===name);
    const sorted=rows.map(x=>x.elapsed_ms).sort((a,b)=>a-b);
    console.log('HPA_W2_CI_RESOURCE_SCENARIO '+JSON.stringify({
      operation:name,topology:'4096_independent_signed_pending',samples:3,
      wall_min_ms:sorted[0],wall_median_ms:sorted[1],wall_max_observed_ms:sorted[2],
      max_observed_process_rss_bytes:Math.max(...rows.map(r=>r.rss_bytes)),
      samples_detail:rows,observed_ci_only:true,
      not_worst_case:true,not_production_sla:true,not_dp6_asic_evidence:true
    }));
  }
  assert.equal(stable(s),before,'three admission/template runs cannot mutate shared authoritative fixture');
  assertPendingIndexes(s);
});
