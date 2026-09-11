import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {
  DAA_STATUS,TARGET_SECONDS,MTP_WINDOW,FUTURE_DRIFT_MS,TESTNET_CANDIDATE_HALF_LIFE_SECONDS,HALF_LIFE_CANDIDATES_SECONDS,POW_LIMIT,
  targetFromLeadingZeroBits,targetHex,targetFromHex,hashMeetsTarget,medianTimePast,validateCandidateTimestamp,asertTargetCandidate,timestampAttackEaseBoundPpm
} from '../node/authoritative/difficulty-timestamp-candidate.mjs';

const vectors=JSON.parse(readFileSync(new URL('../protocol/DIFFICULTY_TIMESTAMP_VECTORS.json',import.meta.url),'utf8'));

function simulateExpectedRecovery(halfLifeSeconds,hashMultiplier,{maxBlocks=5000}={}){
  const anchorTarget=targetFromLeadingZeroBits(20);let height=1,timeSeconds=180;const rows=[];
  for(let i=0;i<maxBlocks;i++){
    const target=asertTargetCandidate({anchorTarget,anchorHeight:1,anchorParentTimeSeconds:0,evaluationHeight:height,evaluationTimeSeconds:Math.floor(timeSeconds),halfLifeSeconds,powLimit:POW_LIMIT});
    const expectedInterval=TARGET_SECONDS*(Number(anchorTarget)/Number(target))/hashMultiplier;
    timeSeconds+=expectedInterval;height++;
    rows.push({elapsedHours:(timeSeconds-180)/3600,expectedInterval,target});
  }
  return rows;
}
function firstHour(rows,predicate){const row=rows.find(predicate);return row?row.elapsedHours:null}

test('candidate remains explicitly non-authoritative and freezes the research parameter surface',()=>{
  assert.equal(DAA_STATUS,'candidate-not-active-consensus');assert.equal(vectors.status,DAA_STATUS);
  assert.equal(TARGET_SECONDS,180);assert.equal(MTP_WINDOW,11);assert.equal(FUTURE_DRIFT_MS,90_000);assert.equal(TESTNET_CANDIDATE_HALF_LIFE_SECONDS,21_600);
  assert.deepEqual(HALF_LIFE_CANDIDATES_SECONDS,[21_600,43_200,86_400,172_800]);
});

test('target encoding and PoW comparison use exact integer targets',()=>{
  const target=targetFromLeadingZeroBits(18),encoded=targetHex(target);assert.equal(targetFromHex(encoded),target);assert.equal(hashMeetsTarget(encoded,target),true);
  assert.equal(hashMeetsTarget((target+1n).toString(16).padStart(64,'0'),target),false);
});

test('frozen ASERT vectors reproduce exactly',()=>{
  const a=vectors.asert,anchorTarget=targetFromHex(a.anchor_target_hex);
  for(const vector of a.vectors){
    const actual=asertTargetCandidate({anchorTarget,anchorHeight:a.anchor_height,anchorParentTimeSeconds:a.anchor_parent_time_seconds,evaluationHeight:a.evaluation_height,evaluationTimeSeconds:vector.evaluation_time_seconds,halfLifeSeconds:a.half_life_seconds,powLimit:POW_LIMIT});
    assert.equal(targetHex(actual),vector.expected_target_hex,vector.name);
  }
});

test('ASERT has exact schedule invariance and exact powers-of-two response at a half-life',()=>{
  const anchorTarget=targetFromLeadingZeroBits(20),anchorHeight=100,anchorParentTimeSeconds=1_000_000,evaluationHeight=200,onSchedule=anchorParentTimeSeconds+TARGET_SECONDS*(evaluationHeight-anchorHeight+1);
  const same=asertTargetCandidate({anchorTarget,anchorHeight,anchorParentTimeSeconds,evaluationHeight,evaluationTimeSeconds:onSchedule,halfLifeSeconds:21_600,powLimit:POW_LIMIT});
  const late=asertTargetCandidate({anchorTarget,anchorHeight,anchorParentTimeSeconds,evaluationHeight,evaluationTimeSeconds:onSchedule+21_600,halfLifeSeconds:21_600,powLimit:POW_LIMIT});
  const early=asertTargetCandidate({anchorTarget,anchorHeight,anchorParentTimeSeconds,evaluationHeight,evaluationTimeSeconds:onSchedule-21_600,halfLifeSeconds:21_600,powLimit:POW_LIMIT});
  assert.equal(same,anchorTarget);assert.equal(late,anchorTarget*2n);assert.equal(early,anchorTarget/2n);
});

test('ASERT clamps to the declared easiest target and never returns zero',()=>{
  const anchorTarget=targetFromLeadingZeroBits(13),args={anchorTarget,anchorHeight:1,anchorParentTimeSeconds:0,evaluationHeight:2,halfLifeSeconds:21_600,powLimit:POW_LIMIT};
  assert.equal(asertTargetCandidate({...args,evaluationTimeSeconds:10_000_000}),POW_LIMIT);assert.equal(asertTargetCandidate({...args,evaluationTimeSeconds:-10_000_000}),1n);
});

test('MTP and bounded-future timestamp vectors fail closed at their exact boundaries',()=>{
  const t=vectors.timestamp,chain=t.recent_chain_timestamps_ms.map(timestamp_ms=>({timestamp_ms}));assert.equal(medianTimePast(chain),t.expected_mtp_ms);
  for(const vector of t.vectors){const result=validateCandidateTimestamp(chain,vector.timestamp_ms,{nowMs:t.now_ms});assert.equal(result.ok,vector.ok,vector.name);if(!vector.ok)assert.equal(result.error,vector.error,vector.name)}
  const adversarial=[100,200,300,400,500,600,700,800,900,1000,150].map(timestamp_ms=>({timestamp_ms}));assert.equal(validateCandidateTimestamp(adversarial,500,{nowMs:10_000}).error,'timestamp_not_above_mtp');
});

test('the full 90-second forward-drift budget cannot create a material ASERT easing step',()=>{
  const bounds=HALF_LIFE_CANDIDATES_SECONDS.map(halfLifeSeconds=>timestampAttackEaseBoundPpm({halfLifeSeconds}));
  assert.deepEqual(bounds,[2888,1444,722,361]);assert.ok(bounds[0]<3000);
});

test('6h testnet candidate dominates 12/24/48h for severe browser-hash exit recovery without changing the 180s steady target',()=>{
  const results=HALF_LIFE_CANDIDATES_SECONDS.map(halfLifeSeconds=>{
    const loss=simulateExpectedRecovery(halfLifeSeconds,0.2),gain=simulateExpectedRecovery(halfLifeSeconds,1.8);
    return{halfLifeHours:halfLifeSeconds/3600,lossTo600:firstHour(loss,row=>row.expectedInterval<=600),lossTo360:firstHour(loss,row=>row.expectedInterval<=360),gainTo120:firstHour(gain,row=>row.expectedInterval>=120)};
  });
  assert.ok(results[0].lossTo600<5);assert.ok(results[1].lossTo600>9);assert.ok(results[2].lossTo600>18);assert.ok(results[3].lossTo600>37);
  assert.ok(results[0].lossTo360<13);assert.ok(results[1].lossTo360>24);assert.ok(results[2].lossTo360>48);assert.ok(results[3].lossTo360>96);
  assert.ok(results[0].gainTo120<3);assert.ok(results[1].gainTo120>5);assert.ok(results[2].gainTo120>10);assert.ok(results[3].gainTo120>19);
});
