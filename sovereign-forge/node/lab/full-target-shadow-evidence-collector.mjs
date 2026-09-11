#!/usr/bin/env node
'use strict';

import {appendFile,mkdir} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';

function integer(value,fallback,{min=0,max=Number.MAX_SAFE_INTEGER}={}){if(value===undefined||value===null||String(value).trim()==='')return fallback;const n=Number(value);if(!Number.isSafeInteger(n)||n<min||n>max)throw new Error(`invalid_integer:${value}`);return n}
function urls(value){const values=[...new Set(String(value??'').split(',').map(x=>x.trim().replace(/\/$/,'')).filter(Boolean))];if(!values.length)throw new Error('FAE_SHADOW_URLS_required');for(const value of values){const u=new URL(value);if(!['http:','https:'].includes(u.protocol))throw new Error('shadow_observer_url_requires_http')}return values}
function cleanError(error){return{message:String(error?.message??error),name:String(error?.name??'Error'),code:error?.code??null}}

const targets=urls(process.env.FAE_SHADOW_URLS);
const intervalMs=integer(process.env.FAE_SHADOW_OBSERVER_MS,10_000,{min:1_000,max:24*60*60_000});
const durationMs=integer(process.env.FAE_SHADOW_OBSERVER_DURATION_MS,0,{min:0,max:30*24*60*60_000});
const output=resolve(process.env.FAE_SHADOW_OBSERVER_FILE||'./data/full-target-shadow-observer.jsonl');
await mkdir(dirname(output),{recursive:true});

let stopped=false,timer=null,writeLock=Promise.resolve();
async function record(row){const run=writeLock.then(()=>appendFile(output,`${JSON.stringify(row)}\n`,'utf8'));writeLock=run.catch(()=>{});await run}
async function poll(){
  const time=new Date().toISOString();
  const results=await Promise.all(targets.map(async target=>{
    const start=Date.now();
    try{
      const response=await fetch(`${target}/status`,{signal:AbortSignal.timeout(Math.min(8_000,Math.max(1_000,intervalMs-100)))}),body=await response.json().catch(()=>null);
      return{target,latency_ms:Date.now()-start,http_status:response.status,ok:response.ok,body};
    }catch(error){return{target,latency_ms:Date.now()-start,ok:false,error:cleanError(error)}}
  }));
  await record({time,event:'observer-poll',results});
  console.log(JSON.stringify({event:'shadow-observer-poll',time,results:results.map(row=>({target:row.target,ok:row.ok,latency_ms:row.latency_ms,height:row.body?.height??null,tip_hash:row.body?.tip_hash??null,chain_work:row.body?.chain_work??null,error:row.error?.message??null}))}));
}
async function stop(signal){if(stopped)return;stopped=true;if(timer)clearInterval(timer);await record({time:new Date().toISOString(),event:'observer-stop',signal});await writeLock}
process.on('SIGINT',()=>void stop('SIGINT'));
process.on('SIGTERM',()=>void stop('SIGTERM'));

await record({time:new Date().toISOString(),event:'observer-start',targets,interval_ms:intervalMs,duration_ms:durationMs});
await poll();
timer=setInterval(()=>poll().catch(error=>console.error(JSON.stringify({event:'shadow-observer-error',error:cleanError(error)}))),intervalMs);
if(durationMs>0)setTimeout(()=>stop('duration-complete').then(()=>process.exit(0)),durationMs).unref?.();
