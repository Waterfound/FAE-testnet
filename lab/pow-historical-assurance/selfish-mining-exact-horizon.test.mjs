import test from 'node:test';
import assert from 'node:assert/strict';
import {exactSelfishHorizon,exactOneEventTrailHorizon} from './selfish-mining-exact-horizon.mjs';

test('HPA-W3-39: deterministic finite-horizon model conserves probability mass',()=>{
  for(const alpha of [.1,.2,.25,.3,.4])for(const gamma of [0,.25,.5,1]){
    const r=exactSelfishHorizon({alpha,gamma,events:1000});
    assert.ok(Math.abs(r.probability_mass-1)<1e-11,{alpha,gamma,mass:r.probability_mass});
    assert.ok(r.expected_attacker_accepted_blocks>=0);
    assert.ok(r.expected_honest_accepted_blocks>=0);
    assert.equal(r.actual_profitability_proven,false);
  }
});

test('HPA-W3-40: conditional tie propagation advantage is monotonic within the declared model',()=>{
  const rows=[0,.25,.5,.75,1].map(gamma=>exactSelfishHorizon({alpha:.25,gamma,events:3000}));
  for(let i=1;i<rows.length;i++)
    assert.ok(rows[i].attacker_revenue_share>=rows[i-1].attacker_revenue_share-1e-12);
  assert.equal(rows[0].propagation_gamma_observed,false);
  assert.equal(rows.at(-1).final_tie_policy_selected,false);
});

test('HPA-W3-41: longer exact horizons converge without Monte Carlo seed dependence',()=>{
  const short=exactSelfishHorizon({alpha:.3,gamma:.25,events:500});
  const long=exactSelfishHorizon({alpha:.3,gamma:.25,events:5000});
  const repeat=exactSelfishHorizon({alpha:.3,gamma:.25,events:5000});
  assert.deepEqual(long,repeat);
  assert.ok(long.unresolved_terminal_probability<.5);
  assert.ok(Math.abs(long.attacker_revenue_share-short.attacker_revenue_share)<.01);
});

test('HPA-W3-42: threshold sensitivity remains conditional and invalid assumptions fail closed',()=>{
  const below=exactSelfishHorizon({alpha:.2,gamma:.5,events:5000});
  const above=exactSelfishHorizon({alpha:.3,gamma:.5,events:5000});
  assert.ok(below.profitability_delta<0);
  assert.ok(above.profitability_delta>0);
  assert.equal(below.actual_profitability_proven,false);
  for(const args of [{alpha:0,gamma:.5},{alpha:.5,gamma:.5},{alpha:.2,gamma:-1},
    {alpha:.2,gamma:1.1},{alpha:.2,gamma:.5,events:0},{alpha:.2,gamma:.5,events:100001}])
    assert.throws(()=>exactSelfishHorizon(args),/invalid_selfish_horizon_assumptions/);
});

test('HPA-W3-43: one-event trail counterfactual conserves mass and retains epistemic limits',()=>{
  for(const alpha of [.1,.2,.3,.4])for(const gamma of [0,.5,1]){
    const r=exactOneEventTrailHorizon({alpha,gamma,events:2000});
    assert.ok(Math.abs(r.probability_mass-1)<1e-11,{alpha,gamma,mass:r.probability_mass});
    assert.equal(r.full_literature_strategy_equivalence_proven,false);
    assert.equal(r.propagation_gamma_observed,false);
    assert.equal(r.actual_profitability_proven,false);
  }
});

test('HPA-W3-44: trail counterfactual is deterministic and bounded against classic release',()=>{
  const classic=exactSelfishHorizon({alpha:.25,gamma:.5,events:5000});
  const trail=exactOneEventTrailHorizon({alpha:.25,gamma:.5,events:5000});
  assert.deepEqual(trail,exactOneEventTrailHorizon({alpha:.25,gamma:.5,events:5000}));
  assert.ok(Number.isFinite(trail.attacker_revenue_share));
  assert.ok(Math.abs(trail.attacker_revenue_share-classic.attacker_revenue_share)<.1);
  assert.ok(trail.trail_or_second_race_terminal_probability>=0);
});

test('HPA-W3-45: conditional gamma advantage remains monotonic for the explicit trail policy',()=>{
  const rows=[0,.25,.5,.75,1].map(gamma=>
    exactOneEventTrailHorizon({alpha:.25,gamma,events:3000}));
  for(let i=1;i<rows.length;i++)
    assert.ok(rows[i].attacker_revenue_share>=rows[i-1].attacker_revenue_share-1e-12);
});

test('HPA-W3-46: trail policy input violations fail closed',()=>{
  for(const args of [{alpha:0,gamma:.5},{alpha:.5,gamma:.5},{alpha:.2,gamma:-1},
    {alpha:.2,gamma:1.1},{alpha:.2,gamma:.5,events:0},{alpha:.2,gamma:.5,events:100001}])
    assert.throws(()=>exactOneEventTrailHorizon(args),/invalid_trail_horizon_assumptions/);
});
