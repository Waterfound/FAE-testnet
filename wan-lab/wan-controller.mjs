#!/usr/bin/env node
import http from 'node:http';
const PORT=Number(process.env.PORT||3199);
const TOKEN=process.env.FAE_LAB_TOKEN||'local-test-token';
const NODES=[process.env.FAE_NODE_A,process.env.FAE_NODE_B,process.env.FAE_NODE_C].filter(Boolean).map(x=>x.replace(/\/$/,''));
const TARGET_SECONDS=Number(process.env.FAE_TARGET_SECONDS||300);
let result={ok:false,status:'warming',startedAt:new Date().toISOString(),nodes:NODES};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function req(url,path,method='GET',payload=null,timeout=10000){const c=new AbortController();const t=setTimeout(()=>c.abort(),timeout);try{const r=await fetch(url+path,{method,signal:c.signal,headers:{'content-type':'application/json','x-fae-lab-token':TOKEN},body:payload?JSON.stringify(payload):undefined});const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(`${r.status}:${j.error||r.statusText}`);return j;}finally{clearTimeout(t)}}
const post=(u,p,b={})=>req(u,p,'POST',b);
async function waitReady(){for(let i=0;i<90;i++){const s=await Promise.allSettled(NODES.map(n=>req(n,'/status')));if(s.every(x=>x.status==='fulfilled'))return s.map(x=>x.value);await sleep(2000)}throw Error('nodes_not_ready')}
async function waitConverged(timeout=20000){const start=Date.now();let last;while(Date.now()-start<timeout){last=await Promise.all(NODES.map(n=>req(n,'/status')));if(last.every(x=>x.tipHash===last[0].tipHash&&x.height===last[0].height))return last;await sleep(300)}throw Error('convergence_timeout:'+JSON.stringify(last))}
function quantile(xs,q){if(!xs.length)return null;const s=[...xs].sort((a,b)=>a-b);return s[Math.floor((s.length-1)*q)]}
async function eventsFor(hash){const all=await Promise.all(NODES.map(n=>req(n,'/events?limit=500')));return all.map(x=>x.events.find(e=>e.hash===hash)||null)}
async function run(){
 if(NODES.length!==3)throw Error('three_nodes_required');
 await waitReady(); await Promise.all(NODES.map(n=>post(n,'/control/reset'))); await Promise.all(NODES.map((n,i)=>post(n,'/control/peers',{peers:NODES.filter((_,j)=>j!==i)}))); await sleep(2500);
 const baseline=[],latencies=[];
 for(let i=0;i<24;i++){const mined=await post(NODES[0],'/control/mine',{nonce:`baseline-${i}`});baseline.push(mined.block.hash);await waitConverged();const ev=await eventsFor(mined.block.hash),origin=ev[0]?.firstSeenMs;for(let j=1;j<ev.length;j++)if(origin&&ev[j])latencies.push({to:j===1?'B':'C',ms:ev[j].firstSeenMs-origin,hash:mined.block.hash});await sleep(250)}
 const beforeFork=(await req(NODES[0],'/status')).tipHash;
 const [fa,fb]=await Promise.all([post(NODES[0],'/control/mine',{parent:beforeFork,nonce:'fork-A'}),post(NODES[1],'/control/mine',{parent:beforeFork,nonce:'fork-B'})]);
 await sleep(2500);await Promise.all(NODES.map(n=>post(n,'/control/sync')));const forkConverged=await waitConverged();const winner=forkConverged[0].tipHash,losing=winner===fa.block.hash?fb.block.hash:fa.block.hash,losingNode=winner===fa.block.hash?NODES[1]:NODES[0];
 const extension=await post(losingNode,'/control/mine',{parent:losing,nonce:'force-reorg'});await sleep(2500);await Promise.all(NODES.map(n=>post(n,'/control/sync')));const reorgConverged=await waitConverged();
 await Promise.all([post(NODES[0],'/control/peer-block',{peer:NODES[2],blocked:true}),post(NODES[1],'/control/peer-block',{peer:NODES[2],blocked:true}),post(NODES[2],'/control/peer-block',{peer:NODES[0],blocked:true}),post(NODES[2],'/control/peer-block',{peer:NODES[1],blocked:true})]);
 for(let i=0;i<3;i++){await post(NODES[0],'/control/mine',{nonce:`main-${i}`});await sleep(300)}for(let i=0;i<2;i++){await post(NODES[2],'/control/mine',{nonce:`isolated-${i}`});await sleep(300)}
 const partitionState=await Promise.all(NODES.map(n=>req(n,'/status')));
 await Promise.all([post(NODES[0],'/control/peer-block',{peer:NODES[2],blocked:false}),post(NODES[1],'/control/peer-block',{peer:NODES[2],blocked:false}),post(NODES[2],'/control/peer-block',{peer:NODES[0],blocked:false}),post(NODES[2],'/control/peer-block',{peer:NODES[1],blocked:false})]);await Promise.all(NODES.map(n=>post(n,'/control/sync')));const healed=await waitConverged(30000);
 const ms=latencies.map(x=>x.ms).filter(x=>x>=0),p50=quantile(ms,.5),p95=quantile(ms,.95),max=Math.max(...ms),opportunity=d=>1-Math.exp(-(d/1000)/TARGET_SECONDS);
 const pass=healed.every(x=>x.tipHash===healed[0].tipHash)&&reorgConverged.every(x=>x.tipHash===reorgConverged[0].tipHash)&&p95<5000;
 result={ok:pass,status:pass?'PASS':'FAIL',format:'FAE_REAL_WAN_GATE_V1',startedAt:result.startedAt,finishedAt:new Date().toISOString(),targetSeconds:TARGET_SECONDS,nodes:(await Promise.all(NODES.map(n=>req(n,'/status')))).map((s,i)=>({url:NODES[i],nodeId:s.nodeId,region:s.region,height:s.height,tipHash:s.tipHash,reorgCount:s.reorgCount,staleBlocks:s.staleBlocks})),baselineBlocks:baseline.length,propagation:{samples:ms.length,p50Ms:p50,meanMs:ms.reduce((a,b)=>a+b,0)/ms.length,p95Ms:p95,maxMs:max,collisionOpportunityP95:opportunity(p95),collisionOpportunityMax:opportunity(max)},fork:{parent:beforeFork,a:fa.block.hash,b:fb.block.hash,initialWinner:winner,forcedWinningExtension:extension.block.hash,convergedTip:reorgConverged[0].tipHash,reorgCounts:reorgConverged.map(x=>x.reorgCount),staleBlocks:reorgConverged.map(x=>x.staleBlocks)},partition:{during:partitionState.map(x=>({nodeId:x.nodeId,height:x.height,tipHash:x.tipHash})),after:healed.map(x=>({nodeId:x.nodeId,height:x.height,tipHash:x.tipHash,reorgCount:x.reorgCount,staleBlocks:x.staleBlocks}))},notes:['Controlled FAE-owned test nodes only.','Short real-WAN propagation/reorg gate; not a 30-day natural stale-rate soak.','Single hosting provider in this run; provider-diversity gate remains separate.']}
}
run().catch(e=>{result={...result,ok:false,status:'FAIL',finishedAt:new Date().toISOString(),error:e.message};console.error(e)});
http.createServer((req,res)=>{res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(req.url==='/result'?result:{ok:true,status:result.status}))}).listen(PORT,'0.0.0.0',()=>console.log(`FAE WAN controller listening ${PORT}`));
