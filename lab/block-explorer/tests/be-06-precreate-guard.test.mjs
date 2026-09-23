import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {evaluateBe06PrecreateEvidence} from '../be06-provider-precreate-guard.mjs';

const common={
  account_scope_verified:true,
  selected_resources_explicitly_free_eligible:true,
  monthly_cost_ceiling_usd:0,
  paid_upgrade_required:false,
  paid_addons_present:false,
  protected_capacity_consumed:false
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
    selected_image_price_free:true,
    public_network_zero_cost_verified:true,
    runtime_architecture_compatible:true,
    shape_selectable_in_home_region:true,
    estimator_excludes_tier_unit_pricing:true,
    entitlement_calculated_monthly_cost_usd:0,
    trial_credit_reliance:false,
    raw_estimated_monthly_cost_brl:10.45,
    boot_volume_gb:46.6,
    free_block_volume_available_gb:200,
    synthetic_reclaim_evasion:false,
    post_create_reclaim_observation_required:true,
    physical_capacity_must_be_rechecked_at_launch:true,
    public_ipv4_at_launch:false,
    post_create_reserved_public_ipv4_required:true,
    reserved_public_ipv4_available:true,
    public_ipv4_no_charge_verified:true,
    ingress_hardening_before_public_ipv4_required:true,
    world_open_tcp_22_forbidden:true,
    admin_path_without_ssh_key_verified:true,
    cloud_guard_workload_protection_enabled:false,
    compute_instance_run_command_enabled:true,
    compute_instance_monitoring_enabled:true
  }
};

const google={
  ...common,
  provider:'google_cloud',
  estimated_monthly_cost_usd:0,
  provider_console_cost_preview_verified_zero:true,
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

test('BE-06 admits Oracle entitlement evidence even when OCI raw estimator shows list price',()=>{
  const r=evaluateBe06PrecreateEvidence(oracle);
  assert.equal(r.admitted,true);
  assert.equal(r.safe_to_request_host_creation_authority,true);
  assert.equal(r.resource_creation_authorized,false);
  assert.equal(r.spend_authorized,false);
  assert.equal(r.persistent_host_eligible,false);
});

test('BE-06 rejects Oracle if tier-pricing disclaimer or free entitlement proof is missing',()=>{
  for(const mutate of [
    e=>{e.oracle_cloud.estimator_excludes_tier_unit_pricing=false},
    e=>{e.oracle_cloud.entitlement_calculated_monthly_cost_usd=0.01},
    e=>{e.oracle_cloud.boot_and_durable_storage_within_free_entitlement=false},
    e=>{e.oracle_cloud.selected_image_price_free=false},
    e=>{e.oracle_cloud.trial_credit_reliance=true}
  ]){
    const e=structuredClone(oracle);
    mutate(e);
    assert.equal(evaluateBe06PrecreateEvidence(e).admitted,false);
  }
});

test('BE-06 rejects Oracle storage over remaining Always Free entitlement',()=>{
  const e=structuredClone(oracle);
  e.oracle_cloud.boot_volume_gb=200.01;
  assert.equal(evaluateBe06PrecreateEvidence(e).admitted,false);
});

test('BE-06 keeps Oracle physical capacity and reclaim as launch/post-create gates',()=>{
  for(const mutate of [
    e=>{e.oracle_cloud.shape_selectable_in_home_region=false},
    e=>{e.oracle_cloud.physical_capacity_must_be_rechecked_at_launch=false},
    e=>{e.oracle_cloud.synthetic_reclaim_evasion=true},
    e=>{e.oracle_cloud.post_create_reclaim_observation_required=false}
  ]){
    const e=structuredClone(oracle);
    mutate(e);
    assert.equal(evaluateBe06PrecreateEvidence(e).admitted,false);
  }
});

test('BE-06 admits only the zero-cost Google IPv6 fallback shape',()=>{
  const r=evaluateBe06PrecreateEvidence(google);
  assert.equal(r.admitted,true);
  assert.equal(r.resource_creation_authorized,false);
});

test('BE-06 keeps explicit zero preview mandatory for Google fallback',()=>{
  for(const mutate of [
    e=>{e.estimated_monthly_cost_usd=0.01},
    e=>{e.provider_console_cost_preview_verified_zero=false},
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

test('BE-06 fails closed on any nonzero ceiling or protected-capacity reuse',()=>{
  for(const fixture of [oracle,google]){
    for(const patch of [
      {monthly_cost_ceiling_usd:1},
      {paid_addons_present:true},
      {protected_capacity_consumed:true}
    ]){
      assert.equal(evaluateBe06PrecreateEvidence({...fixture,...patch}).admitted,false);
    }
  }
});

test('BE-06 precreate admission never equals deployment authority',()=>{
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


test('BE-06 exact Oracle account evidence input is admitted but remains non-authoritative',async()=>{
  const exact=JSON.parse(await readFile(new URL('../be06-oracle-precreate-input-20260923.json',import.meta.url),'utf8'));
  const r=evaluateBe06PrecreateEvidence(exact);
  assert.equal(r.admitted,true);
  assert.equal(r.safe_to_request_host_creation_authority,true);
  assert.equal(r.resource_creation_authorized,false);
  assert.equal(r.spend_authorized,false);
  assert.equal(r.persistent_host_eligible,false);
  assert.equal(r.explorer_binding_authorized,false);
  assert.equal(r.explorer_live_authorized,false);
});


test('BE-06 rejects unsafe Oracle exposure sequencing',()=>{
  for(const mutate of [
    e=>{e.oracle_cloud.public_ipv4_at_launch=true},
    e=>{e.oracle_cloud.post_create_reserved_public_ipv4_required=false},
    e=>{e.oracle_cloud.reserved_public_ipv4_available=false},
    e=>{e.oracle_cloud.public_ipv4_no_charge_verified=false},
    e=>{e.oracle_cloud.ingress_hardening_before_public_ipv4_required=false},
    e=>{e.oracle_cloud.world_open_tcp_22_forbidden=false},
    e=>{e.oracle_cloud.admin_path_without_ssh_key_verified=false}
  ]){
    const e=structuredClone(oracle);
    mutate(e);
    assert.equal(evaluateBe06PrecreateEvidence(e).admitted,false);
  }
});


test('BE-06 rejects paid-risk Oracle agent configuration',()=>{
  for(const mutate of [
    e=>{e.oracle_cloud.cloud_guard_workload_protection_enabled=true},
    e=>{e.oracle_cloud.compute_instance_run_command_enabled=false},
    e=>{e.oracle_cloud.compute_instance_monitoring_enabled=false}
  ]){
    const e=structuredClone(oracle);
    mutate(e);
    assert.equal(evaluateBe06PrecreateEvidence(e).admitted,false);
  }
});
