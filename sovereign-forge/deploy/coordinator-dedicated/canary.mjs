import assert from 'node:assert/strict';
import {encodeAddress} from '../../node/authoritative/address.mjs';

const base=String(process.env.FAE_COORDINATOR_URL||process.argv[2]||'').replace(/\/$/,'');
if(!/^https:\/\//.test(base))throw new Error('Usage: FAE_COORDINATOR_URL=https://coordinator.example.org node canary.mjs');

async function json(path,options={}){
  const response=await fetch(base+path,{...options,headers:{'content-type':'application/json',...(options.headers||{})},signal:AbortSignal.timeout(8000)});
  const payload=await response.json().catch(()=>({}));
  return{response,payload};
}

const health=await json('/health');
assert.equal(health.response.status,200);
assert.equal(health.payload.ok,true);
assert.equal(health.payload.network,'fairyelf-public-testnet-v4');
assert.equal(health.payload.upstream_ok,true);
assert.equal(health.payload.pplns_coinbase_activation_height,null);
assert.equal(health.payload.mining_enabled,false);
assert.equal(health.payload.holds_payout_private_key,false);
assert.match(String(health.payload.coordinator_id||''),/^[0-9a-f]{64}$/);

const status=await json('/status');
assert.equal(status.response.status,200);
assert.equal(status.payload.ok,true);
assert.equal(status.payload.network,'fairyelf-public-testnet-v4');
assert.equal(status.payload.coordinator_id,health.payload.coordinator_id);
assert.equal(status.payload.holds_payout_private_key,false);
assert.equal(status.payload.activation,'candidate-awaiting-multi-output-coinbase');
assert.equal(status.payload.public_url,base);

const descriptor=await json('/descriptor');
assert.equal(descriptor.response.status,200);
assert.equal(descriptor.payload.ok,true);
assert.ok(descriptor.payload.descriptor);

// A valid FAE address is required so this canary reaches the activation gate
// rather than failing early on address validation.
const address=encodeAddress(new Uint8Array(20));
const work=await json('/work',{method:'POST',body:JSON.stringify({address})});
assert.equal(work.response.status,409);
assert.equal(work.payload.ok,false);
assert.match(String(work.payload.error||''),/activation required/i);

console.log(JSON.stringify({
  ok:true,
  coordinator_id:health.payload.coordinator_id,
  upstream_height:health.payload.upstream_height,
  activation:null,
  mining_enabled:false,
  payout_private_key:false,
  work_gate:'409 activation required'
}));
