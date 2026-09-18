import assert from 'node:assert/strict';
import test from 'node:test';
import {evaluateStabilitySoakV3Preflight} from './stability-soak-v3-preflight.mjs';

const telemetry=Object.fromEntries([
  'process_boot_id','process_started_at','provider_instance_id','state_height','state_tip_hash','state_generation',
  'peer_directory_count','peer_directory_digest','configured_peer_count','bootstrap_attempts','bootstrap_last_error',
  'transport_reachability','restart_classification','outage_start_end','recovery_duration_ms','propagation_p95',
  'stale_count','reorg_count'
].map(key=>[key,true]));

function base(){
  return{
    format:'FAE_STABILITY_SOAK_V3_PREFLIGHT_V1',
    software_commit:'745faec3c2ee3fd214199b60293f46e7b9d5a92b',
    authority:{public_testnet_v4_unchanged:true,new_economy_activation:false,candidate_promoted:false,mainnet_authorized:false},
    duration_hours:96,margin_hours:12,max_transient_outage_seconds:180,phase_hours:[24,24,24,24],
    nodes:[
      {role:'node-a',service_id:'a',provider:'render',region:'oregon',plan:'0.5c-512mb',suspended:false,auto_deploy:false,continuous_capacity_hours:108,persistent_state:true,persistent_identity:true,persistent_peer_bootstrap:true},
      {role:'node-b',service_id:'b',provider:'render',region:'frankfurt',plan:'0.5c-512mb',suspended:false,auto_deploy:false,continuous_capacity_hours:108,persistent_state:true,persistent_identity:true,persistent_peer_bootstrap:true},
      {role:'node-c',service_id:'c',provider:'render',region:'singapore',plan:'0.5c-512mb',suspended:false,auto_deploy:false,continuous_capacity_hours:108,persistent_state:true,persistent_identity:true,persistent_peer_bootstrap:true}
    ],
    controller:{role:'controller',service_id:'ctl',provider:'render',region:'virginia',plan:'0.5c-512mb',suspended:false,auto_deploy:false,continuous_capacity_hours:108,durable_evidence_sink:true},
    observer:{role:'observer',service_id:'obs',provider:'render',region:'ohio',plan:'0.5c-512mb',suspended:false,auto_deploy:false,continuous_capacity_hours:108,independent_observer:true},
    telemetry,
    statistics:{wilson_one_sided_confidence:0.95,stale_rate_threshold:0.01,wilson_upper_threshold:0.01,propagation_p95_max_ms:5000},
    infrastructure_evidence:{billing_or_quota_clear:true,no_known_96h_suspension_limit:true},
    run_started:false
  };
}

test('eligible V3 topology passes without starting the soak',()=>{
  const result=evaluateStabilitySoakV3Preflight(base());
  assert.deepEqual(result.errors,[]);
  assert.equal(result.ok,true);
});

test('current Render Free topology fails closed before a V3 run can start',()=>{
  const m=base();
  for(const s of [...m.nodes,m.controller,m.observer]){
    s.plan='free';
    s.suspended='suspended';
    s.continuous_capacity_hours=0;
  }
  for(const n of m.nodes){n.persistent_state=false;n.persistent_identity=false;}
  m.infrastructure_evidence.billing_or_quota_clear=false;
  m.infrastructure_evidence.no_known_96h_suspension_limit=false;
  const result=evaluateStabilitySoakV3Preflight(m);
  assert.equal(result.ok,false);
  assert.ok(result.errors.includes('node-a:free_plan_not_admissible'));
  assert.ok(result.errors.includes('node-b:service_suspended'));
  assert.ok(result.errors.includes('node-c:persistent_state_required'));
  assert.ok(result.errors.includes('billing_or_quota_clear_not_proven'));
  assert.ok(result.errors.includes('96h_provider_continuity_not_proven'));
});

test('the historical 208s incident cannot be normalized by changing the frozen threshold',()=>{
  const m=base();m.max_transient_outage_seconds=208;
  const result=evaluateStabilitySoakV3Preflight(m);
  assert.equal(result.ok,false);
  assert.ok(result.errors.includes('transient_bound_must_remain_180s'));
});
