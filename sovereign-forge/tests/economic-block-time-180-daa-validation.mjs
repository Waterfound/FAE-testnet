import assert from 'node:assert/strict';
import test from 'node:test';
import {simulate,runStudy} from '../node/lab/economic-block-time-180-daa-validation.mjs';
import {TARGET_SECONDS,RETARGET_INTERVAL,START_BITS} from '../node/authoritative/fae-v4-core.mjs';

test('harness binds exact active v4 constants',()=>{
  assert.equal(TARGET_SECONDS,180);
  assert.equal(RETARGET_INTERVAL,20);
  assert.equal(START_BITS,18);
});

test('deterministic stable hash remains at the active start difficulty',()=>{
  const chain=simulate({blocks:200,factor:1});
  assert.equal(chain.at(-1).difficulty_bits,18);
  assert.equal(chain.reduce((s,r)=>s+r.interval_ms,0)/chain.length/1000,180);
});

test('precommitted shock envelope converges without floor or ceiling lock',()=>{
  for(const factor of [0.1,0.2,0.5,2,5,10]){
    const chain=simulate({blocks:400,factor,shockHeight:61});
    const tail=chain.slice(-100);
    assert.ok(tail.every(r=>r.difficulty_bits>12&&r.difficulty_bits<28));
    const distinct=new Set(tail.map(r=>r.difficulty_bits));
    assert.equal(distinct.size,1,'deterministic tail should converge to one integer difficulty');
  }
});

test('active integer-bit quantization is explicitly preserved',()=>{
  const lower=180/Math.sqrt(2),upper=180*Math.sqrt(2);
  const study=runStudy({seeds:8});
  assert.equal(study.quantization.exact_relative_stationary_interval_envelope.seconds_at_180.lower,lower);
  assert.equal(study.quantization.exact_relative_stationary_interval_envelope.seconds_at_180.upper,upper);
  assert.ok(lower<180&&upper>180);
});

test('timestamp edge cases remain bounded by the harness and do not become activation evidence',()=>{
  const study=runStudy({seeds:8});
  assert.equal(study.selectionAuthorized,false);
  assert.equal(study.activationAuthorized,false);
  assert.equal(study.timestamp_study.full_control_edge_cases.honest.final_bits,18);
  assert.ok(study.timestamp_study.full_control_edge_cases.freeze.final_bits>=18);
});
