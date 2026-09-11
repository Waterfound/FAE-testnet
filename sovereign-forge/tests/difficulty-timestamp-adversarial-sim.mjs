import assert from 'node:assert/strict';
import test from 'node:test';
import {asertTargetCandidate,targetFromLeadingZeroBits,POW_LIMIT,TARGET_SECONDS,FUTURE_DRIFT_MS,HALF_LIFE_CANDIDATES_SECONDS} from '../node/authoritative/difficulty-timestamp-candidate.mjs';

const anchorTarget=targetFromLeadingZeroBits(20);
function targetAt(height,timeSeconds,halfLifeSeconds){return asertTargetCandidate({anchorTarget,anchorHeight:1,anchorParentTimeSeconds:0,evaluationHeight:height,evaluationTimeSeconds:Math.floor(timeSeconds),halfLifeSeconds,powLimit:POW_LIMIT})}
function inverseTargetRatio(target){return Number(anchorTarget)/Number(target)}
function lcg(seed=0x00fae123){let state=seed>>>0;return()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return(state+0.5)/4294967296}}
function steadyNoise(halfLifeSeconds,{blocks=12_000,burn=1_000}={}){
  let height=1,time=180;const rand=lcg(),logs=[],intervals=[];
  for(let i=0;i<blocks;i++){
    const target=targetAt(height,time,halfLifeSeconds),mean=TARGET_SECONDS*inverseTargetRatio(target),u=rand(),dt=-Math.log(1-u)*mean;time+=dt;height++;
    if(i>=burn){logs.push(Math.log2(Number(target)/Number(anchorTarget)));intervals.push(dt)}
  }
  const avg=values=>values.reduce((a,b)=>a+b,0)/values.length,meanInterval=avg(intervals),logMean=avg(logs),logSd=Math.sqrt(avg(logs.map(x=>(x-logMean)**2)));
  return{meanInterval,logTargetSd:logSd};
}
function browserHashMultiplier(timeSeconds){return[0.35,0.75,1.9][Math.floor((timeSeconds%(24*3600))/(8*3600))]}
function dailyBrowserCycle(halfLifeSeconds,{days=14}={}){
  let height=1,time=180,minInterval=Infinity,maxInterval=0,minTargetRatio=Infinity,maxTargetRatio=0;const end=time+days*86400;
  while(time<end){
    const target=targetAt(height,time,halfLifeSeconds),hashMultiplier=browserHashMultiplier(time),expected=TARGET_SECONDS*inverseTargetRatio(target)/hashMultiplier,ratio=Number(target)/Number(anchorTarget);
    minInterval=Math.min(minInterval,expected);maxInterval=Math.max(maxInterval,expected);minTargetRatio=Math.min(minTargetRatio,ratio);maxTargetRatio=Math.max(maxTargetRatio,ratio);time+=expected;height++;
  }
  return{minInterval,maxInterval,minTargetRatio,maxTargetRatio};
}
function forwardTimestampAttack(halfLifeSeconds,{blocks=5000,attackEvery=3}={}){
  let height=1,realTime=180,chainTime=180,honestHeight=1,honestReal=180,honestChainTime=180,maxEaseRatio=1,maxLead=0;
  for(let i=0;i<blocks;i++){
    const target=targetAt(height,chainTime,halfLifeSeconds),expected=TARGET_SECONDS*inverseTargetRatio(target);realTime+=expected;height++;
    const malicious=i%attackEvery===0,desired=malicious?realTime+FUTURE_DRIFT_MS/1000:realTime;chainTime=Math.max(chainTime,desired);maxLead=Math.max(maxLead,chainTime-realTime);
    const honestTarget=targetAt(honestHeight,honestChainTime,halfLifeSeconds),honestExpected=TARGET_SECONDS*inverseTargetRatio(honestTarget);honestReal+=honestExpected;honestHeight++;honestChainTime=honestReal;
    const attackedNext=targetAt(height,chainTime,halfLifeSeconds),honestNext=targetAt(honestHeight,honestChainTime,halfLifeSeconds);maxEaseRatio=Math.max(maxEaseRatio,Number(attackedNext)/Number(honestNext));
  }
  return{maxEaseRatio,maxLeadSeconds:maxLead};
}

test('stable-hash stochastic replay keeps the 180s mean and shows the expected noise/responsiveness trade-off',()=>{
  const metrics=HALF_LIFE_CANDIDATES_SECONDS.map(steadyNoise);
  for(const row of metrics)assert.ok(row.meanInterval>175&&row.meanInterval<185);
  assert.ok(metrics[0].logTargetSd>metrics[1].logTargetSd&&metrics[1].logTargetSd>metrics[2].logTargetSd&&metrics[2].logTargetSd>metrics[3].logTargetSd);
  assert.ok(metrics[0].logTargetSd<0.09,'6h target noise remains bounded in the seeded steady-state replay');
});

test('extreme but periodic browser participation does not create runaway target oscillation',()=>{
  const metrics=HALF_LIFE_CANDIDATES_SECONDS.map(dailyBrowserCycle);
  const six=metrics[0];assert.ok(six.minTargetRatio>0.65&&six.maxTargetRatio<1.70);assert.ok(six.minInterval>60&&six.maxInterval<780);
  for(const row of metrics){assert.ok(Number.isFinite(row.minInterval)&&Number.isFinite(row.maxInterval));assert.ok(row.minTargetRatio>0&&row.maxTargetRatio<2)}
});

test('33%-pattern maximum-future timestamp strategy cannot accumulate drift or materially ease 6h ASERT',()=>{
  const attack=forwardTimestampAttack(21_600,{attackEvery:3});assert.ok(attack.maxLeadSeconds<=90.000001);assert.ok(attack.maxEaseRatio<1.0031);
});

test('timestamp-easing bound tightens monotonically with longer half-life candidates',()=>{
  const attacks=HALF_LIFE_CANDIDATES_SECONDS.map(halfLifeSeconds=>forwardTimestampAttack(halfLifeSeconds,{attackEvery:2}));
  assert.ok(attacks[0].maxEaseRatio>=attacks[1].maxEaseRatio&&attacks[1].maxEaseRatio>=attacks[2].maxEaseRatio&&attacks[2].maxEaseRatio>=attacks[3].maxEaseRatio);
  assert.ok(attacks.every(x=>x.maxLeadSeconds<=90.000001));
});
