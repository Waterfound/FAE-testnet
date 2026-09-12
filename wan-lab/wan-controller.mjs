#!/usr/bin/env node
import http from 'node:http';
import { createHash } from 'node:crypto';

const PORT=Number(process.env.PORT||3199);
const TOKEN=process.env.FAE_LAB_TOKEN||'local-test-token';
const NODES=[process.env.FAE_NODE_A,process.env.FAE_NODE_B,process.env.FAE_NODE_C].filter(Boolean).map(x=>x.replace(/\/$/,''));
const TARGETS=[300,600,900];
const STEADY_BLOCKS=260;
const STRESS_BLOCKS=100;
const BASE_TX_PER_BLOCK=20;
const TX_BYTES=512;
const PAYLOAD_POLICY_ID='synthetic-512Btx-throughput-neutral-v2-single-chain';
const ENVIRONMENT_ID='render-oregon-frankfurt-singapore-v2';
const HARNESS_COMMIT=String(process.env.RENDER_GIT_COMMIT||'').toLowerCase();
const GENESIS='0'.repeat(64);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let result={ok:false,status:'starting',format:'FAE_BLOCK_TIME_V2_BATCH_V2',startedAt:new Date().toISOString(),targets:TARGETS,nodes:NODES};

async function req(base,path,method='GET',payload=null,timeout=15000,retries=6){
  let last;
  for(let a=0;a<=retries;a++){
    const c=new AbortController(),t=setTimeout(()=>c.abort(),timeout);
    try{
      const r=await fetch(base+path,{method,signal:c.signal,headers:{'content-type':'application/json','x-fae-lab-token':TOKEN},body:payload?JSON.stringify(payload):undefined});
      const j=await r.json().catch(()=>({}));
      if(r.ok)return j;
      const e=Error(`${r.status}:${j.error||r.statusText}`);last=e;
      if(![408,425,429,500,502,503,504].includes(r.status)||a===retries)throw e;
    }catch(e){last=e;if(a===retries)throw e}
    finally{clearTimeout(t)}
    await sleep(Math.min(2500,200*(2**a))+Math.floor(Math.random()*100));
  }
  throw last||Error('request_failed');
}
const post=(u,p,b={})=>req(u,p,'POST',b);
function canonical(v){if(Array.isArray(v))return v.map(canonical);if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])]));return v}
function hashBlockPayload(v){const a=createHash('sha256').update(JSON.stringify(canonical(v))).digest();return createHash('sha256').update(a).digest('hex')}
function q(xs,p){const s=[...xs].sort((a,b)=>a-b),x=(s.length-1)*p,l=Math.floor(x),h=Math.ceil(x);return l===h?s[l]:s[l]*(h-x)+s[h]*(x-l)}
function avg(xs){return xs.reduce((a,b)=>a+b,0)/xs.length}
function race(delay,target){return 1-Math.exp(-delay/target)}
async function statuses(){return Promise.all(NODES.map(n=>req(n,'/status')))}

async function cleanStart(){
  if(NODES.length!==3)throw Error('three_nodes_required');
  await Promise.allSettled(NODES.map(n=>post(n,'/control/auto-produce',{enabled:false})));
  await Promise.all(NODES.map(n=>post(n,'/control/peers',{peers:[]})));
  await sleep(6500);
  await Promise.all(NODES.map(n=>post(n,'/control/reset')));
  await sleep(1500);
  let s=await statuses();
  if(!s.every(x=>x.height===0&&x.knownBlocks===0&&x.staleBlocks===0))throw Error('clean_start_failed:'+JSON.stringify(s));
  await Promise.all(NODES.flatMap((n,i)=>NODES.filter((_,j)=>j!==i).map(peer=>post(n,'/control/peer-block',{peer,blocked:false}).catch(()=>{}))));
  await Promise.all(NODES.map((n,i)=>post(n,'/control/peers',{peers:NODES.filter((_,j)=>j!==i)})));
  await sleep(1500);
  s=await statuses();
  if(!s.every(x=>x.height===0&&x.knownBlocks===0&&x.staleBlocks===0))throw Error('clean_link_failed:'+JSON.stringify(s));
}

async function eventAt(i,hash){const e=await req(NODES[i],'/events?limit=120','GET',null,10000,4);return (e.events||[]).find(x=>x.hash===hash)||null}
async function propagation(hash,origin,originSeen){
  const pending=new Set([0,1,2].filter(i=>i!==origin)),out=[],start=Date.now();
  while(pending.size&&Date.now()-start<30000){
    for(const i of [...pending]){try{const e=await eventAt(i,hash);if(e&&Number.isFinite(e.firstSeenMs)){const d=e.firstSeenMs-originSeen;if(d>=0)out.push(d);pending.delete(i)}}catch{}}
    if(pending.size)await sleep(40);
  }
  if(pending.size)throw Error('propagation_timeout:'+hash+':'+[...pending].join(','));
  return out;
}

let seq=0,parent=GENESIS,height=0;
function blockFor(target,phase,origin,payloadMultiplier){
  const txPerBlock=Math.round(BASE_TX_PER_BLOCK*(target/300));
  const core={lab:'FAE_WAN_LAB_V1',height:height+1,parent,createdAtMs:Date.now(),origin:`BTV2-${target}-${phase}-${origin}`,seq:++seq,nonce:`btv2-${seq}`};
  return {...core,hash:hashBlockPayload(core),syntheticPayload:'x'.repeat(txPerBlock*TX_BYTES*payloadMultiplier),syntheticMeta:{targetSeconds:target,phase,txPerBlock,txBytes:TX_BYTES,payloadMultiplier,payloadPolicyId:PAYLOAD_POLICY_ID}};
}

async function runPhase(target,phase,count,payloadMultiplier,rotate,collect){
  const before=await statuses();
  const staleBefore=Math.max(...before.map(x=>Number(x.staleBlocks||0)));
  const lat=[];
  for(let i=0;i<count;i++){
    const origin=rotate?i%3:0,b=blockFor(target,phase,origin,payloadMultiplier);
    const ing=await post(NODES[origin],'/ingest',{block:b,from:`btv2-batch-${phase}`});
    const seen=Number(ing.firstSeenMs);if(!Number.isFinite(seen))throw Error('origin_seen_missing');
    const d=await propagation(b.hash,origin,seen);if(collect)lat.push(...d);
    parent=b.hash;height++;
    if((i+1)%50===0)console.log(JSON.stringify({event:'FAE_BTV2_PROGRESS',target,phase,completed:i+1,total:count,samples:lat.length,height}));
  }
  await sleep(1500);
  const after=await statuses();
  if(!after.every(x=>x.height===height&&x.tipHash===parent))throw Error('nonconvergence:'+JSON.stringify(after));
  const staleAfter=Math.max(...after.map(x=>Number(x.staleBlocks||0)));
  return {blockCount:count,staleDelta:staleAfter-staleBefore,latencies:lat,statuses:after.map(x=>({nodeId:x.nodeId,region:x.region,height:x.height,knownBlocks:x.knownBlocks,staleBlocks:x.staleBlocks,reorgCount:x.reorgCount,tipHash:x.tipHash}))};
}

async function runTarget(target){
  const steady=await runPhase(target,'steady',STEADY_BLOCKS,1,false,true);
  const stress=await runPhase(target,'stress',STRESS_BLOCKS,2,true,false);
  const ms=steady.latencies.filter(x=>Number.isFinite(x)&&x>=0);if(ms.length<500)throw Error(`insufficient_samples:${target}:${ms.length}`);
  const txPerBlock=Math.round(BASE_TX_PER_BLOCK*(target/300));
  const median=q(ms,.5),p95=q(ms,.95),mean=avg(ms);
  return {targetSeconds:target,nodeCount:3,regionCount:3,propagationSamples:ms.length,payloadPolicyId:PAYLOAD_POLICY_ID,nominalTps:txPerBlock/target,propagationSeconds:{median:median/1000,mean:mean/1000,p95:p95/1000},steady:{blocks:STEADY_BLOCKS,staleBlocks:steady.staleDelta},stress:{blocks:STRESS_BLOCKS,staleBlocks:stress.staleDelta},shadowDetails:{txPerBlock,txBytes:TX_BYTES,steadyPayloadBytes:txPerBlock*TX_BYTES,stressPayloadBytes:txPerBlock*TX_BYTES*2,propagationMs:{median,mean,p95,max:Math.max(...ms)},staleEvidenceClass:'controlled-serialized-shadow-not-natural-stale-rate',steadyNodes:steady.statuses,stressNodes:stress.statuses}};
}

function compare(base,cand){
  const b=race(base.propagationSeconds.p95,base.targetSeconds),c=race(cand.propagationSeconds.p95,cand.targetSeconds),ratio=c/b;
  return {baselineTargetSeconds:300,candidateTargetSeconds:cand.targetSeconds,payloadPolicyMatched:base.payloadPolicyId===cand.payloadPolicyId,throughputRatio:cand.nominalTps/base.nominalTps,propagationAbsolute:{baseline:{medianUnder1s:base.propagationSeconds.median<1,meanUnder2s:base.propagationSeconds.mean<2,p95Under5s:base.propagationSeconds.p95<5},candidate:{medianUnder1s:cand.propagationSeconds.median<1,meanUnder2s:cand.propagationSeconds.mean<2,p95Under5s:cand.propagationSeconds.p95<5}},comparativeRaceProxy:{baselineP95RaceProbability:b,candidateP95RaceProbability:c,candidateToBaselineRaceRatio:ratio,atLeast25PctLowerP95Race:ratio<=.75,atLeast50PctLowerP95Race:ratio<=.5},propagationPromotionEvidence:ratio<=.75,staleRatePromotionEvidence:false,l2NetworkPromotionEvidencePass:false,reason:'Propagation evidence is real-WAN; stale observations are controlled serialized shadow evidence, not a natural competing-block sample. Final L2 network promotion remains fail-closed until natural stale evidence is available.',selectionAuthorized:false,activationAuthorized:false};
}

async function run(){
  await cleanStart();
  const measurements={};
  for(const target of TARGETS){result={...result,status:`running-${target}`,currentTarget:target};measurements[target]=await runTarget(target);console.log(JSON.stringify({event:'FAE_BTV2_TARGET_COMPLETE',measurement:measurements[target]}))}
  const comparisons={candidate600:compare(measurements[300],measurements[600]),candidate900:compare(measurements[300],measurements[900])};
  result={ok:true,status:'COMPLETE',format:'FAE_BLOCK_TIME_V2_BATCH_V2',startedAt:result.startedAt,finishedAt:new Date().toISOString(),authority:'research-only-no-consensus-authority',harnessCommit:HARNESS_COMMIT||'unknown',environmentId:ENVIRONMENT_ID,payloadPolicyId:PAYLOAD_POLICY_ID,nodes:NODES,measurements,comparisons,interpretationBoundary:'Real-WAN payload/propagation evidence across three regions. Controlled serialized blocks do not establish natural stale rate; candidate selection and activation remain unauthorized, and L3 remains mandatory before any activation.'};
  console.log(JSON.stringify({event:'FAE_BTV2_BATCH_COMPLETE',result}));
}
run().catch(e=>{result={...result,ok:false,status:'FAIL',finishedAt:new Date().toISOString(),error:e.message};console.error(JSON.stringify({event:'FAE_BTV2_BATCH_FAILED',result}))});
http.createServer((req,res)=>{res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(req.url==='/result'?result:{ok:true,status:result.status,currentTarget:result.currentTarget||null}))}).listen(PORT,'0.0.0.0',()=>console.log(`FAE block-time v2 batch listening ${PORT}`));
