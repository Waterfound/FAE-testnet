import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';

function evaluate(m,{remainingFreeHours=null,workspaceSuspended=m.current_infrastructure?.workspace_suspended}={}){
  const errors=[];
  const envelope=Number(m.duration_hours)+Number(m.margin_hours);
  const services=Number(m.topology?.continuous_services);
  const required=envelope*services;
  if(m.max_transient_outage_seconds!==180)errors.push('transient_bound_changed');
  if(JSON.stringify(m.phase_hours)!==JSON.stringify([24,24,24,24]))errors.push('phase_shape_changed');
  if(services!==5)errors.push('five_continuous_roles_required');
  if(required!==Number(m.topology?.required_instance_hours_with_margin))errors.push('hour_budget_math_mismatch');
  if(required>Number(m.topology?.monthly_free_instance_hours))errors.push('free_quota_insufficient');
  if(Number(m.topology?.render_log_retention_hours)<envelope)errors.push('log_retention_below_experiment_envelope');
  if(Number(m.recovery_evidence?.fresh_bootstrap_max_ms)>=180000)errors.push('fresh_bootstrap_exceeds_bound');
  if(Number(m.recovery_evidence?.v3_sized_bootstrap_ms)>=180000)errors.push('scale_bootstrap_exceeds_bound');
  if(m.authority?.public_testnet_v4_unchanged!==true||m.authority?.new_economy_activation!==false||m.authority?.candidate_promoted!==false||m.authority?.mainnet_authorized!==false)errors.push('authority_violation');
  if(m.run_started!==false)errors.push('candidate_must_not_be_running');
  if(workspaceSuspended)errors.push('workspace_suspended');
  if(remainingFreeHours!==null&&Number(remainingFreeHours)<required)errors.push('remaining_free_hours_below_required');
  return{ok:errors.length===0,errors,requiredHours:required,envelopeHours:envelope};
}

const path=new URL('../release/stability-soak-v3-zero-cost-candidate.json',import.meta.url);
const m=JSON.parse(await readFile(path,'utf8'));

test('zero-cost candidate fits the nominal monthly free-hour budget',()=>{
  const r=evaluate(m,{workspaceSuspended:false,remainingFreeHours:750});
  assert.equal(r.requiredHours,540);
  assert.equal(r.envelopeHours,108);
  assert.equal(r.ok,true);
});

test('current observed Render workspace fails closed because billing suspension remains active',()=>{
  const r=evaluate(m);
  assert.equal(r.ok,false);
  assert.ok(r.errors.includes('workspace_suspended'));
});

test('candidate refuses to start if fewer than 540 free instance-hours remain',()=>{
  const r=evaluate(m,{workspaceSuspended:false,remainingFreeHours:539});
  assert.equal(r.ok,false);
  assert.ok(r.errors.includes('remaining_free_hours_below_required'));
});

test('208s cannot be normalized into a new threshold',()=>{
  const changed=structuredClone(m);changed.max_transient_outage_seconds=208;
  const r=evaluate(changed,{workspaceSuspended:false,remainingFreeHours:750});
  assert.equal(r.ok,false);
  assert.ok(r.errors.includes('transient_bound_changed'));
});
