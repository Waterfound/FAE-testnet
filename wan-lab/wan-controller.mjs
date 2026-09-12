#!/usr/bin/env node
import http from 'node:http';
import { createHash } from 'node:crypto';

const PORT = Number(process.env.PORT || 3199);
const TOKEN = process.env.FAE_LAB_TOKEN || 'local-test-token';
const NODES = [process.env.FAE_NODE_A, process.env.FAE_NODE_B, process.env.FAE_NODE_C]
  .filter(Boolean).map(x => x.replace(/\/$/, ''));
const TARGETS = [300, 600, 900];
const BASE_TX_PER_BLOCK = 20;
const TX_BYTES = 512;
const STEADY_BLOCKS = 400;
const STRESS_BLOCKS = 200;
const PAYLOAD_POLICY_ID = 'synthetic-512Btx-throughput-neutral-v1';
const HARNESS_COMMIT = String(process.env.RENDER_GIT_COMMIT || process.env.RENDER_COMMIT || '').toLowerCase();
const ENVIRONMENT_ID = 'render-oregon-frankfurt-singapore-v1';
const Z95 = 1.959963984540054;

let result = {
  ok: false,
  status: 'warming',
  format: 'FAE_BLOCK_TIME_V2_REAL_WAN_V1',
  startedAt: new Date().toISOString(),
  nodes: NODES,
  targets: TARGETS,
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function req(url, path, method = 'GET', payload = null, timeout = 15000, retries = 6) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), timeout);
    try {
      const r = await fetch(url + path, {
        method,
        signal: c.signal,
        headers: {'content-type':'application/json','x-fae-lab-token':TOKEN},
        body: payload ? JSON.stringify(payload) : undefined,
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok) return j;
      const retryable = [408,425,429,500,502,503,504].includes(r.status);
      const err = Error(`${r.status}:${j.error || r.statusText}`);
      if (!retryable || attempt === retries) throw err;
      lastError = err;
    } catch (e) {
      lastError = e;
      if (attempt === retries) throw e;
    } finally { clearTimeout(t); }
    await sleep(Math.min(2500, 200 * (2 ** attempt)) + Math.floor(Math.random() * 100));
  }
  throw lastError || Error('request_failed');
}
const post = (u,p,b={}) => req(u,p,'POST',b);

function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])]));
  return v;
}
function hashBlockPayload(v) {
  const a = createHash('sha256').update(JSON.stringify(canonical(v))).digest();
  return createHash('sha256').update(a).digest('hex');
}
function quantile(xs,q) {
  if (!xs.length) return null;
  const s = [...xs].sort((a,b)=>a-b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  if (lo === hi) return s[lo];
  const w = pos - lo;
  return s[lo] * (1-w) + s[hi] * w;
}
function mean(xs) { return xs.reduce((a,b)=>a+b,0) / xs.length; }
function raceProbability(delaySeconds,targetSeconds){ return 1 - Math.exp(-delaySeconds/targetSeconds); }
function wilsonUpper95(successes,trials){
  const p=successes/trials,z2=Z95**2,denom=1+z2/trials,center=p+z2/(2*trials);
  const margin=Z95*Math.sqrt((p*(1-p)+z2/(4*trials))/trials);
  return (center+margin)/denom;
}
function absoluteReadiness(run){
  const steadyUpper95=wilsonUpper95(run.steady.staleBlocks,run.steady.blocks);
  const stressUpper95=wilsonUpper95(run.stress.staleBlocks,run.stress.blocks);
  const propagation={medianUnder1s:run.propagationSeconds.median<1,meanUnder2s:run.propagationSeconds.mean<2,p95Under5s:run.propagationSeconds.p95<5};
  const stale={steadyUpper95,stressUpper95,steadyUnder1Pct95:steadyUpper95<0.01,stressUnder2Pct95:stressUpper95<0.02};
  return {propagation,stale,pass:Object.values(propagation).every(Boolean)&&stale.steadyUnder1Pct95&&stale.stressUnder2Pct95};
}
function evaluatePair(bundle){
  const base=bundle.baseline,cand=bundle.candidate;
  const throughputRatio=cand.nominalTps/base.nominalTps;
  const throughputComparable=throughputRatio>=0.95&&throughputRatio<=1.05;
  const baselineReadiness=absoluteReadiness(base),candidateReadiness=absoluteReadiness(cand);
  const baseP95Race=raceProbability(base.propagationSeconds.p95,base.targetSeconds);
  const candidateP95Race=raceProbability(cand.propagationSeconds.p95,cand.targetSeconds);
  const raceRatio=candidateP95Race/baseP95Race;
  const comparativeAdvantage={baselineP95RaceProbability:baseP95Race,candidateP95RaceProbability:candidateP95Race,candidateToBaselineRaceRatio:raceRatio,atLeast25PctLowerP95Race:raceRatio<=0.75,atLeast50PctLowerP95Race:raceRatio<=0.50};
  const evidencePass=throughputComparable&&baselineReadiness.pass&&candidateReadiness.pass&&comparativeAdvantage.atLeast25PctLowerP95Race;
  return {schema:'fae-economic-block-time-v2-evidence-evaluation/1',authority:'evidence-only-no-consensus-authority',harnessCommit:bundle.harnessCommit,environmentId:bundle.environmentId,baselineTargetSeconds:300,candidateTargetSeconds:cand.targetSeconds,admission:{minimumNodesPerRun:3,minimumRegionsPerRun:2,minimumPropagationSamplesPerRun:500,payloadPolicyMatched:base.payloadPolicyId===cand.payloadPolicyId,throughputRatio,throughputComparable},baselineReadiness,candidateReadiness,comparativeAdvantage,l2NetworkPromotionEvidencePass:evidencePass,selectionAuthorized:false,activationAuthorized:false,nextBoundary:evidencePass?'May be considered with the rest of L2 evidence; candidate selection still requires an explicit decision. L3 is mandatory before any testnet activation.':'Remain in L2 research; do not select or activate this challenger.'};
}

async function waitReady() {
  for (let i=0;i<120;i++) {
    const s=await Promise.allSettled(NODES.map(n=>req(n,'/status','GET',null,10000,2)));
    if (s.every(x=>x.status==='fulfilled')) return s.map(x=>x.value);
    await sleep(2000);
  }
  throw Error('nodes_not_ready');
}
async function statuses(){ return Promise.all(NODES.map(n=>req(n,'/status'))); }
async function configure() {
  await Promise.all(NODES.map(n=>post(n,'/control/auto-produce',{enabled:false}).catch(()=>{})));
  await Promise.all(NODES.map(n=>post(n,'/control/peers',{peers:[]})));
  await sleep(600);
  await Promise.all(NODES.map(n=>post(n,'/control/reset')));
  await sleep(1200);
  const clean=await statuses();
  if (!clean.every(x=>Number(x.height)===0 && Number(x.knownBlocks)===0 && Number(x.staleBlocks)===0)) {
    throw Error(`phase_reset_contaminated:${JSON.stringify(clean.map(x=>({nodeId:x.nodeId,height:x.height,knownBlocks:x.knownBlocks,staleBlocks:x.staleBlocks})))}`);
  }
  await Promise.all(NODES.flatMap((n,i)=>NODES.filter((_,j)=>j!==i).map(peer=>post(n,'/control/peer-block',{peer,blocked:false}).catch(()=>{}))));
  await Promise.all(NODES.map((n,i)=>post(n,'/control/peers',{peers:NODES.filter((_,j)=>j!==i)})));
  await sleep(1200);
  const linked=await statuses();
  if (!linked.every(x=>Number(x.height)===0 && Number(x.knownBlocks)===0 && Number(x.staleBlocks)===0)) {
    throw Error(`phase_link_contaminated:${JSON.stringify(linked.map(x=>({nodeId:x.nodeId,height:x.height,knownBlocks:x.knownBlocks,staleBlocks:x.staleBlocks})))}`);
  }
}

async function findEvent(nodeIndex, hash, limit=100) {
  const e = await req(NODES[nodeIndex],`/events?limit=${limit}`,'GET',null,10000,4);
  return (e.events || []).find(x=>x.hash===hash) || null;
}
async function waitPeerEvents(hash, originIndex, originSeenMs, timeout=30000) {
  const start=Date.now();
  const pending=new Set(NODES.map((_,i)=>i).filter(i=>i!==originIndex));
  const samples=[];
  while (pending.size && Date.now()-start<timeout) {
    for (const i of [...pending]) {
      try {
        const ev=await findEvent(i,hash,120);
        if (ev && Number.isFinite(ev.firstSeenMs)) {
          const delta=ev.firstSeenMs-originSeenMs;
          if (delta>=0) samples.push(delta);
          pending.delete(i);
        }
      } catch {}
    }
    if (pending.size) await sleep(40);
  }
  if (pending.size) throw Error(`propagation_timeout:${hash}:${[...pending].join(',')}`);
  return samples;
}

let seq=0;
function buildBlock({parent,height,targetSeconds,txPerBlock,phase,originIndex,payloadMultiplier=1}) {
  const createdAtMs=Date.now();
  const core={lab:'FAE_WAN_LAB_V1',height,parent,createdAtMs,origin:`BT${targetSeconds}-${phase}-${originIndex}`,seq:++seq,nonce:`btv2-${targetSeconds}-${phase}-${seq}`};
  const syntheticBytes=Math.max(1,Math.round(txPerBlock*TX_BYTES*payloadMultiplier));
  return {...core,hash:hashBlockPayload(core),syntheticPayload:'x'.repeat(syntheticBytes),syntheticMeta:{targetSeconds,txPerBlock,txBytes:TX_BYTES,payloadMultiplier,policy:PAYLOAD_POLICY_ID,phase}};
}

async function runPhase({targetSeconds,blocks,phase,payloadMultiplier=1,rotateOrigins=false,collectPropagation=false}) {
  await configure();
  let parent='0'.repeat(64),height=0;
  const latencies=[];
  for (let i=0;i<blocks;i++) {
    const originIndex=rotateOrigins ? i%NODES.length : 0;
    const txPerBlock=Math.round(BASE_TX_PER_BLOCK*(targetSeconds/300));
    const block=buildBlock({parent,height:height+1,targetSeconds,txPerBlock,phase,originIndex,payloadMultiplier});
    const ing=await post(NODES[originIndex],'/ingest',{block,from:`block-time-v2-controller-${phase}`});
    const originSeenMs=Number(ing.firstSeenMs);
    if (!Number.isFinite(originSeenMs)) throw Error('origin_first_seen_missing');
    const samples=await waitPeerEvents(block.hash,originIndex,originSeenMs);
    if (collectPropagation) latencies.push(...samples);
    parent=block.hash;height++;
    if ((i+1)%50===0) console.log(JSON.stringify({event:'FAE_BLOCK_TIME_V2_PROGRESS',targetSeconds,phase,completed:i+1,total:blocks,samples:latencies.length}));
  }
  await sleep(1200);
  const s=await statuses();
  const stale=Math.max(...s.map(x=>Number(x.staleBlocks||0)));
  const canonicalHeight=Math.max(...s.map(x=>Number(x.height||0)));
  if (canonicalHeight!==height) throw Error(`unexpected_height:${phase}:${targetSeconds}:${canonicalHeight}:${height}`);
  return {blocks:height+stale,staleBlocks:stale,latencies,statuses:s.map((x,i)=>({node:NODES[i],nodeId:x.nodeId,region:x.region,height:x.height,knownBlocks:x.knownBlocks,staleBlocks:x.staleBlocks,reorgCount:x.reorgCount,tipHash:x.tipHash}))};
}

async function runTarget(targetSeconds) {
  const txPerBlock=Math.round(BASE_TX_PER_BLOCK*(targetSeconds/300));
  const steady=await runPhase({targetSeconds,blocks:STEADY_BLOCKS,phase:'steady',payloadMultiplier:1,rotateOrigins:false,collectPropagation:true});
  const stress=await runPhase({targetSeconds,blocks:STRESS_BLOCKS,phase:'stress',payloadMultiplier:2,rotateOrigins:true,collectPropagation:false});
  const ms=steady.latencies.filter(x=>Number.isFinite(x)&&x>=0);
  if (ms.length<500) throw Error(`insufficient_propagation_samples:${targetSeconds}:${ms.length}`);
  const p50=quantile(ms,.5),p95=quantile(ms,.95),avg=mean(ms);
  return {
    targetSeconds,
    nodeCount:3,
    regionCount:3,
    propagationSamples:ms.length,
    payloadPolicyId:PAYLOAD_POLICY_ID,
    nominalTps:txPerBlock/targetSeconds,
    propagationSeconds:{median:p50/1000,mean:avg/1000,p95:p95/1000},
    steady:{blocks:steady.blocks,staleBlocks:steady.staleBlocks},
    stress:{blocks:stress.blocks,staleBlocks:stress.staleBlocks},
    shadowDetails:{txPerBlock,txBytes:TX_BYTES,steadyPayloadBytes:txPerBlock*TX_BYTES,stressPayloadBytes:txPerBlock*TX_BYTES*2,steadyPropagationMs:{p50,mean:avg,p95,max:Math.max(...ms)},steadyNodes:steady.statuses,stressNodes:stress.statuses,stressClass:'2x-payload-rotating-origin-serialized-shadow-load',staleEvidenceClass:'real-wan-shadow-controlled-not-natural-poisson-mining'},
  };
}

async function run() {
  if (NODES.length!==3) throw Error('three_nodes_required');
  if (HARNESS_COMMIT && !/^[0-9a-f]{40}$/.test(HARNESS_COMMIT)) throw Error('bad_render_git_commit');
  await waitReady();
  const measurements={};
  for (const targetSeconds of TARGETS) {
    result={...result,status:`running-${targetSeconds}`,currentTarget:targetSeconds};
    measurements[targetSeconds]=await runTarget(targetSeconds);
    console.log(JSON.stringify({event:'FAE_BLOCK_TIME_V2_TARGET_COMPLETE',measurement:measurements[targetSeconds]}));
  }
  const commit=HARNESS_COMMIT || '0000000000000000000000000000000000000000';
  const pair600={schema:'fae-economic-block-time-v2-measurement/1',harnessCommit:commit,environmentId:ENVIRONMENT_ID,baseline:measurements[300],candidate:measurements[600]};
  const pair900={schema:'fae-economic-block-time-v2-measurement/1',harnessCommit:commit,environmentId:ENVIRONMENT_ID,baseline:measurements[300],candidate:measurements[900]};
  const evaluation600=evaluatePair(pair600),evaluation900=evaluatePair(pair900);
  result={ok:true,status:'COMPLETE',format:'FAE_BLOCK_TIME_V2_REAL_WAN_V1',startedAt:result.startedAt,finishedAt:new Date().toISOString(),authority:'research-only-no-consensus-authority',harnessCommit:commit,environmentId:ENVIRONMENT_ID,nodes:NODES,payloadPolicyId:PAYLOAD_POLICY_ID,measurements,pairs:{candidate600:{bundle:pair600,evaluation:evaluation600},candidate900:{bundle:pair900,evaluation:evaluation900}},interpretationBoundary:'This is real-WAN shadow propagation plus controlled shadow stale evidence. It is not natural public-testnet stale-rate evidence and cannot select or activate a candidate. L3 remains mandatory before any activation.'};
  console.log(JSON.stringify({event:'FAE_BLOCK_TIME_V2_WAN_COMPLETE',result}));
}

run().catch(async e=>{
  result={...result,ok:false,status:'FAIL',finishedAt:new Date().toISOString(),error:e.message};
  console.error(JSON.stringify({event:'FAE_BLOCK_TIME_V2_WAN_FAILED',result}));
});

http.createServer((req,res)=>{
  res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});
  res.end(JSON.stringify(req.url==='/result'?result:{ok:true,status:result.status,currentTarget:result.currentTarget||null}));
}).listen(PORT,'0.0.0.0',()=>console.log(`FAE block-time v2 WAN controller listening ${PORT}`));
