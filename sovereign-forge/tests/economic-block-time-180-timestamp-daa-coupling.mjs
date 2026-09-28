import assert from 'node:assert/strict';
import test from 'node:test';
import {runTimestampStudy} from '../node/lab/economic-block-time-180-timestamp-daa-coupling.mjs';

test('paired timestamp study preserves authority fence',()=>{
  const r=runTimestampStudy({seeds:8});
  assert.equal(r.selectionAuthorized,false);
  assert.equal(r.activationAuthorized,false);
  assert.equal(r.active_rules.target_seconds,180);
  assert.equal(r.active_rules.future_wall_seconds,120);
  assert.equal(r.active_rules.past_wall_seconds,null);
});

test('timestamp strategies do not alter exogenous attacker block share',()=>{
  const r=runTimestampStudy({seeds:8});
  for(const share of [0.1,0.25,0.5,0.75]){
    for(const strategy of ['freeze','future-edge','endpoint-ease']){
      assert.equal(r.results[share][strategy].attacker_block_share_delta.median,0);
    }
  }
});

test('constant future-edge offset is not a persistent DAA advantage in paired model',()=>{
  const r=runTimestampStudy({seeds:16});
  for(const share of [0.1,0.25,0.5,0.75]){
    const x=r.results[share]['future-edge'].interval_ratio_vs_paired_honest.median;
    assert.ok(x>0.95&&x<1.05);
  }
});
