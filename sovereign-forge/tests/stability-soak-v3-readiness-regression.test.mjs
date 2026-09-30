import assert from 'node:assert/strict';
import test from 'node:test';
import {analyzeStabilitySoakV3,classifyStabilitySoakV3} from '../lab/stability-soak-v3/analyze-evidence.mjs';

const HOUR=60*60_000,T0=Date.parse('2026-10-01T00:00:00Z');
const iso=ms=>new Date(ms).toISOString();
const hash=n=>n.toString(16).padStart(64,'0');
function chain(){
  const rows=[];
  for(let i=1;i<=11;i++)rows.push({height:i,hash:hash(i),timestamp_ms:T0-100000+i*1000});
  for(let i=1;i<=1152;i++)rows.push({height:11+i,hash:hash(1000+i),timestamp_ms:T0+i*300_000});
  return rows;
}
function events({propagationMs=125}={}){
  const rows=[
    {event:'FAE_V3_MONITOR_BOOT',monitor_role:'controller',render_git_commit:'abc',at:iso(T0)},
    {event:'FAE_V3_MONITOR_BOOT',monitor_role:'observer',render_git_commit:'abc',at:iso(T0+1000)}
  ];
  for(let t=T0+10_000;t<=T0+96*HOUR;t+=10_000){
    rows.push({event:'FAE_V3_HEARTBEAT',monitor_role:'controller',at:iso(t)});
    rows.push({event:'FAE_V3_HEARTBEAT',monitor_role:'observer',at:iso(t+500)});
  }
  for(let i=1;i<=1152;i++){
    const at=T0+i*300_000,h=hash(1000+i);
    rows.push({event:'FAE_V3_TIP_FIRST_SEEN',monitor_role:'controller',height:11+i,hash:h,at:iso(at)});
    rows.push({event:'FAE_V3_BLOCK_PROPAGATED',monitor_role:'controller',height:11+i,hash:h,propagation_ms:propagationMs,at:iso(at+500)});
  }
  return rows;
}
function analyze(ev=events(),end=T0+96*HOUR){
  return analyzeStabilitySoakV3({events:ev,finalChain:chain(),t0Utc:iso(T0),tEndUtc:iso(end),initialHeight:11,frozenHarnessCommit:'abc'});
}

test('frozen healthy contract is PASS only after a complete 96h execution',()=>{
  const a=analyze();
  assert.equal(a.ok,true);assert.equal(classifyStabilitySoakV3({analysis:a}), 'PASS');
  assert.equal(a.gates.propagation_p95_under_5s,true);
  assert.equal(a.gates.stale_observed_under_1pct,true);
  assert.equal(a.gates.chain_progressed,true);
});
test('latency regression cannot silently PASS',()=>{
  const a=analyze(events({propagationMs:6000}));
  assert.equal(a.gates.propagation_p95_under_5s,false);
  assert.equal(classifyStabilitySoakV3({analysis:a}),'FAIL');
});
test('observed stale rate above one percent cannot silently PASS',()=>{
  const ev=events();
  for(let i=0;i<20;i++)ev.push({event:'FAE_V3_TIP_FIRST_SEEN',monitor_role:'observer',height:500+i,hash:hash(900000+i),at:iso(T0+40*HOUR+i*1000)});
  const a=analyze(ev);
  assert.ok(a.observed_stale_rate>0.01);
  assert.equal(a.gates.stale_observed_under_1pct,false);
  assert.equal(classifyStabilitySoakV3({analysis:a}),'FAIL');
});
test('valid observed reorg is retained and accounted, not erased',()=>{
  const ev=events();
  ev.push({event:'FAE_V3_REORG_OBSERVED',monitor_role:'observer',node:'node-b',anchor_height:77,previous_tip:hash(77),new_hash_at_anchor:hash(78),current_tip:hash(79),at:iso(T0+20*HOUR)});
  const a=analyze(ev);assert.equal(a.reorg_count,1);assert.equal(a.gates.reorg_accounting_complete,true);
});
test('malformed metric sample becomes EVIDENCE_INCOMPLETE',()=>{
  const ev=events();ev.find(e=>e.event==='FAE_V3_BLOCK_PROPAGATED').propagation_ms='not-a-number';
  const a=analyze(ev);assert.equal(a.gates.propagation_evidence_complete,false);
  assert.equal(classifyStabilitySoakV3({analysis:a}),'EVIDENCE_INCOMPLETE');
});
test('missing propagation evidence becomes EVIDENCE_INCOMPLETE',()=>{
  const a=analyze(events().filter(e=>e.event!=='FAE_V3_BLOCK_PROPAGATED'));
  assert.equal(a.gates.propagation_evidence_complete,false);
  assert.equal(classifyStabilitySoakV3({analysis:a}),'EVIDENCE_INCOMPLETE');
});
test('interrupted execution is INCONCLUSIVE rather than PASS',()=>{
  const a=analyze();assert.equal(classifyStabilitySoakV3({analysis:a,termination:'process_abort'}),'INCONCLUSIVE');
});
test('proven provider failure and harness failure remain distinct',()=>{
  const a=analyze();
  assert.equal(classifyStabilitySoakV3({analysis:a,termination:'network_timeout',providerFailureProven:true}),'PROVIDER_FAILURE');
  assert.equal(classifyStabilitySoakV3({analysis:a,termination:'evidence_write_abort',harnessFailureProven:true}),'HARNESS_FAILURE');
});
test('temporary RPC loss under frozen bound can recover without weakening the contract',()=>{
  const ev=events();
  ev.push({event:'FAE_V3_TRANSPORT_RECOVERED',monitor_role:'observer',node:'node-c',duration_ms:12000,at:iso(T0+8*HOUR)});
  const a=analyze(ev);assert.equal(a.gates.recovery_under_180s,true);assert.equal(classifyStabilitySoakV3({analysis:a}),'PASS');
});
test('recovery beyond 180 seconds is a FAIL',()=>{
  const ev=events();
  ev.push({event:'FAE_V3_NODE_RECOVERED',monitor_role:'controller',node:'node-b',duration_ms:180001,at:iso(T0+8*HOUR)});
  const a=analyze(ev);assert.equal(a.gates.recovery_under_180s,false);assert.equal(classifyStabilitySoakV3({analysis:a}),'FAIL');
});
test('invalid event timestamp fails evidence completeness',()=>{
  const ev=events();ev.push({event:'FAE_V3_HEARTBEAT',monitor_role:'observer',at:'malformed'});
  const a=analyze(ev);assert.equal(a.gates.timestamps_complete,false);assert.equal(classifyStabilitySoakV3({analysis:a}),'EVIDENCE_INCOMPLETE');
});
