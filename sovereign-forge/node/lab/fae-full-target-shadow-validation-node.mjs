#!/usr/bin/env node
'use strict';

import http from 'node:http';
import {appendFile,mkdir} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {createFullTargetShadowPeerNode} from './full-target-shadow-peer-node.mjs';
import {createShadowValidationFixture,SHADOW_VALIDATION_PROFILES} from './full-target-shadow-validation-fixtures.mjs';

export const FULL_TARGET_SHADOW_LOCAL_CONTROL_STATUS='lab-only-local-control-no-consensus-authority';

function integer(value,fallback,{min=0,max=Number.MAX_SAFE_INTEGER}={}){if(value===undefined||value===null||String(value).trim()==='')return fallback;const n=Number(value);if(!Number.isSafeInteger(n)||n<min||n>max)throw new Error(`invalid_integer:${value}`);return n}
function list(value){return[...new Set(String(value??'').split(',').map(x=>x.trim()).filter(Boolean))]}
function profile(value){const p=String(value??'trusted').trim();if(!SHADOW_VALIDATION_PROFILES.includes(p))throw new Error(`invalid_shadow_profile:${p}`);return p}
function sendJson(res,status,payload){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(payload))}
function cleanError(error){return{message:String(error?.message??error),name:String(error?.name??'Error'),code:error?.code??null}}
function peerUrl(value){const url=new URL(String(value??''));if(!['http:','https:'].includes(url.protocol))throw new Error('shadow_control_peer_requires_http');url.username='';url.password='';url.hash='';return url.toString().replace(/\/$/,'')}
async function readJson(req,{maxBytes=8192}={}){let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>maxBytes)throw new Error('shadow_control_body_too_large');chunks.push(chunk)}const text=Buffer.concat(chunks).toString('utf8').trim();return text?JSON.parse(text):{}}

const host=process.env.FAE_SHADOW_HOST||'0.0.0.0';
const port=integer(process.env.FAE_SHADOW_PORT,8788,{min:0,max:65535});
const controlHost=process.env.FAE_SHADOW_CONTROL_HOST||'127.0.0.1';
const controlPort=integer(process.env.FAE_SHADOW_CONTROL_PORT,0,{min:0,max:65535});
const validationProfile=profile(process.env.FAE_SHADOW_PROFILE);
const label=(process.env.FAE_SHADOW_LABEL||validationProfile).trim()||validationProfile;
const dataFile=resolve(process.env.FAE_SHADOW_DATA_FILE||'./data/full-target-shadow-state.json');
const identityFile=resolve(process.env.FAE_SHADOW_IDENTITY_FILE||'./data/full-target-shadow-identity.json');
const evidenceFile=resolve(process.env.FAE_SHADOW_EVIDENCE_FILE||'./data/full-target-shadow-evidence.jsonl');
const peers=list(process.env.FAE_SHADOW_PEERS);
const syncEnabled=process.env.FAE_SHADOW_SYNC!=='0';
const syncIntervalMs=integer(process.env.FAE_SHADOW_SYNC_MS,15_000,{min:5_000,max:24*60*60_000});
const fixture=createShadowValidationFixture(validationProfile);
const fixtureSummary={version:fixture.fixture_version,expected_height:fixture.expected_height,expected_tip_hash:fixture.expected_tip_hash,expected_work:fixture.expected_work,expected_weak_work:fixture.expected_weak_work,expected_strong_work:fixture.expected_strong_work};

await mkdir(dirname(evidenceFile),{recursive:true});
let evidenceLock=Promise.resolve();
async function evidence(event,details={}){
  const record={time:new Date().toISOString(),event,label,profile:validationProfile,...details};
  const line=`${JSON.stringify(record)}\n`;
  const run=evidenceLock.then(()=>appendFile(evidenceFile,line,{encoding:'utf8'}));evidenceLock=run.catch(()=>{});await run;return record;
}

const node=createFullTargetShadowPeerNode({host,port,dataFile,identityFile,policy:fixture.policy,trustedPrefix:fixture.trustedPrefix,initialChain:fixture.initialChain});
let timer=null,syncRunning=false,stopping=false,controlServer=null;

async function syncOne(peer,reason='control'){
  if(syncRunning)return{skipped:true,reason:'sync_in_progress'};
  const normalizedPeer=peerUrl(peer);syncRunning=true;
  const before=node.status(),started=Date.now();
  try{
    const result=await node.syncPeer(normalizedPeer),after=node.status();
    await evidence('sync',{reason,before,after,results:[{peer:normalizedPeer,latency_ms:Date.now()-started,...result}]});
    return{before,after,result};
  }catch(error){
    const after=node.status(),clean=cleanError(error);
    await evidence('sync',{reason,before,after,results:[{peer:normalizedPeer,latency_ms:Date.now()-started,error:clean}]});
    error.shadow_control={before,after,peer:normalizedPeer};throw error;
  }finally{syncRunning=false}
}

async function syncCycle(reason='interval'){
  if(syncRunning)return{skipped:true,reason:'sync_in_progress'};syncRunning=true;
  try{
    const before=node.status(),results=[];
    for(const peer of peers){
      const normalizedPeer=peerUrl(peer),started=Date.now();
      try{const result=await node.syncPeer(normalizedPeer);results.push({peer:normalizedPeer,latency_ms:Date.now()-started,...result})}
      catch(error){results.push({peer:normalizedPeer,latency_ms:Date.now()-started,error:cleanError(error)})}
    }
    const after=node.status();await evidence('sync',{reason,before,after,results});return{before,after,results};
  }finally{syncRunning=false}
}

function controlStatus(){return{ok:true,status:FULL_TARGET_SHADOW_LOCAL_CONTROL_STATUS,label,profile:validationProfile,node:node.status(),fixture:fixtureSummary,sync_running:syncRunning}}

async function startControlServer(){
  if(controlPort===0)return null;
  if(controlHost!=='127.0.0.1'&&controlHost!=='::1'&&controlHost!=='localhost')throw new Error('shadow_control_must_bind_loopback');
  controlServer=http.createServer((req,res)=>{
    void(async()=>{
      const incoming=new URL(req.url,'http://shadow-control.invalid');
      if(req.method==='GET'&&incoming.pathname==='/control/status')return sendJson(res,200,controlStatus());
      if(req.method==='POST'&&incoming.pathname==='/control/sync'){
        if(syncRunning)return sendJson(res,409,{ok:false,error:'sync_in_progress',node:node.status()});
        const body=await readJson(req),peer=peerUrl(body.peer);
        try{return sendJson(res,200,{ok:true,...await syncOne(peer,'local-control')})}
        catch(error){return sendJson(res,502,{ok:false,error:cleanError(error),context:error.shadow_control??null,node:node.status()})}
      }
      return sendJson(res,404,{ok:false,error:'shadow_control_not_found'});
    })().catch(error=>{if(!res.headersSent&&!res.destroyed)sendJson(res,400,{ok:false,error:cleanError(error)});else if(!res.destroyed)res.destroy()});
  });
  await new Promise((resolvePromise,reject)=>{controlServer.once('error',reject);controlServer.listen(controlPort,controlHost,()=>{controlServer.off('error',reject);resolvePromise()})});
  const address=controlServer.address();const actualPort=address&&typeof address!=='string'?address.port:controlPort;
  await evidence('local_control_online',{status:FULL_TARGET_SHADOW_LOCAL_CONTROL_STATUS,host:controlHost,port:actualPort});
  return `http://${controlHost}:${actualPort}`;
}

async function stop(signal){
  if(stopping)return;stopping=true;if(timer)clearInterval(timer);
  try{
    if(controlServer?.listening)await new Promise(resolvePromise=>controlServer.close(resolvePromise));
    while(syncRunning)await new Promise(resolvePromise=>setTimeout(resolvePromise,25));
    const status=node.status();await evidence('shutdown',{signal,status});await node.close();await evidenceLock;
  }catch(error){console.error(JSON.stringify({event:'shadow-validation-shutdown-error',error:cleanError(error)}));process.exitCode=1}
}
process.on('SIGINT',()=>void stop('SIGINT'));
process.on('SIGTERM',()=>void stop('SIGTERM'));
process.on('unhandledRejection',error=>{console.error(JSON.stringify({event:'shadow-validation-unhandled-rejection',error:cleanError(error)}));process.exitCode=1});
process.on('uncaughtException',error=>{console.error(JSON.stringify({event:'shadow-validation-uncaught-exception',error:cleanError(error)}));process.exitCode=1});

await node.start();
const controlUrl=await startControlServer();
const online=node.status();
await evidence('online',{status:online,configured_peers:peers,fixture:fixtureSummary,local_control:controlUrl?{status:FULL_TARGET_SHADOW_LOCAL_CONTROL_STATUS,url:controlUrl}:null});
console.log(JSON.stringify({event:'shadow-validation-online',label,profile:validationProfile,base_url:node.baseUrl(),evidence_file:evidenceFile,status:online,configured_peers:peers,local_control:controlUrl?{status:FULL_TARGET_SHADOW_LOCAL_CONTROL_STATUS,url:controlUrl}:null}));

if(syncEnabled&&peers.length){await syncCycle('startup');timer=setInterval(()=>syncCycle('interval').catch(error=>console.error(JSON.stringify({event:'shadow-validation-sync-error',error:cleanError(error)}))),syncIntervalMs);timer.unref?.();}
// No artificial top-level wait is needed: the HTTP server keeps the process alive.
