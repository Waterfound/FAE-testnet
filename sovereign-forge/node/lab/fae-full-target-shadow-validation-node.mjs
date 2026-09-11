#!/usr/bin/env node
'use strict';

import {appendFile,mkdir} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {createFullTargetShadowPeerNode} from './full-target-shadow-peer-node.mjs';
import {createShadowValidationFixture,SHADOW_VALIDATION_PROFILES} from './full-target-shadow-validation-fixtures.mjs';

function integer(value,fallback,{min=0,max=Number.MAX_SAFE_INTEGER}={}){if(value===undefined||value===null||String(value).trim()==='')return fallback;const n=Number(value);if(!Number.isSafeInteger(n)||n<min||n>max)throw new Error(`invalid_integer:${value}`);return n}
function list(value){return[...new Set(String(value??'').split(',').map(x=>x.trim()).filter(Boolean))]}
function profile(value){const p=String(value??'trusted').trim();if(!SHADOW_VALIDATION_PROFILES.includes(p))throw new Error(`invalid_shadow_profile:${p}`);return p}

const host=process.env.FAE_SHADOW_HOST||'0.0.0.0';
const port=integer(process.env.FAE_SHADOW_PORT,8788,{min:0,max:65535});
const validationProfile=profile(process.env.FAE_SHADOW_PROFILE);
const label=(process.env.FAE_SHADOW_LABEL||validationProfile).trim()||validationProfile;
const dataFile=resolve(process.env.FAE_SHADOW_DATA_FILE||'./data/full-target-shadow-state.json');
const identityFile=resolve(process.env.FAE_SHADOW_IDENTITY_FILE||'./data/full-target-shadow-identity.json');
const evidenceFile=resolve(process.env.FAE_SHADOW_EVIDENCE_FILE||'./data/full-target-shadow-evidence.jsonl');
const peers=list(process.env.FAE_SHADOW_PEERS);
const syncEnabled=process.env.FAE_SHADOW_SYNC!=='0';
const syncIntervalMs=integer(process.env.FAE_SHADOW_SYNC_MS,15_000,{min:5_000,max:24*60*60_000});
const fixture=createShadowValidationFixture(validationProfile);

await mkdir(dirname(evidenceFile),{recursive:true});
let evidenceLock=Promise.resolve();
function cleanError(error){return{message:String(error?.message??error),name:String(error?.name??'Error'),code:error?.code??null}}
async function evidence(event,details={}){
  const record={time:new Date().toISOString(),event,label,profile:validationProfile,...details};
  const line=`${JSON.stringify(record)}\n`;
  const run=evidenceLock.then(()=>appendFile(evidenceFile,line,{encoding:'utf8'}));evidenceLock=run.catch(()=>{});await run;return record;
}

const node=createFullTargetShadowPeerNode({host,port,dataFile,identityFile,policy:fixture.policy,trustedPrefix:fixture.trustedPrefix,initialChain:fixture.initialChain});
let timer=null,syncRunning=false,stopping=false;

async function syncCycle(reason='interval'){
  if(syncRunning)return{skipped:true,reason:'sync_in_progress'};syncRunning=true;
  try{
    const before=node.status(),results=[];
    for(const peer of peers){
      const started=Date.now();
      try{const result=await node.syncPeer(peer);results.push({peer,latency_ms:Date.now()-started,...result})}
      catch(error){results.push({peer,latency_ms:Date.now()-started,error:cleanError(error)})}
    }
    const after=node.status();await evidence('sync',{reason,before,after,results});return{before,after,results};
  }finally{syncRunning=false}
}

async function stop(signal){
  if(stopping)return;stopping=true;if(timer)clearInterval(timer);
  try{
    while(syncRunning)await new Promise(resolvePromise=>setTimeout(resolvePromise,25));
    const status=node.status();await evidence('shutdown',{signal,status});await node.close();await evidenceLock;
  }catch(error){console.error(JSON.stringify({event:'shadow-validation-shutdown-error',error:cleanError(error)}));process.exitCode=1}
}
process.on('SIGINT',()=>void stop('SIGINT'));
process.on('SIGTERM',()=>void stop('SIGTERM'));
process.on('unhandledRejection',error=>{console.error(JSON.stringify({event:'shadow-validation-unhandled-rejection',error:cleanError(error)}));process.exitCode=1});
process.on('uncaughtException',error=>{console.error(JSON.stringify({event:'shadow-validation-uncaught-exception',error:cleanError(error)}));process.exitCode=1});

await node.start();
const online=node.status();
await evidence('online',{status:online,configured_peers:peers,fixture:{version:fixture.fixture_version,expected_height:fixture.expected_height,expected_tip_hash:fixture.expected_tip_hash,expected_work:fixture.expected_work,expected_weak_work:fixture.expected_weak_work,expected_strong_work:fixture.expected_strong_work}});
console.log(JSON.stringify({event:'shadow-validation-online',label,profile:validationProfile,base_url:node.baseUrl(),evidence_file:evidenceFile,status:online,configured_peers:peers}));

if(syncEnabled&&peers.length){await syncCycle('startup');timer=setInterval(()=>syncCycle('interval').catch(error=>console.error(JSON.stringify({event:'shadow-validation-sync-error',error:cleanError(error)}))),syncIntervalMs);timer.unref?.();}
// No artificial top-level wait is needed: the HTTP server keeps the process alive.
