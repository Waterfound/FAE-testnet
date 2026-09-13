#!/usr/bin/env node
import http from 'node:http';

const PORT=Number(process.env.PORT||3203);
const TOKEN=process.env.FAE_LAB_TOKEN||'local-test-token';
const NODES=[
  {id:'A',url:process.env.FAE_NODE_A},
  {id:'B',url:process.env.FAE_NODE_B},
  {id:'C',url:process.env.FAE_NODE_C},
].filter(x=>x.url).map(x=>({...x,url:x.url.replace(/\/$/, '')}));
const SELF=(process.env.FAE_PUBLIC_URL||'').replace(/\/$/, '');
const TARGET_MS=Number(process.env.FAE_TARGET_SECONDS||300)*1000;
const HALF_LIFE_MS=Number(process.env.FAE_DAA_HALF_LIFE_MINUTES||30)*60*1000;
const DURATION_MS=Number(process.env.FAE_SOAK_HOURS||96)*3600*1000;
const REQUEST_TIMEOUT_MS=Number(process.env.FAE_REQUEST_TIMEOUT_SECONDS||12)*1000;
const REQUEST_ATTEMPTS=Math.max(1,Number(process.env.FAE_REQUEST_ATTEMPTS||4));
const MAX_TRANSIENT_MS=Number(process.env.FAE_MAX_TRANSIENT_OUTAGE_SECONDS||180)*1000;
const BASE_BITS=18;
const PHASE_MS=24*3600*1000;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let report={ok:true,status:'starting',format:'FAE_STABILITY_SOAK_V2',startedAt:new Date().toISOString(),targetSeconds:TARGET_MS/1000,daaHalfLifeMinutes:HALF_LIFE_MS/60000,durationHours:DURATION_MS/3600000,nodes:NODES,transientPolicy:{requestAttempts:REQUEST_ATTEMPTS,requestTimeoutSeconds:REQUEST_TIMEOUT_MS/1000,maxTransientOutageSeconds:MAX_TRANSIENT_MS/1000}};

async function req(base,path,method='GET',payload=null,timeout=REQUEST_TIMEOUT_MS){
  let lastError;
  for(let attempt=1;attempt<=REQUEST_ATTEMPTS;attempt++){
    const c=new AbortController();const t=setTimeout(()=>c.abort(),timeout);
    try{
      const r=await fetch(base+path,{method,signal:c.signal,headers:{'content-type':'application/json','x-fae-lab-token':TOKEN},body:payload?JSON.stringify(payload):undefined});
      const j=await r.json().catch(()=>({}));
      if(!r.ok)throw Error(`${r.status}:${j.error||r.statusText}`);
      return j;
    }catch(error){
      lastError=error;
      if(attempt<REQUEST_ATTEMPTS)await sleep(Math.min(5000,500*attempt));
    }finally{clearTimeout(t)}
  }
  throw lastError||Error('request_failed');
}
const post=(u,p,b={})=>req(u,p,'POST',b);
function clamp(x,a,b){return Math.max(a,Math.min(b,x))}
function pct(xs,q){if(!xs.length)return null;const s=[...xs].sort((a,b)=>a-b);return s[Math.floor((s.length-1)*q)]}
function wilsonUpper(k,n,z=1.645){if(!n)return 1;const p=k/n,z2=z*z,d=1+z2/n,c=p+z2/(2*n),m=z*Math.sqrt((p*(1-p)/n)+(z2/(4*n*n)));return (c+m)/d}
function normalize(xs){const s=xs.reduce((a,b)=>a+b,0);return xs.map(x=>x/s)}
function phaseFor(elapsed){
  if(elapsed<PHASE_MS)return{name:'baseline',hashFactor:1.0,shares:[0.45,0.35,0.20]};
  if(elapsed<2*PHASE_MS)return{name:'hash-loss-80pct',hashFactor:0.20,shares:[0.55,0.30,0.15]};
  if(elapsed<3*PHASE_MS)return{name:'hash-surge-80pct',hashFactor:1.80,shares:[0.30,0.45,0.25]};
  const x=((elapsed-3*PHASE_MS)%PHASE_MS)/PHASE_MS*2*Math.PI;
  const f=clamp(1+0.8*Math.sin(x),0.2,1.8);
  const raw=[0.55+0.30*Math.sin(x),0.55+0.30*Math.sin(x+2*Math.PI/3),0.55+0.30*Math.sin(x+4*Math.PI/3)];
  return{name:'browser-cycle',hashFactor:f,shares:normalize(raw)};
}
function daaBits(height,parentTimestamp,anchorHeight,anchorTimestamp){const ideal=(height-anchorHeight)*TARGET_MS;const actual=parentTimestamp-anchorTimestamp;return clamp(BASE_BITS+(ideal-actual)/HALF_LIFE_MS,4,56)}
function expectedNetworkMean(bits,hashFactor){return TARGET_MS*(2**(bits-BASE_BITS))/hashFactor}
async function statuses(){return await Promise.all(NODES.map(n=>req(n.url,'/status')))}
async function configure(){await Promise.all(NODES.map((n,i)=>post(n.url,'/control/peers',{peers:NODES.filter((_,j)=>j!==i).map(x=>x.url)})))}
async function disableAuto(){await Promise.allSettled(NODES.map(n=>post(n.url,'/control/auto-produce',{enabled:false})))}
async function syncAll(){await Promise.allSettled(NODES.map(n=>post(n.url,'/control/sync')))}
function converged(s){return s.length===NODES.length&&s.every(x=>x.tipHash===s[0].tipHash&&x.height===s[0].height)}
async function waitReady(){for(let i=0;i<120;i++){const s=await Promise.allSettled(NODES.map(n=>req(n.url,'/status')));if(s.every(x=>x.status==='fulfilled'))return s.map(x=>x.value);await sleep(2000)}throw Error('nodes_not_ready')}
async function waitConverged(timeout=45000){const start=Date.now();let last;while(Date.now()-start<timeout){try{last=await statuses();if(converged(last))return last}catch{}await syncAll();await sleep(800)}throw Error('convergence_timeout:'+JSON.stringify(last))}
async function propagationMetrics(){
  const all=await Promise.all(NODES.map(n=>req(n.url,'/events?limit=2000')));
  const maps=all.map(x=>new Map((x.events||[]).map(e=>[e.hash,e])));
  const hashes=new Set(all.flatMap(x=>(x.events||[]).map(e=>e.hash)));
  const deltas=[];
  for(const h of hashes){const ev=maps.map(m=>m.get(h)||null);const origin=ev.find(e=>e&&NODES.some(n=>n.id===e.origin));if(!origin)continue;const oi=NODES.findIndex(n=>n.id===origin.origin);const t0=oi>=0?ev[oi]?.firstSeenMs:null;if(!Number.isFinite(t0))continue;for(let i=0;i<ev.length;i++)if(i!==oi&&Number.isFinite(ev[i]?.firstSeenMs)){const d=ev[i].firstSeenMs-t0;if(d>=0)deltas.push(d)}}
  return{samples:deltas.length,p50Ms:pct(deltas,.5),meanMs:deltas.length?deltas.reduce((a,b)=>a+b,0)/deltas.length:null,p95Ms:pct(deltas,.95),maxMs:deltas.length?Math.max(...deltas):null};
}

async function run(){
  if(NODES.length!==3)throw Error('three_nodes_required');
  await waitReady();
  await disableAuto();
  await Promise.all(NODES.map(n=>post(n.url,'/control/reset')));
  await configure();
  await sleep(2000);
  const anchorTimestamp=Date.now(),anchorHeight=0,start=anchorTimestamp;
  let lastTip='';let lastHeight=0;let lastPhaseKey='';let lastCheckpoint=0;let lastCanonicalTimestamp=anchorTimestamp;let maxCanonicalGapMs=0;
  let lossRecoveryStart=null,lossRecoveryUnder2x=null,surgeMinExpectedMs=Infinity;
  let transientSince=null,transientEvents=0,maxTransientOutageMs=0,lastTransientError=null;
  report={...report,status:'running',anchorTimestamp,anchorHeight,phase:'baseline',reliability:{transientEvents:0,maxTransientOutageSec:0,lastTransientError:null}};

  while(Date.now()-start<DURATION_MS){
    const elapsed=Date.now()-start;
    try{
      let s=await statuses();
      if(!converged(s)){await syncAll();s=await waitConverged();}
      const snap=(await req(NODES[0].url,'/snapshot')).chain||[];
      const tipBlock=snap.at(-1);
      const parentTimestamp=tipBlock?.height?Number(tipBlock.createdAtMs):anchorTimestamp;
      if(tipBlock?.height&&tipBlock.hash!==lastTip){
        const gap=Math.max(0,parentTimestamp-lastCanonicalTimestamp);if(lastHeight>0)maxCanonicalGapMs=Math.max(maxCanonicalGapMs,gap);lastCanonicalTimestamp=parentTimestamp;lastTip=tipBlock.hash;lastHeight=Number(tipBlock.height);
      }
      const ph=phaseFor(elapsed);
      const phaseKey=ph.name==='browser-cycle'?`${ph.name}:${Math.floor(elapsed/(5*60*1000))}`:ph.name;
      const bits=daaBits(Number(s[0].height),parentTimestamp,anchorHeight,anchorTimestamp);
      const aggregateMean=expectedNetworkMean(bits,ph.hashFactor);
      if(ph.name==='hash-loss-80pct'&&lossRecoveryStart===null)lossRecoveryStart=Date.now();
      if(ph.name==='hash-loss-80pct'&&lossRecoveryStart!==null&&lossRecoveryUnder2x===null&&aggregateMean<=2*TARGET_MS)lossRecoveryUnder2x=Date.now();
      if(ph.name==='hash-surge-80pct')surgeMinExpectedMs=Math.min(surgeMinExpectedMs,aggregateMean);
      const shouldApply=(tipBlock?.hash!==report.lastAppliedTip)||phaseKey!==lastPhaseKey;
      if(shouldApply){
        const means=ph.shares.map(sh=>aggregateMean/sh);
        await Promise.all(NODES.map((n,i)=>post(n.url,'/control/auto-produce',{enabled:true,meanMs:Math.max(100,means[i])})));
        report.lastAppliedTip=tipBlock?.hash||s[0].tipHash;lastPhaseKey=phaseKey;
        report.shadow={phase:ph.name,hashFactor:ph.hashFactor,shares:ph.shares,difficultyBits:bits,aggregateExpectedIntervalSec:aggregateMean/1000,nodeMeanIntervalsSec:means.map(x=>x/1000)};
      }
      if(elapsed-lastCheckpoint>=30*60*1000||lastCheckpoint===0){
        lastCheckpoint=elapsed;
        const pm=await propagationMetrics();const stale=Math.max(...s.map(x=>Number(x.staleBlocks||0))),height=Math.max(...s.map(x=>Number(x.height||0))),n=height+stale,rate=n?stale/n:0,upper=wilsonUpper(stale,n);
        report.checkpoint={at:new Date().toISOString(),elapsedHours:elapsed/3600000,phase:ph.name,height,tip:s[0].tipHash,staleBlocks:stale,naturalStaleRate:rate,wilsonUpper95:upper,reorgCounts:s.map(x=>x.reorgCount),propagation:pm,maxCanonicalGapSec:maxCanonicalGapMs/1000,lossRecoveryToUnder2xHours:lossRecoveryStart&&lossRecoveryUnder2x?(lossRecoveryUnder2x-lossRecoveryStart)/3600000:null,surgeMinExpectedSec:Number.isFinite(surgeMinExpectedMs)?surgeMinExpectedMs/1000:null,reliability:{transientEvents,maxTransientOutageSec:maxTransientOutageMs/1000,lastTransientError}};
        console.log(JSON.stringify({event:'FAE_STABILITY_SOAK_CHECKPOINT',report:report.checkpoint}));
      }
      if(transientSince!==null){
        const recoveredMs=Date.now()-transientSince;maxTransientOutageMs=Math.max(maxTransientOutageMs,recoveredMs);
        console.warn(JSON.stringify({event:'FAE_STABILITY_SOAK_TRANSIENT_RECOVERED',outageSeconds:recoveredMs/1000,error:lastTransientError}));
        transientSince=null;
      }
      report.reliability={transientEvents,maxTransientOutageSec:maxTransientOutageMs/1000,lastTransientError};
      await sleep(2000);
    }catch(error){
      lastTransientError=String(error?.message||error);
      if(transientSince===null){transientSince=Date.now();transientEvents+=1;console.warn(JSON.stringify({event:'FAE_STABILITY_SOAK_TRANSIENT_START',at:new Date().toISOString(),error:lastTransientError,transientEvents}))}
      const outageMs=Date.now()-transientSince;maxTransientOutageMs=Math.max(maxTransientOutageMs,outageMs);
      report.reliability={transientEvents,maxTransientOutageSec:maxTransientOutageMs/1000,lastTransientError};
      if(outageMs>MAX_TRANSIENT_MS)throw Error(`transient_outage_exceeded:${Math.round(outageMs/1000)}s:${lastTransientError}`);
      await syncAll();
      await sleep(5000);
    }
  }

  if(transientSince!==null)throw Error(`soak_finished_during_transient_outage:${lastTransientError}`);
  await disableAuto();await syncAll();const final=await waitConverged();const pm=await propagationMetrics();const stale=Math.max(...final.map(x=>Number(x.staleBlocks||0))),height=Math.max(...final.map(x=>Number(x.height||0))),n=height+stale,rate=n?stale/n:0,upper=wilsonUpper(stale,n);
  const reliability={transientEvents,maxTransientOutageSec:maxTransientOutageMs/1000,lastTransientError};
  const pass=converged(final)&&pm.p95Ms<5000&&rate<0.01&&upper<0.01&&maxTransientOutageMs<=MAX_TRANSIENT_MS;
  report={...report,ok:pass,status:pass?'PASS':'FAIL',finishedAt:new Date().toISOString(),final:final.map((x,i)=>({id:NODES[i].id,height:x.height,tipHash:x.tipHash,staleBlocks:x.staleBlocks,reorgCount:x.reorgCount,produced:x.autoProduce?.produced||0})),propagation:pm,naturalStale:{staleBlocks:stale,canonicalHeight:height,totalDiscovered:n,observedRate:rate,wilsonUpper95:upper},liveness:{lossRecoveryToUnder2xHours:lossRecoveryStart&&lossRecoveryUnder2x?(lossRecoveryUnder2x-lossRecoveryStart)/3600000:null,surgeMinExpectedSec:Number.isFinite(surgeMinExpectedMs)?surgeMinExpectedMs/1000:null,maxCanonicalGapSec:maxCanonicalGapMs/1000},reliability,notes:['Independent stochastic block clocks run inside each regional node, producing natural timing races over the real WAN path.','Short transport/service interruptions are retried and recorded; any continuous outage above the configured bound fails the soak.','The 30-minute DAA remains shadow-controlled by the soak coordinator; these lab blocks are not active FAE consensus blocks and do not perform production PoW.','Pass requires convergence, P95 propagation under 5 s, observed stale rate under 1%, one-sided Wilson 95% upper bound under 1%, and no unrecovered or over-bound transient outage.']};
  console.log(JSON.stringify({event:'FAE_STABILITY_SOAK_COMPLETE',report}));
}
run().catch(async e=>{await disableAuto();report={...report,ok:false,status:'FAIL',finishedAt:new Date().toISOString(),error:e.message};console.error(JSON.stringify({event:'FAE_STABILITY_SOAK_FAILED',report}))});
if(SELF)setInterval(()=>fetch(SELF+'/status').catch(()=>{}),5*60*1000).unref();
http.createServer((req,res)=>{res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(req.url==='/result'?report:{ok:true,status:report.status,checkpoint:report.checkpoint||null,shadow:report.shadow||null,reliability:report.reliability||null}))}).listen(PORT,'0.0.0.0',()=>console.log(`FAE stability soak listening ${PORT}`));
