export const API='https://wfwwotuhectwknvbvgif.supabase.co/functions/v1/fae-public-testnet-v4';
export const NETWORK='fairyelf-public-testnet-v4';
export const GENESIS='0000391ae913006a6c1ab07760675e71067dfc40f893416b4bcb81eac75989bc';
export const CONTRACT_ID='FAE-RDE-ACCEPTANCE-V1-20260928';
export const AUTOPILOT_PROTOCOL_ID='FAE-RDE-PHYSICAL-AUTOPILOT-V1-20260928';
export const TESTED_SOURCE_REVISION='d6c3ac8670806729ec10d026c15317ebb73f4f69';
export const TESTED_MINER_BLOB_SHA='fb98057341adca6f1f53b681e1094ef6fcb97e1f';

export function canonical(value){
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
  return value;
}
export const stable=value=>JSON.stringify(canonical(value));

export function leadingZeroBitsHex(hash){
  if(typeof hash!=='string'||!/^[0-9a-f]{64}$/.test(hash))return-1;
  let count=0;
  for(const ch of hash){
    const n=parseInt(ch,16);
    if(n===0){count+=4;continue}
    if(n<2)count+=3;else if(n<4)count+=2;else if(n<8)count++;
    break;
  }
  return count;
}
export function percentile(values,p=0.95){
  const rows=values.map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
  if(!rows.length)return NaN;
  return rows[Math.min(rows.length-1,Math.max(0,Math.ceil(rows.length*p)-1))];
}
export function runId(prefix='rde-physical'){
  const random=globalThis.crypto?.randomUUID?.()||Math.random().toString(16).slice(2);
  return prefix+'-'+Date.now().toString(36)+'-'+random;
}
export async function api(path,options={}){
  const response=await fetch(API+path,options);
  const payload=await response.json().catch(()=>({}));
  if(!response.ok){const error=new Error(payload.error||payload.reason||('HTTP '+response.status));error.data=payload;error.status=response.status;throw error}
  return payload;
}
export function currentIso(){return new Date().toISOString()}
export function makeSourceProvenance(harnessRevision='UNCOMMITTED_OR_PREVIEW'){
  return{
    schema:'FAE_RDE_SOURCE_PROVENANCE_V1',
    repository:'Waterfound/FAE-testnet',
    source_revision:TESTED_SOURCE_REVISION,
    miner_path:'mining.js',
    miner_blob_sha:TESTED_MINER_BLOB_SHA,
    network:NETWORK,
    genesis_hash:GENESIS,
    runtime_revision:TESTED_SOURCE_REVISION,
    workload_revision:CONTRACT_ID,
    autopilot_protocol_id:AUTOPILOT_PROTOCOL_ID,
    harness_revision:harnessRevision
  };
}
export function makeWorkerSource(){
  return [
    "'use strict';",
    "const E=new TextEncoder();let running=true;",
    "function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));return value}",
    "async function digest(value){const one=await crypto.subtle.digest('SHA-256',E.encode(JSON.stringify(canonical(value))));const two=await crypto.subtle.digest('SHA-256',one);return [...new Uint8Array(two)].map(b=>b.toString(16).padStart(2,'0')).join('')}",
    "function lz(hash){let c=0;for(const ch of hash){const n=parseInt(ch,16);if(n===0){c+=4;continue}if(n<2)c+=3;else if(n<4)c+=2;else if(n<8)c++;break}return c}",
    "onmessage=async e=>{if(e.data?.kind==='stop'){running=false;return}const header=e.data.header,targetBits=Number(e.data.targetBits);let nonce=Number(e.data.nonceStart)||Math.floor(Math.random()*1e9),attempts=0,started=performance.now(),last=started;while(running){const hash=await digest({...header,nonce});nonce++;attempts++;if(lz(hash)>=targetBits){postMessage({kind:'solution',nonce:nonce-1,hash,attempts,elapsed_ms:performance.now()-started});return}if(attempts%256===0){const now=performance.now();postMessage({kind:'progress',attempts,elapsed_ms:now-started,window_ms:now-last});last=now}}}"
  ].join('');
}
export function buildSelectionLock({deviceClass,manufacturer,model,candidates,rationale,status,harnessRevision}){
  return{
    schema:'FAE_RDE_SELECTION_LOCK_V1',
    locked_at:currentIso(),
    device_class:deviceClass,
    selected_device:{manufacturer,model},
    available_candidates:candidates,
    selection_rationale:rationale,
    network_lock:{
      network:NETWORK,
      observed_height:Number(status?.height),
      observed_tip_hash:String(status?.tip_hash||''),
      observed_at:currentIso()
    },
    autopilot_protocol_id:AUTOPILOT_PROTOCOL_ID,
    harness_revision:harnessRevision
  };
}
export function environmentDefaults(deviceClass,profile={}){
  return{
    schema:'FAE_RDE_ENVIRONMENT_V1',
    device_class:deviceClass,
    power_mode:profile.power_mode||'normal',
    charging_state:profile.charging_state||'unknown_declared',
    external_power:profile.external_power??false,
    cooling_configuration:profile.cooling_configuration||'stock',
    background_task_policy:profile.background_task_policy||'ordinary_background_state',
    display_state:profile.display_state||'on',
    ambient_temperature_status:'UNAVAILABLE',
    ambient_temperature_missing_reason:'No calibrated ambient sensor is exposed to the browser harness.'
  };
}
export function energyUnavailable(){
  return{
    schema:'FAE_RDE_ENERGY_V1',
    measurement_source:'UNAVAILABLE',
    missing_reason:'No machine-readable wall-power source was attached to this run.',
    efficiency_claimed:false
  };
}
export function thermalFromTelemetry(telemetry){
  const temp=Number(telemetry?.gpu_temperature_c);
  if(Number.isFinite(temp))return{
    schema:'FAE_RDE_THERMALS_V1',telemetry_available:true,max_temperature_c:temp,
    throttling_observed:Boolean(telemetry?.throttling_observed),critical_thermal_event:false,device_shutdown:false,
    source:'LOCAL_AGENT_TELEMETRY'
  };
  return{
    schema:'FAE_RDE_THERMALS_V1',telemetry_available:false,
    missing_reason:'No trustworthy thermal sensor is exposed to this browser/device path.',
    critical_thermal_event:false,device_shutdown:false
  };
}
export function validatePhysicalMode(mode,scale){
  if(mode==='PHYSICAL_EVIDENCE'&&Number(scale)!==1)throw new Error('physical_duration_scaling_forbidden');
  if(!['PHYSICAL_EVIDENCE','REHEARSAL_ONLY'].includes(mode))throw new Error('unsupported_evidence_class');
  return true;
}
