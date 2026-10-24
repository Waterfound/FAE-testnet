import assert from 'node:assert/strict';
import test from 'node:test';
import {analyzeStabilitySoakV3,wilsonUpperOneSided95} from '../lab/stability-soak-v3/analyze-evidence.mjs';

const HOUR=60*60_000,T0=Date.parse('2026-10-01T00:00:00Z');
function iso(ms){return new Date(ms).toISOString()}
function hash(n){return n.toString(16).padStart(64,'0')}
function healthyEvents(){
  const rows=[
    {event:'FAE_V3_MONITOR_BOOT',monitor_role:'controller',render_git_commit:'abc',at:iso(T0)},
    {event:'FAE_V3_MONITOR_BOOT',monitor_role:'observer',render_git_commit:'abc',at:iso(T0+1000)}
  ];
  for(let t=T0+10_000;t<=T0+96*HOUR;t+=10_000){
    rows.push({event:'FAE_V3_HEARTBEAT',monitor_role:'controller',at:iso(t)});
    rows.push({event:'FAE_V3_HEARTBEAT',monitor_role:'observer',at:iso(t+500)});
  }
  for(let i=1;i<=1152;i++){
    const at=T0+i*300_000;
    rows.push({event:'FAE_V3_TIP_FIRST_SEEN',monitor_role:'controller',height:11+i,hash:hash(1000+i),at:iso(at)});
    rows.push({event:'FAE_V3_BLOCK_PROPAGATED',monitor_role:'controller',height:11+i,hash:hash(1000+i),propagation_ms:100+(i%50),at:iso(at+500)});
  }
  return rows;
}
function chain(){
  const rows=[];
  for(let i=1;i<=11;i++)rows.push({height:i,hash:hash(i),timestamp_ms:T0-100000+(i*1000)});
  for(let i=1;i<=1152;i++)rows.push({height:11+i,hash:hash(1000+i),timestamp_ms:T0+i*300_000});
  return rows;
}

test('one-sided 95% Wilson upper reproduces the historical ~1.41% at 0/189',()=>{
  assert.ok(Math.abs(wilsonUpperOneSided95(0,189)-0.014112)<0.00005);
});

test('healthy synthetic 96h V3 evidence closes all analyzer gates',()=>{
  const result=analyzeStabilitySoakV3({
    events:healthyEvents(),finalChain:chain(),t0Utc:iso(T0),tEndUtc:iso(T0+96*HOUR),
    initialHeight:11,frozenHarnessCommit:'abc'
  });
  assert.equal(result.ok,true);
  assert.equal(result.stale_blocks,0);
  assert.equal(result.canonical_blocks_during_run,1152);
  assert.ok(result.wilson_upper_one_sided_95<0.01);
  assert.ok(result.propagation_p95_ms>=100);
  assert.equal(result.reorg_count,0);
});

test('a 208s recovery remains a hard fail',()=>{
  const events=healthyEvents();
  events.push({event:'FAE_V3_NODE_RECOVERED',monitor_role:'controller',node:'node-b',duration_ms:208000,at:iso(T0+12*HOUR)});
  const result=analyzeStabilitySoakV3({events,finalChain:chain(),t0Utc:iso(T0),tEndUtc:iso(T0+96*HOUR),initialHeight:11,frozenHarnessCommit:'abc'});
  assert.equal(result.gates.recovery_under_180s,false);
  assert.equal(result.ok,false);
});

test('a stale block keeps evidence and raises the Wilson calculation',()=>{
  const events=healthyEvents();
  events.push({event:'FAE_V3_TIP_FIRST_SEEN',monitor_role:'observer',height:500,hash:hash(999999),at:iso(T0+40*HOUR)});
  const result=analyzeStabilitySoakV3({events,finalChain:chain(),t0Utc:iso(T0),tEndUtc:iso(T0+96*HOUR),initialHeight:11,frozenHarnessCommit:'abc'});
  assert.equal(result.stale_blocks,1);
  assert.ok(result.wilson_upper_one_sided_95>0);
});
