import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const page=await readFile(new URL('../mts-12-ipad-acceptance.html',import.meta.url),'utf8');
const authority=JSON.parse(await readFile(new URL('../authority.json',import.meta.url),'utf8'));
const expectedSha='e75a064030590d12ec4a528bb828360a2ad31eb22b35f33d4fec96a51ce9610c';
const watch='faet1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqw2770k';

function polymod(values){
  const generators=[0x3b6a57b2,0x26508e6d,0x1ea119fa,0x3d4233dd,0x2a1462b3];
  let checksum=1;
  for(const value of values){
    const top=checksum>>>25;
    checksum=((checksum&0x1ffffff)<<5)^value;
    for(let i=0;i<5;i++)if((top>>>i)&1)checksum^=generators[i];
  }
  return checksum>>>0;
}
function validAddr(value){
  const cs='qpzry9x8gf2tvdw0s3jn54khce6mua7l',hrp='faet',k=0x2bc830a3;
  if(typeof value!=='string'||value!==value.toLowerCase())return false;
  const sep=value.lastIndexOf('1');
  const data=[...value.slice(sep+1)].map(c=>cs.indexOf(c));
  if(value.slice(0,sep)!==hrp||data.some(x=>x<0))return false;
  const expanded=[...hrp].map(c=>c.charCodeAt(0)>>>5).concat([0],[...hrp].map(c=>c.charCodeAt(0)&31));
  if(polymod([...expanded,...data])!==k)return false;
  const payload=data.slice(0,-6);let accumulator=0,bits=0,bytes=0;
  for(const item of payload){
    accumulator=(accumulator<<5)|item;bits+=5;
    while(bits>=8){bits-=8;bytes++;accumulator&=(1<<Math.min(bits+8,30))-1}
  }
  return bytes===20;
}

test('MTS-12 acceptance page compiles and stays Lab-only',()=>{
  const scripts=[...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match=>match[1]);
  assert.equal(scripts.length,1);
  assert.doesNotThrow(()=>new Function(scripts[0]));
  assert.ok(['MTS_12_ACCEPTANCE_PREP','MTS_12_READY_FOR_PHYSICAL_RUN','MTS_12_HARNESS_FIX_ACTIVE'].includes(authority.status));
  assert.equal(authority.current_stage_active_miner_write_authorized,false);
  assert.ok(authority.current_stage_protected_paths.includes('mining.js'));
});

test('MTS-12 uses real top-level tabs and contains no nested FAE iframe',()=>{
  assert.doesNotMatch(page,/<iframe\b/i);
  assert.match(page,/window\.open\(url\.toString\(\),'mts12-miner-'\+role\)/);
  assert.match(page,/new URL\('\/',location\.origin\)/);
  assert.match(page,/Waiting · open A and B first/);
  assert.match(page,/top-level Safari tabs/);
});

test('MTS-12 binds exact protected miner and a valid watch-only address',()=>{
  assert.match(page,new RegExp(expectedSha));
  assert.equal(authority.mts_12_authority?.protected_miner_sha256,expectedSha);
  assert.match(page,new RegExp(watch));
  assert.equal(authority.mts_12_authority?.watch_only_address,watch);
  assert.equal(validAddr(watch),true);
});

test('MTS-12 physical gate forbids manual restart and records zero-stale requirement',()=>{
  assert.match(page,/Manual Stop → Start used/);
  assert.match(page,/staleSubmissions/);
  assert.match(page,/TIP_GATE_MS=3500/);
  assert.match(page,/RESUME_GATE_MS=1500/);
  assert.match(page,/manualRestartUsed/);
});

test('MTS-12 physical verdicts latch once decided',()=>{
  assert.equal(page.includes("if(state.tipVerdict||!state.tipArmed||!state.tipTarget)return;"),true);
  assert.equal(page.includes("state.tipArmed=false;"),true);
  assert.equal(page.includes("if(state.resumeVerdict||!state.resumeArmed||!state.visibleAt)return;"),true);
  assert.equal(page.includes("state.resumeArmed=false;"),true);
});

test('MTS-12 records submit start before classifying a stale response',()=>{
  assert.equal(page.includes("post('submit_started',submitMeta);"),true);
  assert.equal(page.includes("known_mismatch_at_start"),true);
  assert.equal(page.includes("raceLostResponses"),true);
  assert.equal(page.includes("unclassifiedStaleResponses"),true);
  assert.equal(page.includes("Stale after known mismatch"),true);
  assert.equal(page.includes("Race-lost 409 responses"),true);
});

test('MTS-12 lifecycle gate measures local revalidation start, not WAN completion',()=>{
  assert.equal(page.includes("foreground_event_to_authoritative_status_request_start"),true);
  assert.equal(page.includes("resume_revalidation_started"),true);
  assert.equal(page.includes("resume_revalidation_result"),true);
  assert.equal(page.includes("network_response_ms"),true);
  assert.equal(page.includes("resume_probe"),false);
  assert.equal(page.includes("arm_resume_lifecycle"),true);
  assert.equal(page.includes("document.addEventListener('visibilitychange'"),true);
  assert.equal(page.includes("window.addEventListener('pageshow'"),true);
});

test('MTS-12 background flow exercises real Miner A foreground lifecycle after tip PASS',()=>{
  assert.equal(page.includes("Waiting · real-tip gate must PASS first"),true);
  assert.equal(page.includes("switch to Miner A first"),true);
  assert.equal(page.includes("background Safari for 30–60 seconds"),true);
  assert.equal(page.includes("resumeTargetRole:'a'"),true);
  assert.equal(page.includes("FAE_MTS_12_PHYSICAL_IPAD_EVIDENCE_V3"),true);
});

test('MTS-12 runner is local-only and does not add telemetry or secret collection',()=>{
  assert.doesNotMatch(page,/sendBeacon\s*\(/);
  assert.doesNotMatch(page,/XMLHttpRequest\s*\(/);
  assert.doesNotMatch(page,/type=["']password["']/i);
  assert.doesNotMatch(page,/localStorage\.setItem\s*\(/);
  assert.doesNotMatch(page,/sessionStorage\.setItem\s*\(/);
  assert.match(page,/No telemetry, seed phrase, private key, wallet backup, or reusable secret is collected/);
  const externalUrls=[...page.matchAll(/https:\/\/[^'"]+/g)].map(m=>m[0]);
  assert.deepEqual([...new Set(externalUrls)],['https://wfwwotuhectwknvbvgif.supabase.co/functions/v1/fae-public-testnet-v4']);
});

test('MTS-12 completion cannot be claimed without physical iPad evidence',()=>{
  assert.match(authority.mts_12_authority?.completion_rule||'',/cannot be GREEN without evidence produced on a physical iPad Safari session/);
});
