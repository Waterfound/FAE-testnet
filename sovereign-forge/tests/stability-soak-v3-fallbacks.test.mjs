import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';

const path=new URL('../release/stability-soak-v3-fallbacks.json',import.meta.url);
const m=JSON.parse(await readFile(path,'utf8'));

function distinct(xs){return new Set(xs).size===xs.length}
function evaluateCommon(plan){
  const errors=[];
  const common=m.common_invariants;
  if(common.duration_hours!==96||common.margin_hours!==12)errors.push('duration_or_margin_changed');
  if(common.max_transient_outage_seconds!==180)errors.push('recovery_bound_changed');
  if(JSON.stringify(common.phase_hours)!==JSON.stringify([24,24,24,24]))errors.push('phase_shape_changed');
  if(common.public_testnet_v4_unchanged!==true||common.new_economy_activation!==false||common.candidate_promoted!==false||common.mainnet_authorized!==false)errors.push('authority_violation');
  if(common.run_started!==false)errors.push('fallback_must_not_start_run');
  if(!Array.isArray(plan.nodes)||plan.nodes.length!==3)errors.push('three_nodes_required');
  if(!distinct(plan.nodes.map(n=>n.region)))errors.push('three_distinct_node_regions_required');
  if(!plan.controller||!plan.observer)errors.push('controller_observer_required');
  return errors;
}

test('Plan B preserves V3 node geography and cuts Render envelope to 324h',()=>{
  const p=m.plan_b,errors=evaluateCommon(p);
  assert.deepEqual(errors,[]);
  assert.equal(p.render_instance_hours_required,3*(96+12));
  assert.equal(p.render_instance_hours_required,324);
  assert.equal(p.remaining_render_dependency,true);
  assert.equal(p.controller.provider,'embedded-node-a');
  assert.equal(p.controller.additional_render_instance_hours,0);
  assert.ok(p.observer.estimated_invocations_per_day<100000);
  assert.ok(p.observer.estimated_d1_rows_written_per_day_upper<100000);
});

test('Plan C removes Render and uses three providers in three regions',()=>{
  const p=m.plan_c,errors=evaluateCommon(p);
  assert.deepEqual(errors,[]);
  assert.equal(p.render_dependency,false);
  assert.equal(distinct(p.nodes.map(n=>n.provider)),true);
  assert.equal(distinct(p.nodes.map(n=>n.region)),true);
  assert.deepEqual(p.nodes.map(n=>n.provider),['google-cloud','koyeb','oracle-cloud']);
  assert.equal(p.controller.provider,'embedded-node-a');
  assert.equal(p.controller.additional_provider_instance_hours,0);
  assert.ok(p.observer.estimated_d1_rows_written_per_day_upper<100000);
});

test('fallbacks remain preparation-only and cannot authorize paid overage',()=>{
  assert.equal(m.status,'FALLBACKS_PREPARED_NOT_AUTHORIZED');
  assert.equal(m.plan_b.promotion_authority,false);
  assert.equal(m.plan_c.promotion_authority,false);
  assert.match(m.plan_c.zero_cost_assumption,/no paid upgrade or overage is authorized/i);
});

test('forbidden shortcuts remain rejected',()=>{
  const reasons=new Map(m.rejected_shortcuts.map(x=>[x.option,x.reason]));
  assert.match(reasons.get('github-actions-hosted-runners-as-continuous-nodes'),/6 hours/);
  assert.match(reasons.get('raise_180s_recovery_bound'),/forbidden/);
  assert.match(reasons.get('cloudflare-free-workflows-as-pow-controller'),/10 ms/);
});

test('fallback runtime freeze is pinned and telemetry preserves fine timing without optimistic outage inference',()=>{
  assert.equal(m.frozen_fallback_runtime_commit,'140be01baff5a770263f81a13b728e63b0ce02cb');
  assert.equal(m.common_invariants.telemetry.node_local_tip_first_seen_resolution_ms,25);
  assert.equal(m.common_invariants.telemetry.peer_reachability_probe_seconds,1);
  assert.match(m.common_invariants.telemetry.observer_gap_policy,/fail closed/i);
});
