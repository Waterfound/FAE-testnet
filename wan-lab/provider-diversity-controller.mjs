#!/usr/bin/env node
import http from 'node:http';

const PORT=Number(process.env.PORT||3202);
const TOKEN=process.env.FAE_LAB_TOKEN||'local-test-token';
const NODES=[
  {id:'A',provider:'render',url:process.env.FAE_NODE_A},
  {id:'B',provider:'render',url:process.env.FAE_NODE_B},
  {id:'C',provider:'render',url:process.env.FAE_NODE_C},
  {id:'D',provider:'supabase',url:process.env.FAE_NODE_D},
].filter(x=>x.url).map(x=>({...x,url:x.url.replace(/\/$/,''));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let result={ok:false,status:'warming',format:'FAE_PROVIDER_DIVERSITY_GATE_V1',startedAt:new Date().toISOString(),nodes:NODES};
async function req(base,path,method='GET',payload=null,timeout=12000){const c=new AbortController();const t=setTimeout(()=>c.abort(),timeout);try{const r=await fetch(base+path,{method,signal:c.signal,headers:{'content-type':'application/json','x-fae-lab-token':TOKEN},body:payload?JSON.stringify(payload):undefined});const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(`${r.status}:${j.error||r.statusText}`);return j}finally{clearTimeout(t)}}
const post=(u,p,b={})=>req(u,p,'POST',b);
function pct(xs,q){if(!xs.length)return null;const s=[...xs].sort((a,b)=>a-b);return s[Math.floor((s.length-1)*q)]}
async function ready(){for(let i=0;i<90;i++){const s=await Promise.allSettled(NODES.map(n=>req(n.url,'/status')));if(s.every(x=>x.status==='fulfilled'))return s.map(x=>x.value);await sleep(2000)}throw Error('nodes_not_ready')}
async function statuses(){return await Promise.all(NODES.map(n=>req(n.url,'/status')))}
async function waitConverged(timeout=30000){const start=Date.now();let last;while(Date.now()-start<timeout){last=await statuses();if(last.every(x=>x.tipHash===last[0].tipHash&&x.height===last[0].height))return last;await sleep(350)}throw Error('convergence_timeout:'+JSON.stringify(last))}
async function events(hash){const e=await Promise.all(NODES.map(n=>req(n.url,'/events?limit=500')));return e.map(x=>x.events.find(v=>v.hash===hash)||null)}
async function configureFullMesh(){await Promise.all(NODES.map((n,i)=>post(n.url,'/control/peers',{peers:NODES.filter((_,j)=>j!==i).map(x=>x.url)})))}
async function setBlocked(i,j,blocked){await post(NODES[i].url,'/control/peer-block',{peer:NODES[j].url,blocked})}
async function syncAll(){await Promise.allSettled(NODES.map(n=>post(n.url,'/control/sync')))}
async function run(){
 if(NODES.length!==4)throw Error('four_nodes_required');
 await ready();
 await Promise.all(NODES.map(n=>post(n.url,'/control/reset')));
 await configureFullMesh();
 await sleep(1500);
 const samples=[]; const sequence=[0,3,1,3,2,3,0,1,3,2,0,3,1,2,3,0];
 for(let i=0;i<sequence.length;i++){
   const origin=sequence[i], mined=await post(NODES[origin].url,'/control/mine',{nonce:`provider-${i}`});
   await waitConverged(); await sleep(250);
   const ev=await events(mined.block.hash); const t0=ev[origin]?.firstSeenMs;
   for(let j=0;j<NODES.length;j++) if(j!==origin&&t0&&ev[j]) samples.push({from:NODES[origin].id,to:NODES[j].id,fromProvider:NODES[origin].provider,toProvider:NODES[j].provider,ms:ev[j].firstSeenMs-t0,hash:mined.block.hash});
 }
 const parent=(await req(NODES[0].url,'/status')).tipHash;
 const [fa,fd]=await Promise.all([
   post(NODES[0].url,'/control/mine',{parent,nonce:'cross-fork-render'}),
   post(NODES[3].url,'/control/mine',{parent,nonce:'cross-fork-supabase'})
 ]);
 await sleep(1800);await syncAll();const first=await waitConverged();const winner=first[0].tipHash;const losing=winner===fa.block.hash?fd.block.hash:fa.block.hash;const loserIndex=winner===fa.block.hash?3:0;
 const ext=await post(NODES[loserIndex].url,'/control/mine',{parent:losing,nonce:'cross-provider-reorg'});
 await sleep(1800);await syncAll();const reorg=await waitConverged();
 for(let i=0;i<3;i++)for(let j=i+1;j<4;j++){if(i===3||j===3){await setBlocked(i,j,true);await setBlocked(j,i,true)}}
 for(let i=0;i<3;i++){await post(NODES[0].url,'/control/mine',{nonce:`render-part-${i}`});await sleep(200)}
 for(let i=0;i<2;i++){await post(NODES[3].url,'/control/mine',{nonce:`supabase-part-${i}`});await sleep(200)}
 const during=await statuses();
 for(let i=0;i<3;i++){await setBlocked(i,3,false);await setBlocked(3,i,false)}
 await syncAll();const healed=await waitConverged(45000);
 const cross=samples.filter(x=>x.fromProvider!==x.toProvider).map(x=>x.ms).filter(x=>x>=0);
 const render=samples.filter(x=>x.fromProvider==='render'&&x.toProvider==='render').map(x=>x.ms).filter(x=>x>=0);
 const all=samples.map(x=>x.ms).filter(x=>x>=0);
 const metrics=xs=>({samples:xs.length,p50Ms:pct(xs,.5),meanMs:xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null,p95Ms:pct(xs,.95),maxMs:xs.length?Math.max(...xs):null});
 const final=await statuses();
 const pass=healed.every(x=>x.tipHash===healed[0].tipHash)&&reorg.every(x=>x.tipHash===reorg[0].tipHash)&&pct(cross,.95)<5000;
 result={ok:pass,status:pass?'PASS':'FAIL',format:'FAE_PROVIDER_DIVERSITY_GATE_V1',startedAt:result.startedAt,finishedAt:new Date().toISOString(),topology:NODES.map(x=>({id:x.id,provider:x.provider,url:x.url})),propagation:{all:metrics(all),crossProvider:metrics(cross),withinRender:metrics(render)},fork:{parent,renderBlock:fa.block.hash,supabaseBlock:fd.block.hash,initialWinner:winner,forcedExtension:ext.block.hash,convergedTip:reorg[0].tipHash,reorgCounts:reorg.map(x=>x.reorgCount),staleBlocks:reorg.map(x=>x.staleBlocks)},providerPartition:{during:during.map((x,i)=>({id:NODES[i].id,provider:NODES[i].provider,height:x.height,tipHash:x.tipHash})),after:healed.map((x,i)=>({id:NODES[i].id,provider:NODES[i].provider,height:x.height,tipHash:x.tipHash,reorgCount:x.reorgCount,staleBlocks:x.staleBlocks}))},final:final.map((x,i)=>({id:NODES[i].id,provider:NODES[i].provider,height:x.height,tipHash:x.tipHash,reorgCount:x.reorgCount,staleBlocks:x.staleBlocks})),notes:['Render and Supabase are distinct hosting/control-plane providers in this run.','Underlying hyperscaler/network-path independence is not asserted.','Nodes remain project-operated; independent human-operator diversity is a separate gate.']};
 console.log(JSON.stringify({event:'FAE_PROVIDER_DIVERSITY_RESULT',report:result}));
}
run().catch(e=>{result={...result,ok:false,status:'FAIL',finishedAt:new Date().toISOString(),error:e.message};console.error(JSON.stringify({event:'FAE_PROVIDER_DIVERSITY_FAILED',report:result}))});
http.createServer((req,res)=>{res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(req.url==='/result'?result:{ok:true,status:result.status}))}).listen(PORT,'0.0.0.0',()=>console.log(`FAE provider diversity controller listening ${PORT}`));
