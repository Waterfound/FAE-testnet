import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {evaluateBe06HostEvidence} from '../be06-host-preflight.mjs';

const root=new URL('../../../',import.meta.url);
const read=async path=>readFile(new URL(path,root),'utf8');

test('BE-06 hardening keeps deployment, binding and LIVE authority closed',async()=>{
  const c=JSON.parse(await read('lab/block-explorer/be06-host-hardening-v1.json'));
  assert.equal(c.authority,'PREPROVISION_ONLY_NO_SPEND_NO_BINDING_NO_LIVE');
  assert.equal(c.cost_guard.be06_monthly_cost_ceiling_usd,0);
  assert.equal(c.cost_guard.paid_upgrade_authorized,false);
  assert.equal(c.cost_guard.protected_capacity_may_be_consumed,false);
  assert.equal(c.provisioning_gate.resource_creation_authorized_by_this_contract,false);
  assert.equal(c.deployment_binding_gate.explorer_binding_authorized_by_this_contract,false);
  assert.equal(c.deployment_binding_gate.explorer_live_authorized_by_this_contract,false);
});

test('BE-06 hardening exposes only HTTPS edge and preserves loopback node boundary',async()=>{
  const c=JSON.parse(await read('lab/block-explorer/be06-host-hardening-v1.json'));
  assert.equal(c.process_topology.independent_node.bind,'127.0.0.1');
  assert.equal(c.process_topology.independent_node.public_exposure,false);
  assert.equal(c.process_topology.readonly_gateway.bind,'127.0.0.1');
  assert.equal(c.process_topology.readonly_gateway.public_exposure,false);
  assert.deepEqual(c.process_topology.https_edge.public_ports,[80,443]);
  assert.deepEqual(c.process_topology.https_edge.methods,['GET','OPTIONS']);
  assert.equal(c.network_hardening.administration.world_open_tcp_22,false);
  assert.equal(c.network_hardening.cors.wildcard_origin_forbidden,true);
  assert.equal(c.network_hardening.cors.post_forbidden,true);
});

test('BE-06 provider evidence does not confuse public free-tier docs with account eligibility',async()=>{
  const e=JSON.parse(await read('lab/block-explorer/be06-provider-eligibility-20260923.json'));
  assert.equal(e.providers.oracle_cloud.account_specific_evidence.observed,false);
  assert.equal(e.providers.google_cloud.account_specific_evidence.observed,false);
  assert.equal(e.providers.oracle_cloud.promotion_status,'NOT_YET_ELIGIBLE_PERSISTENT_HOST');
  assert.equal(e.providers.google_cloud.promotion_status,'NOT_YET_ELIGIBLE_PERSISTENT_HOST');
  assert.equal(e.decision.selected_provider,null);
  assert.equal(e.decision.paid_fallback_authorized,false);
  assert.equal(e.decision.protected_capacity_reuse_authorized,false);
});

test('BE-06 host preflight fails closed on missing account, cost or isolation proof',()=>{
  const base={
    provider:'fixture',
    account_scope_verified:true,
    free_tier:{eligible:true,monthly_cost_ceiling_usd:0,paid_upgrade_required:false,overage_fail_closed:true},
    host:{persistent_runtime:true,durable_state:true,node_loopback:true,gateway_loopback:true,public_https:true,mutation_routes_public:false,protected_capacity_consumed:false,provider_risks_resolved:true,public_ports:[80,443]}
  };
  assert.equal(evaluateBe06HostEvidence(base).eligible,true);
  assert.equal(evaluateBe06HostEvidence({...base,account_scope_verified:false}).eligible,false);
  assert.equal(evaluateBe06HostEvidence({...base,free_tier:{...base.free_tier,monthly_cost_ceiling_usd:0.01}}).eligible,false);
  assert.equal(evaluateBe06HostEvidence({...base,host:{...base.host,node_loopback:false}}).eligible,false);
  assert.equal(evaluateBe06HostEvidence({...base,host:{...base.host,protected_capacity_consumed:true}}).eligible,false);
  assert.equal(evaluateBe06HostEvidence({...base,host:{...base.host,provider_risks_resolved:false}}).eligible,false);
});

test('BE-06 preflight rejects accidental public admin/node surfaces',()=>{
  const evidence={
    provider:'fixture',
    account_scope_verified:true,
    free_tier:{eligible:true,monthly_cost_ceiling_usd:0,paid_upgrade_required:false,overage_fail_closed:true},
    host:{persistent_runtime:true,durable_state:true,node_loopback:true,gateway_loopback:true,public_https:true,mutation_routes_public:false,protected_capacity_consumed:false,provider_risks_resolved:true,public_ports:[22,80,443]}
  };
  const result=evaluateBe06HostEvidence(evidence);
  assert.equal(result.eligible,false);
  assert.ok(result.reasons.some(x=>x.includes('public ports')));
});


test('BE-06 current testnet footprint is read-only evidence and does not self-authorize a host',async()=>{
  const f=JSON.parse(await read('lab/block-explorer/be06-current-testnet-footprint-20260923.json'));
  const e=JSON.parse(await read('lab/block-explorer/be06-provider-eligibility-20260923.json'));
  assert.equal(f.network,'fairyelf-public-testnet-v4');
  assert.equal(f.rows.blocks,496);
  assert.equal(f.rows.transactions,35);
  assert.equal(f.rows.utxos,564);
  assert.equal(f.postgres_tuple_bytes.total,478817);
  assert.equal(f.authority,'READ_ONLY_OBSERVATION_NO_PROVISIONING_NO_BINDING_NO_LIVE');
  assert.deepEqual(e.decision.probe_order,['google_cloud','oracle_cloud']);
  assert.equal(e.decision.selected_provider,null);
  assert.equal(e.providers.google_cloud.promotion_status,'NOT_YET_ELIGIBLE_PERSISTENT_HOST');
  assert.equal(e.providers.oracle_cloud.promotion_status,'NOT_YET_ELIGIBLE_PERSISTENT_HOST');
});
