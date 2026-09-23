#!/usr/bin/env node
'use strict';

import {pathToFileURL} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';

const NETWORK='fairyelf-public-testnet-v4';
const DIGEST=/^[0-9a-f]{64}$/;
const ZERO_HASH='0'.repeat(64);

export function normalizePublicNodeOrigin(raw){
  let url;
  try{url=new URL(String(raw||''))}catch{throw new Error('invalid_public_node_origin')}
  if(url.protocol!=='https:')throw new Error('public_node_origin_requires_https');
  if(url.username||url.password||url.search||url.hash)throw new Error('invalid_public_node_origin');
  if(url.pathname!=='/'&&url.pathname!=='')throw new Error('public_node_origin_must_be_origin_only');
  return url.origin;
}

export function normalizeFrontendOrigin(raw){
  let url;
  try{url=new URL(String(raw||''))}catch{throw new Error('invalid_frontend_origin')}
  if(url.protocol!=='https:')throw new Error('frontend_origin_requires_https');
  if(url.username||url.password||url.search||url.hash)throw new Error('invalid_frontend_origin');
  if(url.pathname!=='/'&&url.pathname!=='')throw new Error('frontend_origin_must_be_origin_only');
  return url.origin;
}

async function readJson(response,label){
  const type=(response.headers.get('content-type')||'').toLowerCase();
  if(!type.startsWith('application/json'))throw new Error(label+'_non_json');
  try{return await response.json()}catch{throw new Error(label+'_invalid_json')}
}

function assertStatusPayload(payload){
  if(payload?.ok!==true)throw new Error('status_not_ok');
  if(payload.network!==NETWORK)throw new Error('wrong_network');
  if(!Number.isSafeInteger(Number(payload.observed_tip_height))||Number(payload.observed_tip_height)<1)throw new Error('invalid_observed_tip_height');
  if(!DIGEST.test(String(payload.observed_tip_hash))||payload.observed_tip_hash===ZERO_HASH)throw new Error('invalid_observed_tip_hash');
  if(Number(payload.height)!==Number(payload.observed_tip_height))throw new Error('status_tip_height_mismatch');
  if(String(payload.tip_hash)!==String(payload.observed_tip_hash))throw new Error('status_tip_hash_mismatch');
  if(typeof payload.node_version!=='string'||!payload.node_version.startsWith('independent-'))throw new Error('unexpected_node_version');
  if(!/^\d+$/.test(String(payload.chain_work||'')))throw new Error('invalid_chain_work');
  return{
    height:Number(payload.observed_tip_height),
    tip_hash:String(payload.observed_tip_hash),
    node_version:String(payload.node_version),
    chain_work:String(payload.chain_work)
  };
}

function assertBlocksPayload(payload,status){
  if(payload?.ok!==true||payload.network!==NETWORK)throw new Error('blocks_not_ok');
  if(Number(payload.observed_tip_height)!==status.height||String(payload.observed_tip_hash)!==status.tip_hash)throw new Error('blocks_tip_binding_mismatch');
  if(!Array.isArray(payload.blocks)||payload.blocks.length<1)throw new Error('latest_block_missing');
  const block=payload.blocks[0];
  if(Number(block.height)!==status.height||String(block.hash)!==status.tip_hash)throw new Error('latest_block_not_tip');
  return{height:Number(block.height),hash:String(block.hash)};
}

async function oneObservation({base,frontendOrigin,fetchImpl}){
  const statusResponse=await fetchImpl(base+'/explorer/status',{
    method:'GET',
    headers:{accept:'application/json',origin:frontendOrigin},
    cache:'no-store'
  });
  if(statusResponse.status!==200)throw new Error('status_http_'+statusResponse.status);
  if(statusResponse.headers.get('access-control-allow-origin')!==frontendOrigin)throw new Error('status_cors_origin_mismatch');
  const status=assertStatusPayload(await readJson(statusResponse,'status'));

  const blocksResponse=await fetchImpl(base+'/explorer/blocks?limit=1',{
    method:'GET',
    headers:{accept:'application/json',origin:frontendOrigin},
    cache:'no-store'
  });
  if(blocksResponse.status!==200)throw new Error('blocks_http_'+blocksResponse.status);
  const latest=assertBlocksPayload(await readJson(blocksResponse,'blocks'),status);

  const preflight=await fetchImpl(base+'/explorer/status',{
    method:'OPTIONS',
    headers:{origin:frontendOrigin,'access-control-request-method':'GET'}
  });
  if(preflight.status!==204)throw new Error('preflight_http_'+preflight.status);
  if(preflight.headers.get('access-control-allow-origin')!==frontendOrigin)throw new Error('preflight_origin_mismatch');
  const methods=(preflight.headers.get('access-control-allow-methods')||'').split(',').map(x=>x.trim()).filter(Boolean);
  if(!methods.includes('GET')||!methods.includes('OPTIONS')||methods.includes('POST'))throw new Error('preflight_method_policy');

  const mutation=await fetchImpl(base+'/explorer/status',{
    method:'POST',
    headers:{origin:frontendOrigin,'content-type':'application/json'},
    body:'{}'
  });
  if(mutation.status!==405)throw new Error('explorer_post_not_rejected');
  const mutationPayload=await readJson(mutation,'mutation');
  if(mutationPayload?.error!=='read_only')throw new Error('explorer_post_wrong_rejection');

  const hidden=await fetchImpl(base+'/submit-tx',{
    method:'GET',
    headers:{accept:'application/json'}
  });
  if(hidden.status!==404)throw new Error('submit_tx_publicly_routed');
  const hiddenPayload=await readJson(hidden,'hidden_route');
  if(hiddenPayload?.error!=='public_route_not_found')throw new Error('submit_tx_wrong_gateway_rejection');

  return{...status,latest};
}

export async function probeBinding({
  publicOrigin,
  frontendOrigin,
  fetchImpl=globalThis.fetch,
  delayMs=16000
}){
  if(typeof fetchImpl!=='function')throw new Error('fetch_unavailable');
  if(!Number.isSafeInteger(delayMs)||delayMs<0||delayMs>120000)throw new Error('invalid_delay');
  const base=normalizePublicNodeOrigin(publicOrigin);
  const browser=normalizeFrontendOrigin(frontendOrigin);
  const first=await oneObservation({base,frontendOrigin:browser,fetchImpl});
  if(delayMs)await sleep(delayMs);
  const second=await oneObservation({base,frontendOrigin:browser,fetchImpl});
  return{
    ok:true,
    schema:'FAE_BLOCK_EXPLORER_BE05_BINDING_PROBE_V1',
    network:NETWORK,
    public_origin:base,
    frontend_origin:browser,
    observations:[first,second],
    read_only_surface_verified:true,
    public_submit_route_hidden:true,
    live_authority_granted:false
  };
}

async function run(){
  const report=await probeBinding({
    publicOrigin:process.env.FAE_BE05_PUBLIC_ORIGIN,
    frontendOrigin:process.env.FAE_BE05_EXPLORER_ORIGIN,
    delayMs:Number(process.env.FAE_BE05_PROBE_DELAY_MS||16000)
  });
  console.log(JSON.stringify(report,null,2));
}

const invoked=process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url;
if(invoked)run().catch(error=>{
  console.error(JSON.stringify({ok:false,error:error.message||String(error)}));
  process.exitCode=1;
});
