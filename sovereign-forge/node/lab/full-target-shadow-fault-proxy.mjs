#!/usr/bin/env node
'use strict';

import http from 'node:http';
import https from 'node:https';
import {appendFile,mkdir} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export const FULL_TARGET_SHADOW_FAULT_PROXY_STATUS='lab-only-network-fault-injector';

function integer(value,fallback,{min=0,max=Number.MAX_SAFE_INTEGER}={}){
  if(value===undefined||value===null||String(value).trim()==='')return fallback;
  const n=Number(value);if(!Number.isSafeInteger(n)||n<min||n>max)throw new Error(`invalid_integer:${value}`);return n;
}
function normalizeTarget(value){
  const url=new URL(String(value??''));
  if(!['http:','https:'].includes(url.protocol))throw new Error('fault_proxy_target_requires_http');
  url.search='';url.hash='';return url;
}
function sendJson(res,status,payload){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(payload))}
function sleep(ms){return ms>0?new Promise(resolvePromise=>setTimeout(resolvePromise,ms)):Promise.resolve()}
function deterministicJitter(counter,amplitude){
  if(amplitude<=0)return 0;
  const span=(amplitude*2)+1;
  const mixed=((counter*1103515245+12345)>>>0)%span;
  return mixed-amplitude;
}

export function createFullTargetShadowFaultProxy({
  target,host='127.0.0.1',port=0,dropSecureOrdinal=0,evidenceFile=null,label='fault-proxy',
  baseDelayMs=0,jitterMs=0,chunkDelayMs=0,chunkBytes=0
}={}){
  const targetBase=normalizeTarget(target);
  const dropAt=integer(dropSecureOrdinal,0,{min:0,max:32});
  const baseDelay=integer(baseDelayMs,0,{min:0,max:30_000});
  const jitter=integer(jitterMs,0,{min:0,max:30_000});
  const chunkDelay=integer(chunkDelayMs,0,{min:0,max:10_000});
  const chunkSize=integer(chunkBytes,0,{min:0,max:1024*1024});
  const degradedTransport=baseDelay>0||jitter>0||chunkDelay>0||chunkSize>0;
  const resolvedEvidence=evidenceFile?resolve(evidenceFile):null;
  let sessionNumber=0,secureOrdinal=0,faultsInjected=0,responseCounter=0,evidenceLock=Promise.resolve();

  async function evidence(event,details={}){
    if(!resolvedEvidence)return;
    const line=`${JSON.stringify({time:new Date().toISOString(),event,label,target:targetBase.toString().replace(/\/$/,''),...details})}\n`;
    const run=evidenceLock.then(async()=>{await mkdir(dirname(resolvedEvidence),{recursive:true});await appendFile(resolvedEvidence,line,{encoding:'utf8'})});
    evidenceLock=run.catch(()=>{});await run;
  }

  function status(){return{
    ok:true,status:FULL_TARGET_SHADOW_FAULT_PROXY_STATUS,label,
    target:targetBase.toString().replace(/\/$/,''),drop_secure_ordinal:dropAt,
    session_number:sessionNumber,secure_ordinal:secureOrdinal,faults_injected:faultsInjected,
    degraded_transport:degradedTransport,base_delay_ms:baseDelay,jitter_ms:jitter,
    chunk_delay_ms:chunkDelay,chunk_bytes:chunkSize,responses_seen:responseCounter
  }}

  async function deliverDegradedResponse({res,upstreamRes,chunks,shouldDrop,ordinal,responseNumber}){
    const delay=Math.max(0,baseDelay+deterministicJitter(responseNumber,jitter));
    await sleep(delay);
    if(res.destroyed)return;
    res.writeHead(upstreamRes.statusCode??502,upstreamRes.headers);
    const pieces=[];
    for(const chunk of chunks){
      if(chunkSize>0&&chunk.length>chunkSize){for(let offset=0;offset<chunk.length;offset+=chunkSize)pieces.push(chunk.subarray(offset,Math.min(chunk.length,offset+chunkSize)))}
      else pieces.push(chunk);
    }
    if(shouldDrop){
      faultsInjected+=1;
      const first=pieces[0]??Buffer.from('{}');
      const prefix=first.subarray(0,Math.max(1,Math.floor(first.length/2)));
      if(prefix.length&&!res.destroyed)res.write(prefix);
      await evidence('fault_injected',{session_number:sessionNumber,secure_ordinal:ordinal,mode:'truncate_response',degraded_transport:true,response_delay_ms:delay});
      if(!res.destroyed)res.destroy();return;
    }
    for(let index=0;index<pieces.length;index+=1){
      if(index>0)await sleep(chunkDelay);
      if(res.destroyed)return;
      res.write(pieces[index]);
    }
    if(!res.destroyed)res.end();
  }

  const server=http.createServer((req,res)=>{
    const incoming=new URL(req.url,'http://fault-proxy.invalid');
    if(req.method==='GET'&&incoming.pathname==='/proxy/status')return sendJson(res,200,status());

    if(req.method==='POST'&&incoming.pathname==='/peer/channel'){
      sessionNumber+=1;secureOrdinal=0;
    }
    const isSecure=req.method==='POST'&&incoming.pathname==='/peer/secure';
    const ordinal=isSecure?++secureOrdinal:null;
    const shouldDrop=isSecure&&dropAt>0&&ordinal===dropAt;
    const requestUrl=new URL(`${incoming.pathname}${incoming.search}`,targetBase);
    const transport=targetBase.protocol==='https:'?https:http;

    const upstream=transport.request({
      protocol:targetBase.protocol,hostname:targetBase.hostname,port:targetBase.port||undefined,
      method:req.method,path:`${requestUrl.pathname}${requestUrl.search}`,
      headers:{...req.headers,host:targetBase.host}
    },upstreamRes=>{
      if(res.destroyed){upstreamRes.destroy();return}
      responseCounter+=1;
      const responseNumber=responseCounter;
      if(degradedTransport){
        const chunks=[];
        upstreamRes.on('data',chunk=>chunks.push(Buffer.from(chunk)));
        upstreamRes.on('end',()=>{void deliverDegradedResponse({res,upstreamRes,chunks,shouldDrop,ordinal,responseNumber}).catch(()=>{if(!res.destroyed)res.destroy()})});
        upstreamRes.on('error',()=>{if(!res.destroyed)res.destroy()});
        return;
      }
      res.writeHead(upstreamRes.statusCode??502,upstreamRes.headers);
      let interrupted=false;
      upstreamRes.on('data',chunk=>{
        if(shouldDrop&&!interrupted){
          interrupted=true;faultsInjected+=1;
          const prefix=chunk.subarray(0,Math.max(1,Math.floor(chunk.length/2)));
          if(prefix.length&&!res.destroyed)res.write(prefix);
          void evidence('fault_injected',{session_number:sessionNumber,secure_ordinal:ordinal,mode:'truncate_response'}).catch(()=>{});
          upstreamRes.destroy();res.destroy();return;
        }
        if(!interrupted&&!res.destroyed)res.write(chunk);
      });
      upstreamRes.on('end',()=>{if(!interrupted&&!res.destroyed)res.end()});
      upstreamRes.on('error',()=>{if(!res.destroyed)res.destroy()});
    });
    upstream.on('error',error=>{
      void evidence('upstream_error',{message:String(error?.message??error),code:error?.code??null}).catch(()=>{});
      if(!res.headersSent&&!res.destroyed)return sendJson(res,502,{ok:false,error:'fault_proxy_upstream_error'});
      if(!res.destroyed)res.destroy();
    });
    req.on('error',()=>upstream.destroy());
    req.pipe(upstream);
  });

  async function start(){
    if(resolvedEvidence)await evidence('starting',{drop_secure_ordinal:dropAt,degraded_transport:degradedTransport,base_delay_ms:baseDelay,jitter_ms:jitter,chunk_delay_ms:chunkDelay,chunk_bytes:chunkSize});
    await new Promise((resolvePromise,reject)=>{server.once('error',reject);server.listen(port,host,()=>{server.off('error',reject);resolvePromise()})});
    await evidence('online',{base_url:baseUrl(),status:status()});return api();
  }
  async function close(){if(server.listening)await new Promise(resolvePromise=>server.close(resolvePromise));await evidence('shutdown',{status:status()});await evidenceLock}
  function baseUrl(){const address=server.address();if(!address||typeof address==='string')return null;return `http://${host}:${address.port}`}
  function api(){return{start,close,baseUrl,status}}
  return api();
}

export async function startFullTargetShadowFaultProxyFromEnvironment(){
  const target=process.env.FAE_SHADOW_PROXY_TARGET;
  if(!target)throw new Error('FAE_SHADOW_PROXY_TARGET_required');
  const proxy=createFullTargetShadowFaultProxy({
    target,
    host:process.env.FAE_SHADOW_PROXY_HOST||'0.0.0.0',
    port:integer(process.env.FAE_SHADOW_PROXY_PORT,8790,{min:1,max:65535}),
    dropSecureOrdinal:integer(process.env.FAE_SHADOW_PROXY_DROP_SECURE_ORDINAL,0,{min:0,max:32}),
    evidenceFile:process.env.FAE_SHADOW_PROXY_EVIDENCE_FILE||'/data/full-target-shadow-fault-proxy.jsonl',
    label:(process.env.FAE_SHADOW_PROXY_LABEL||'fault-proxy').trim()||'fault-proxy',
    baseDelayMs:integer(process.env.FAE_SHADOW_PROXY_BASE_DELAY_MS,0,{min:0,max:30_000}),
    jitterMs:integer(process.env.FAE_SHADOW_PROXY_JITTER_MS,0,{min:0,max:30_000}),
    chunkDelayMs:integer(process.env.FAE_SHADOW_PROXY_CHUNK_DELAY_MS,0,{min:0,max:10_000}),
    chunkBytes:integer(process.env.FAE_SHADOW_PROXY_CHUNK_BYTES,0,{min:0,max:1024*1024})
  });
  await proxy.start();
  console.log(JSON.stringify({event:'shadow-fault-proxy-online',base_url:proxy.baseUrl(),...proxy.status()}));
  let stopping=false;
  const stop=async signal=>{if(stopping)return;stopping=true;try{await proxy.close()}finally{console.log(JSON.stringify({event:'shadow-fault-proxy-shutdown',signal,...proxy.status()}))}};
  process.on('SIGINT',()=>void stop('SIGINT'));
  process.on('SIGTERM',()=>void stop('SIGTERM'));
  return proxy;
}

const invokedPath=process.argv[1]?pathToFileURL(resolve(process.argv[1])).href:null;
if(invokedPath===import.meta.url){
  startFullTargetShadowFaultProxyFromEnvironment().catch(error=>{console.error(JSON.stringify({event:'shadow-fault-proxy-fatal',error:{name:error?.name??'Error',message:String(error?.message??error),code:error?.code??null}}));process.exitCode=1});
}
