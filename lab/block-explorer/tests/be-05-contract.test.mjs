import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const root=new URL('../../../',import.meta.url);
const read=async path=>readFile(new URL(path,root),'utf8');

test('BE-05 remains discovery-only without spend or binding authority',async()=>{
  const authority=JSON.parse(await read('lab/block-explorer/authority.json'));
  assert.equal(authority.current_frontier,'BE-05');
  assert.equal(authority.be05_authority.state,'DISCOVERY_ONLY');
  assert.equal(authority.current_stage_runtime_write_authorized,false);
  assert.equal(authority.node_query_surface_write_authorized,false);
  assert.equal(authority.explorer_application_write_authorized,false);
  assert.equal(authority.public_https_node_binding_authorized,false);
  assert.equal(authority.independent_node_public_deployment_authorized,false);
  assert.equal(authority.explorer_application_live_authorized,false);
  assert.equal(authority.public_deployment_authorized,false);
  assert.equal(authority.be05_authority.deployment_forbidden_until_promoted,true);
});

test('provider scan admits no imaginary existing host',async()=>{
  const scan=JSON.parse(await read('lab/block-explorer/be05-provider-scan.json'));
  assert.equal(scan.conclusion.eligible_existing_https_independent_node_found,false);
  assert.equal(scan.conclusion.deployment_performed,false);
  assert.equal(scan.conclusion.binding_performed,false);
  assert.equal(scan.conclusion.live_authorized,false);
  assert.equal(scan.providers.render.eligible_existing_host_found,false);
  assert.equal(scan.providers.vercel.eligible_existing_host_found,false);
  assert.equal(scan.providers.appdeploy.eligible_existing_host_found,false);
  assert.equal(scan.providers.digitalocean.active_droplets_observed,0);
  assert.equal(scan.providers.aws.active_ec2_instances_observed,0);
  assert.equal(scan.providers.aws.active_lightsail_instances_observed_in_accessible_regions,0);
});

test('deployment contract keeps validation in the Independent Node',async()=>{
  const contract=JSON.parse(await read('lab/block-explorer/be05-node-deployment-v1.json'));
  assert.equal(contract.network,'fairyelf-public-testnet-v4');
  assert.equal(contract.node.source,'sovereign-forge/node/fae-node.mjs');
  assert.equal(contract.node.private_bind.FAE_HOST,'127.0.0.1');
  assert.equal(contract.node.durable_state.required,true);
  assert.match(contract.node.durable_state.requirement,/survive process and instance restart/);
  assert.match(contract.node.synchronization.FAE_BOOTSTRAP_FEEDS,/Candidate data only/);
  assert.equal(contract.public_gateway.internal_node_origin,'LOOPBACK_HTTP_ONLY');
  assert.deepEqual(contract.public_gateway.allowed_methods,['GET','OPTIONS']);
  assert.ok(contract.provider_requirements.some(x=>x.includes('Persistent writable storage')));
  assert.ok(contract.explicit_non_goals.includes('No infrastructure spend authorization.'));
});

test('public contract exposes only Explorer namespace and hides node mutation routes',async()=>{
  const contract=JSON.parse(await read('lab/block-explorer/be05-node-deployment-v1.json'));
  assert.ok(contract.public_gateway.exact_routes.every(path=>path.startsWith('/explorer/')));
  for(const path of ['/submit-tx','/submit-block','/feed','/state','/status']){
    assert.ok(contract.public_gateway.forbidden_public_routes.includes(path),path+' must remain private');
  }
  assert.ok(contract.binding_acceptance.some(x=>x.includes('POST /explorer/status')));
  assert.ok(contract.binding_acceptance.some(x=>x.includes('GET /submit-tx')));
});

test('current node runtime source still exposes required provider-neutral controls',async()=>{
  const node=await read('sovereign-forge/node/fae-node.mjs');
  const pkg=JSON.parse(await read('sovereign-forge/node/package.json'));
  assert.equal(pkg.engines.node,'>=22');
  assert.match(node,/process\.env\.FAE_PORT\|\|8787/);
  assert.match(node,/process\.env\.FAE_HOST\|\|'0\.0\.0\.0'/);
  assert.match(node,/process\.env\.FAE_DATA_FILE\|\|'\.\/data\/fae-state\.json'/);
  assert.match(node,/process\.env\.FAE_SYNC_MS\|\|15000/);
  assert.match(node,/process\.env\.FAE_SYNC!=='0'/);
  assert.match(node,/await loadState\(\)/);
  assert.match(node,/await syncOnce\(\)\.catch/);
});
