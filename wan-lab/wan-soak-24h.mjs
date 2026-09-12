#!/usr/bin/env node
import http from 'node:http';

const PORT=Number(process.env.PORT||3201);
const TOKEN=process.env.FAE_LAB_TOKEN||'local-test-token';
const NODES=[process.env.FAE_NODE_A,process.env.FAE_NODE_B,process.env.FAE_NODE_C].filter(Boolean).map(x=>x.replace(/\/$/,''));
const SELF=(process.env.FAE_PUBLIC_URL||'').replace(/\/$/,'');
const TARGET_MS=Number(process.env.FAE_TARGET_SECONDS||300)*1000;
const HALF_LIFE_MS=Number(process.env.FAE_DAA_HALF_LIFE_MINUTES||30)*60*1000;
const DURATION_MS=Number(process.env.FAE_SOAK_HOURS||24)*3600*1000;
const BASE_BITS=18;
const Q16=65536;
let report={ok:true,status:'starting',format:'FAE_WAN_SOAK_24H_V1',startedAt:new Date().toISOString(),targetSeconds:TARGET_MS/1000,daaHalfLifeMinutes:HALF_LIFE_MS/60000,nodes:NODES,blocks:0,phase:null};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function req(base,path,method='GET',payload=null,timeout=10000){const c=new AbortController();const t=setTimeout(()=>c.abort(),timeout);try{const r=await fetch(base+path,{method,signal:c.signal,headers:{'content-type':'application/json','x-fae-lab-token':TOKEN},body:payload?JSON.stringify(payload):undefined});const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(`${r.status}:${j.error||r.statusText}`);return j}finally{clearTimeout(t)}}
const post=(u,p,b={})=>req(u,p,'POST',b);
function phaseFor(elapsed){const h=elapsed/3600000;if(h<6)return{name:'baseline',hashFactor:1.0,weights:[0.40,0.35,0.25]};if(h<12)return{name:'hash-exit',hashFactor:0.20,weights:[0.60,0.25,0.15]};if(h<18)return{name:'hash-surge',hashFactor:1.80,weights:[0.25,0.45,0.30]};return{name:'recovery',hashFactor:1.0,weights:[0.34,0.33,0.33]}}
function seeded(seed=0x5fae300){let x=seed>>>0;return()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return(x>>>0)/4294967296}}
const rnd=seeded();
function expMs(mean){return Math.max(1,Math.round(-Math.log(Math.max(1e-12,1-rnd()))*mean))}
function choose(weights){const u=rnd();let a=0;for(let i=0;i<weights.length;i++){a+=weights[i];if(u<=a)return i}return weights.length-1}
function daaBits(height,elapsedMs){const ideal=height*TARGET_MS;const err=ideal-elapsedMs;return BASE_BITS+(err/HALF_LIFE_MS)}
function expectedInterval(bits,hashFactor){return TARGET_MS*(2**(bits-BASE_BITS))/hashFactor}
async function statuses(){return await Promise.all(NODES.map(n=>req(n,'/status')))}
async function ensurePeers(){await Promise.all(NODES.map((n,i)=>post(n,'/control/peers',{peers:NODES.filter((_,j)=>j!==i)}))}
async function eventSeen(hash,originIndex){await sleep(1200);const ev=await Promise.all(NODES.map(n=>req(n,'/events?limit=500')));const rows=ev.map(x=>x.events.find(e=>e.hash===hash)||null);const origin=rows[originIndex]?.firstSeenMs;return rows.map((r,i)=>({node:i,ms:origin&&r?r.firstSeenMs-origin:null}))}
function pct(xs,q){if(!xs.length)return null;const s=[...xs].sort((a,b)=>a-b);return s[Math.floor((s.length-1)*q)]}
const propagation=[];
async function main(){
 if(NODES.length!==3)throw Error('three_nodes_required');
 await ensurePeers();
 const baseline=await statuses();report.baseline=baseline.map(x=>({nodeId:x.nodeId,height:x.height,tipHash:x.tipHash,staleBlocks:x.staleBlocks,reorgCount:x.reorgCount}));
 const start=Date.now();let h=0;
 report.status='running';
 while(Date.now()-start<DURATION_MS){
   const elapsed=Date.now()-start;const phase=phaseFor(elapsed);report.phase=phase.name;
   const bits=daaBits(h,elapsed);const mean=expectedInterval(bits,phase.hashFactor);const wait=Math.min(expMs(mean),15*60*1000);
   report.shadow={height:h,bits,hashFactor:phase.hashFactor,expectedIntervalSec:mean/1000,nextDelaySec:wait/1000};
   await sleep(wait);
   const idx=choose(phase.weights);const mined=await post(NODES[idx],'/control/mine',{nonce:`soak-${h}-${Date.now()}`});h++;report.blocks=h;
   try{const seen=await eventSeen(mined.block.hash,idx);for(const x of seen)if(x.node!==idx&&Number.isFinite(x.ms)&&x.ms>=0)propagation.push(x.ms)}catch{}
   if(h%10===0){const s=await statuses();const p95=pct(propagation,.95);report.checkpoint={at:new Date().toISOString(),blocks:h,phase:phase.name,heights:s.map(x=>x.height),tips:s.map(x=>x.tipHash),stale:s.map(x=>x.staleBlocks),reorg:s.map(x=>x.reorgCount),propagationSamples:propagation.length,p50Ms:pct(propagation,.5),p95Ms:p95,maxMs:propagation.length?Math.max(...propagation):null};console.log(JSON.stringify({event:'FAE_WAN_SOAK_CHECKPOINT',report:report.checkpoint}));}
 }
 const final=await statuses();const baseStale=report.baseline.map(x=>x.staleBlocks);const deltaStale=final.map((x,i)=>x.staleBlocks-baseStale[i]);const ms=propagation;
 report={...report,status:'complete',finishedAt:new Date().toISOString(),final:final.map((x,i)=>({nodeId:x.nodeId,height:x.height,tipHash:x.tipHash,staleBlocks:x.staleBlocks,deltaStale:deltaStale[i],reorgCount:x.reorgCount})),propagation:{samples:ms.length,p50Ms:pct(ms,.5),meanMs:ms.length?ms.reduce((a,b)=>a+b,0)/ms.length:null,p95Ms:pct(ms,.95),maxMs:ms.length?Math.max(...ms):null},naturalStaleDeltaMax:Math.max(...deltaStale)};console.log(JSON.stringify({event:'FAE_WAN_SOAK_COMPLETE',report}));
}
main().catch(e=>{report={...report,ok:false,status:'failed',finishedAt:new Date().toISOString(),error:e.message};console.error(JSON.stringify({event:'FAE_WAN_SOAK_FAILED',report}))});
if(SELF)setInterval(()=>fetch(SELF+'/status').catch(()=>{}),5*60*1000).unref();
http.createServer((req,res)=>{res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(req.url==='/result'?report:{ok:true,status:report.status,blocks:report.blocks,phase:report.phase,shadow:report.shadow,checkpoint:report.checkpoint||null}))}).listen(PORT,'0.0.0.0',()=>console.log(`FAE WAN soak listening ${PORT}`));
