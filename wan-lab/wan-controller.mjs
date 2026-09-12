#!/usr/bin/env node
import http from 'node:http';
import { createHash } from 'node:crypto';

const PORT=Number(process.env.PORT||3199);
const TOKEN=process.env.FAE_LAB_TOKEN||'local-test-token';
const NODES=[process.env.FAE_NODE_A,process.env.FAE_NODE_B,process.env.FAE_NODE_C].filter(Boolean).map(x=>x.replace(/\/$/,''));
const TARGETS=[300,600,900];
const STEADY_BLOCKS=250;
const STRESS_BLOCKS=100;
const BASE_TX_PER_BLOCK=20;
const TX_BYTES=512;
const POLICY='throughput-neutral-dynamic-relay-v3';
const ENVIRONMENT='render-oregon-frankfurt-singapore-v3';
const COMMIT=String(process.env.RENDER_GIT_COMMIT||'').toLowerCase();
const GENESIS='0'.repeat(64);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let result={ok:false,status:'starting',format:'FAE_BLOCK_TIME_V2_WAN_V3',startedAt:new Date().toISOString(),targets:TARGETS,nodes:NODES};

async function req(base,path,method='GET',payload=null,timeout=12000,retries=5){
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
    await sleep(Math.min(1600,150*(2**a)));
  }
  throw last||Error('request_failed');
}
const post=(u,p,b={})=>req(u,p,'POST',b);
function canonical(v){if(Array.isArray(v))return v.map(canonical);if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])]));return v}
function blockHash(v){const a=createHash('sha256').update(JSON.stringify(canonical(v))).digest();return createHash('sha256').update(a).digest('hex')}
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
  const s=await statuses();
  if(!s.every(x=>x.height===0&&x.knownBlocks===0&&x.staleBlocks===0))throw Error('clean_start_failed:'+JSON.stringify(s.map(x=>({nodeId:x.nodeId,height:x.height,knownBlocks:x.knownBlocks,staleBlocks:x.staleBlocks}))));
}
async function eventAt(i,hash){const e=await req(NODES[i],'/events?limit=80','GET',null,9000,3);return (e.events||[]).find(x=>x.hash===hash)||null}
async function waitRelay(hash,t0){
  const pending=new Set([1,2]),out=[],start=Date.now();
  while(pending.size&&Date.now()-start<20000){
    for(const i of [...pending]){try{const e=await eventAt(i,hash);if(e&&Number.isFinite(e.firstSeenMs)){const d=e.firstSeenMs-t0;if(d>=0)out.push(d);else throw Error('clock_order_violation');pending.delete(i)}}catch(e){if(e.message==='clock_order_violation')throw e}}
    if(pending.size)await sleep(35);
  }
  if(pending.size)throw Error('relay_timeout:'+hash+':'+[...pending].join(','));
  return out;
}

let seq=0,parent=GENESIS,height=0;
function makeBlock(target,phase,multiplier){
  const txPerBlock=Math.round(BASE_TX_PER_BLOCK*(target/300));
  const core={lab:'FAE_WAN_LAB_V1',height:height+1,parent,createdAtMs:Date.now(),origin:`BTV3-${target}-${phase}`,seq:++seq,nonce:`btv3-${seq}`};
  return {...core,hash:blockHash(core),syntheticPayload:'x'.repeat(txPerBlock*TX_BYTES*multiplier),syntheticMeta:{targetSeconds:target,phase,txPerBlock,txBytes:TX_BYTES,multiplier,policy:POLICY}};
}
async function relayOne(block){
  await post(NODES[0],'/control/peers',{peers:[NODES[1],NODES[2]]});
  let ing;
  try{ing=await post(NODES[0],'/ingest',{block,from:'btv3-controller'});}
  finally{await post(NODES[0],'/control/peers',{peers:[]}).catch(()=>{});}
  const t0=Number(ing.firstSeenMs);if(!Number.isFinite(t0))throw Error('origin_seen_missing');
  return waitRelay(block.hash,t0);
}
async function phase(target,name,count,multiplier,collect){
  const before=await statuses(),staleBefore=Math.max(...before.map(x=>Number(x.staleBlocks||0))),lat=[];
  for(let i=0;i<count;i++){
    const b=makeBlock(target,name,multiplier),d=await relayOne(b);if(collect)lat.push(...d);parent=b.hash;height++;
    if((i+1)%50===0)console.log(JSON.stringify({event:'FAE_BTV3_PROGRESS',target,phase:name,completed:i+1,total:count,samples:lat.length,height}));
  }
  await sleep(600);
  const after=await statuses();
  if(!after.every(x=>x.height===height&&x.tipHash===parent))throw Error('nonconvergence:'+JSON.stringify(after.map(x=>({nodeId:x.nodeId,height:x.height,tipHash:x.tipHash}))));
  const staleAfter=Math.max(...after.map(x=>Number(x.staleBlocks||0)));
  return {staleDelta:staleAfter-staleBefore,lat,statuses:after.map(x=>({nodeId:x.nodeId,region:x.region,height:x.height,knownBlocks:x.knownBlocks,staleBlocks:x.staleBlocks,reorgCount:x.reorgCount,tipHash:x.tipHash}))};
}
async function targetRun(target){
  const steady=await phase(target,'steady',STEADY_BLOCKS,1,true);
  const stress=await phase(target,'stress',STRESS_BLOCKS,2,false);
  if(steady.lat.length<500)throw Error(`insufficient_samples:${target}:${steady.lat.length}`);
  const txPerBlock=Math.round(BASE_TX_PER_BLOCK*(target/300)),median=q(steady.lat,.5),p95=q(steady.lat,.95),mean=avg(steady.lat);
  return {targetSeconds:target,nodeCount:3,regionCount:3,propagationSamples:steady.lat.length,payloadPolicyId:POLICY,nominalTps:txPerBlock/target,propagationSeconds:{median:median/1000,mean:mean/1000,p95:p95/1000},steady:{blocks:STEADY_BLOCKS,staleBlocks:steady.staleDelta},stress:{blocks:STRESS_BLOCKS,staleBlocks:stress.staleDelta},details:{txPerBlock,txBytes:TX_BYTES,steadyPayloadBytes:txPerBlock*TX_BYTES,stressPayloadBytes:txPerBlock*TX_BYTES*2,propagationMs:{median,mean,p95,max:Math.max(...steady.lat)},measurementClass:'real-WAN peer relay with peers enabled only for each relay; background snapshot traffic suppressed by peer-list isolation',staleEvidenceClass:'serialized controlled sample; not natural competing-block stale evidence',steadyNodes:steady.statuses,stressNodes:stress.statuses}};
}
function compare(base,cand){const b=race(base.propagationSeconds.p95,300),c=race(cand.propagationSeconds.p95,cand.targetSeconds),ratio=c/b;return {candidateTargetSeconds:cand.targetSeconds,throughputRatio:cand.nominalTps/base.nominalTps,payloadPolicyMatched:base.payloadPolicyId===cand.payloadPolicyId,baselineP95RaceProbability:b,candidateP95RaceProbability:c,candidateToBaselineRaceRatio:ratio,atLeast25PctLowerP95Race:ratio<=.75,atLeast50PctLowerP95Race:ratio<=.5,propagationGatePass:base.propagationSeconds.median<1&&base.propagationSeconds.mean<2&&base.propagationSeconds.p95<5&&cand.propagationSeconds.median<1&&cand.propagationSeconds.mean<2&&cand.propagationSeconds.p95<5&&ratio<=.75,staleRateEvidencePass:false,l2NetworkPromotionEvidencePass:false,selectionAuthorized:false,activationAuthorized:false};}

async function run(){
  await cleanStart();const measurements={};
  for(const target of TARGETS){result={...result,status:`running-${target}`,currentTarget:target};measurements[target]=await targetRun(target);console.log(JSON.stringify({event:'FAE_BTV3_TARGET_COMPLETE',measurement:measurements[target]}));}
  const comparisons={candidate600:compare(measurements[300],measurements[600]),candidate900:compare(measurements[300],measurements[900])};
  result={ok:true,status:'COMPLETE',format:'FAE_BLOCK_TIME_V2_WAN_V3',startedAt:result.startedAt,finishedAt:new Date().toISOString(),authority:'research-only-no-consensus-authority',harnessCommit:COMMIT||'unknown',environmentId:ENVIRONMENT,payloadPolicyId:POLICY,nodes:NODES,measurements,comparisons,verdictBoundary:'Propagation gate may inform L2. Natural stale-rate evidence is still absent, so L2 network promotion, candidate selection and activation remain fail-closed. L3 remains mandatory before activation.'};
  console.log(JSON.stringify({event:'FAE_BTV3_COMPLETE',result}));
}
run().catch(e=>{result={...result,ok:false,status:'FAIL',finishedAt:new Date().toISOString(),error:e.message};console.error(JSON.stringify({event:'FAE_BTV3_FAILED',result}))});
http.createServer((req,res)=>{res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(req.url==='/result'?result:{ok:true,status:result.status,currentTarget:result.currentTarget||null}))}).listen(PORT,'0.0.0.0',()=>console.log(`FAE block-time v2 WAN v3 listening ${PORT}`));
