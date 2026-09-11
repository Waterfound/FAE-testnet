import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TARGET_SECONDS,FUTURE_DRIFT_MS,HALF_LIFE_CANDIDATES_SECONDS,targetFromLeadingZeroBits,asertTargetCandidate,POW_LIMIT,validateCandidateTimestamp
} from '../node/authoritative/difficulty-timestamp-candidate.mjs';
import {
  TIMESTAMP_TEMPLATE_POLICY_STATUS,CLOCK_SKEW_BUDGET_MS,RELAY_DELAY_BUDGET_MS,buildCandidateTemplateTimestamp,honestClockPairAccepted,guaranteedClockSkewBudget
} from '../node/authoritative/difficulty-timestamp-template-policy.mjs';

function rng(seed){let x=BigInt(seed)||1n;return()=>{x=(6364136223846793005n*x+1442695040888963407n)&((1n<<64n)-1n);return Number(x>>11n)/9007199254740992}}
function quantile(sorted,q){const index=Math.floor((sorted.length-1)*q);return sorted[index]}
function simulateStationary(halfLifeSeconds,{blocks=20_000,seed=1}={}){
  const random=rng(seed),anchorTarget=targetFromLeadingZeroBits(20);let time=TARGET_SECONDS,height=1,target=anchorTarget;const ratios=[];
  for(let i=0;i<blocks;i++){
    const u=Math.max(Number.MIN_VALUE,random()),dt=-Math.log(u)*TARGET_SECONDS*(Number(anchorTarget)/Number(target));time+=dt;height++;
    target=asertTargetCandidate({anchorTarget,anchorHeight:1,anchorParentTimeSeconds:0,evaluationHeight:height,evaluationTimeSeconds:Math.floor(time),halfLifeSeconds,powLimit:POW_LIMIT});ratios.push(Number(target)/Number(anchorTarget));
  }
  ratios.sort((a,b)=>a-b);return{p05:quantile(ratios,.05),median:quantile(ratios,.5),p95:quantile(ratios,.95)};
}
function simulateDailyCycle(halfLifeSeconds,{blocks=20_000,seed=2}={}){
  const random=rng(seed),anchorTarget=targetFromLeadingZeroBits(20);let time=TARGET_SECONDS,height=1,target=anchorTarget;const intervals=[],ratios=[];
  for(let i=0;i<blocks;i++){
    const phase=time%(24*3600),hashMultiplier=phase<12*3600?.25:1.75,u=Math.max(Number.MIN_VALUE,random());
    const expected=TARGET_SECONDS*(Number(anchorTarget)/Number(target))/hashMultiplier,dt=-Math.log(u)*expected;time+=dt;height++;
    target=asertTargetCandidate({anchorTarget,anchorHeight:1,anchorParentTimeSeconds:0,evaluationHeight:height,evaluationTimeSeconds:Math.floor(time),halfLifeSeconds,powLimit:POW_LIMIT});intervals.push(dt);ratios.push(Number(target)/Number(anchorTarget));
  }
  intervals.sort((a,b)=>a-b);ratios.sort((a,b)=>a-b);return{medianInterval:quantile(intervals,.5),p95Interval:quantile(intervals,.95),targetP05:quantile(ratios,.05),targetP95:quantile(ratios,.95)};
}

test('seeded stationary Poisson red-team quantifies the 6h responsiveness/noise tradeoff',()=>{
  const rows=HALF_LIFE_CANDIDATES_SECONDS.map(halfLifeSeconds=>simulateStationary(halfLifeSeconds));
  for(const row of rows){assert.ok(row.median>.97&&row.median<1.03);assert.ok(row.p05>.80&&row.p95<1.25)}
  const width=row=>row.p95-row.p05;assert.ok(width(rows[0])>width(rows[1]));assert.ok(width(rows[1])>width(rows[2]));assert.ok(width(rows[2])>width(rows[3]));
  assert.ok(rows[0].p05>.85&&rows[0].p95<1.20,'6h candidate must not show pathological steady-state target spread');
});

test('extreme deterministic 12h browser hash cycle remains bounded for all precommitted half-lives',()=>{
  const rows=HALF_LIFE_CANDIDATES_SECONDS.map(halfLifeSeconds=>simulateDailyCycle(halfLifeSeconds));
  for(const row of rows){assert.ok(row.medianInterval<100);assert.ok(row.p95Interval<900);assert.ok(row.targetP05>.55&&row.targetP95<2.10)}
  assert.ok(rows[0].targetP95<1.95&&rows[0].targetP05>.60,'6h candidate must remain bounded under 0.25x/1.75x daily cycling');
});

test('candidate template policy cannot emit a timestamp below parent or at/below MTP',()=>{
  const chain=[1000,2000,3000,4000,5000,6000,7000,8000,9000,10_000,20_000].map((timestamp_ms,i)=>({height:i+1,timestamp_ms}));
  const result=buildCandidateTemplateTimestamp(chain,{nowMs:5_000});assert.equal(result.status,TIMESTAMP_TEMPLATE_POLICY_STATUS);assert.equal(result.timestamp_ms,20_000);assert.equal(result.validation.ok,true);
  const mtpHeavy=[1000,2000,3000,4000,5000,6000,7000,8000,9000,10_000,11_000].map((timestamp_ms,i)=>({height:i+1,timestamp_ms}));
  const second=buildCandidateTemplateTimestamp(mtpHeavy,{nowMs:1_000});assert.ok(second.timestamp_ms>6_000);assert.equal(second.validation.ok,true);
});

test('90s future wall rejects an accumulated-forward-clock strategy instead of allowing +90s per block',()=>{
  const chain=[];let honestNow=1_000_000;
  for(let i=0;i<30;i++){
    const attempted=honestNow+(i+1)*FUTURE_DRIFT_MS,result=validateCandidateTimestamp(chain,attempted,{nowMs:honestNow});
    if(i===0)assert.equal(result.ok,true);else assert.equal(result.error,'timestamp_too_far_future');
    chain.push({timestamp_ms:i===0?attempted:honestNow});honestNow+=TARGET_SECONDS*1000;
  }
});

test('declared honest clock-skew budget fits the 90s wall with explicit headroom',()=>{
  const budget=guaranteedClockSkewBudget();assert.equal(CLOCK_SKEW_BUDGET_MS,30_000);assert.equal(RELAY_DELAY_BUDGET_MS,5_000);assert.equal(budget.ok,true);assert.equal(budget.worst_future_lead_ms,55_000);assert.equal(budget.headroom_ms,35_000);
  assert.equal(honestClockPairAccepted({producerSkewMs:30_000,receiverSkewMs:-30_000,relayDelayMs:0}),true);
  assert.equal(honestClockPairAccepted({producerSkewMs:46_000,receiverSkewMs:-46_000,relayDelayMs:0}),false,'outside declared skew budget may fail closed');
});
