import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateBe06PrecreateEvidence} from '../be06-provider-precreate-guard.mjs';

const common={
  account_scope_verified:true,
  selected_resources_explicitly_free_eligible:true,
  estimated_monthly_cost_usd:0,
  monthly_cost_ceiling_usd:0,
  paid_upgrade_required:false,
  paid_addons_present:false,
  protected_capacity_consumed:false,
  provider_console_cost_preview_verified_zero:true
};

const oracle={
  ...common,
  provider:'oracle_cloud',
  oracle_cloud:{
    shape:'VM.Standard.A1.Flex',
    home_region_verified:true,
    always_free_compute_label_observed:true,
    within_remaining_compute_entitlement:true,
    boot_and_durable_storage_within_free_entitlement:true,
    public_network_zero_cost_verified:true,
    current_capacity_available:true,
    runtime_architecture_compatible:true,
    synthetic_reclaim_evasion:false,
    post_create_reclaim_observation_required:true
  }
};

const google={
  ...common,
  provider:'google_cloud',
  google_cloud:{
    machine_type:'e2-micro',
    region:'us-east1',
    non_preemptible:true,
    pd_standard_gb:30,
    external_ipv4:false,
    external_ipv6:true,
    public_https_ipv6_path_planned:true,
    free_tier_usage_remaining_verified:true,
    runtime_architecture_compatible:true,
    egress_fail_closed:true
  }
};

test('BE-06 precreate guard admits a fully evidenced Oracle zero-cost candidate without authorizing creation',()=>{
  const r=evaluateBe06PrecreateEvidence(oracle);
  assert.equal(r.admitted,true);
  assert.equal(r.resource_creation_authorized,false);
  assert.equal(r.persistent_host_eligible,false);
  assert.equal(r.explorer_live_authorized,false);
});

test('BE-06 precreate guard rejects Oracle synthetic reclaim evasion and missing Always Free evidence',()=>{
  const synthetic=structuredClone(oracle);
  synthetic.oracle_cloud.synthetic_reclaim_evasion=true;
  assert.equal(evaluateBe06PrecreateEvidence(synthetic).admitted,false);

  const noLabel=structuredClone(oracle);
  noLabel.oracle_cloud.always_free_compute_label_observed=false;
  assert.equal(evaluateBe06PrecreateEvidence(noLabel).admitted,false);
});

test('BE-06 precreate guard admits only the zero-cost Google IPv6 candidate shape',()=>{
  const r=evaluateBe06PrecreateEvidence(google);
  assert.equal(r.admitted,true);
  assert.equal(r.resource_creation_authorized,false);
  assert.equal(r.persistent_host_eligible,false);
});

test('BE-06 precreate guard rejects Google external IPv4, wrong region, oversized disk, or preemptible VM',()=>{
  for(const mutate of [
    e=>{e.google_cloud.external_ipv4=true},
    e=>{e.google_cloud.region='southamerica-east1'},
    e=>{e.google_cloud.pd_standard_gb=31},
    e=>{e.google_cloud.non_preemptible=false}
  ]){
    const e=structuredClone(google);
    mutate(e);
    assert.equal(evaluateBe06PrecreateEvidence(e).admitted,false);
  }
});

test('BE-06 precreate guard fails closed on any nonzero cost or protected-capacity reuse',()=>{
  for(const patch of [
    {estimated_monthly_cost_usd:0.01},
    {monthly_cost_ceiling_usd:1},
    {paid_addons_present:true},
    {protected_capacity_consumed:true},
    {provider_console_cost_preview_verified_zero:false}
  ]){
    assert.equal(evaluateBe06PrecreateEvidence({...oracle,...patch}).admitted,false);
  }
});

test('BE-06 precreate admission never equals persistent-host or deployment authority',()=>{
  for(const fixture of [oracle,google]){
    const r=evaluateBe06PrecreateEvidence(fixture);
    assert.equal(r.admitted,true);
    assert.equal(r.resource_creation_authorized,false);
    assert.equal(r.spend_authorized,false);
    assert.equal(r.persistent_host_eligible,false);
    assert.equal(r.explorer_binding_authorized,false);
    assert.equal(r.explorer_live_authorized,false);
  }
});
