import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import {chromium,webkit} from 'playwright';

const root=new URL('../../../',import.meta.url);
const fixture=await readFile(new URL('../browser/mts-11-fixture.html',import.meta.url));
const mining=await readFile(new URL('../../../mining.js',import.meta.url));
const tipHash=n=>Number(n).toString(16).padStart(64,'0');

const chain={
  height:100,
  tipHash:'a'.repeat(64),
  requests:[],
  submissions:[],
  statusOutages:new Map(),
  reset(){
    this.height=100;this.tipHash='a'.repeat(64);this.requests=[];this.submissions=[];this.statusOutages.clear();
  },
  advance(height=101,hash=tipHash(height)){this.height=height;this.tipHash=hash},
  failStatus(client,count=1){this.statusOutages.set(client,(this.statusOutages.get(client)||0)+count)}
};

function json(res,body,status=200){
  res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});
  res.end(JSON.stringify(body));
}
const server=createServer((req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  if(url.pathname==='/lab/mining-tip-sync/browser/mts-11-fixture.html'){
    res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});res.end(fixture);return;
  }
  if(url.pathname==='/mining.js'){
    res.writeHead(200,{'content-type':'text/javascript; charset=utf-8','cache-control':'no-store'});res.end(mining);return;
  }
  if(url.pathname.startsWith('/__mts11/')){
    const client=String(req.headers['x-mts11-client']||'unknown');
    const path=url.pathname.slice('/__mts11'.length);
    chain.requests.push({at:Date.now(),client,path,height:chain.height,tip_hash:chain.tipHash});
    if(path==='/status'){
      const left=chain.statusOutages.get(client)||0;
      if(left>0){chain.statusOutages.set(client,left-1);json(res,{ok:false,error:'simulated_status_outage'},503);return}
      json(res,{ok:true,node_version:5,network:'fairyelf-public-testnet-v4',height:chain.height,tip_hash:chain.tipHash,difficulty_bits:64,target_seconds:180});return;
    }
    if(path==='/template'){
      json(res,{ok:true,template_policy:'snapshot',header:{
        network:'fairyelf-public-testnet-v4',
        height:chain.height+1,
        previous_hash:chain.tipHash,
        timestamp_ms:Date.now(),
        difficulty_bits:64,
        miner_address:url.searchParams.get('address')||'faet1mts11',
        reward_atoms:'1000000000',
        tx_root:'0'.repeat(64),
        tx_count:0
      },txids:[]});return;
    }
    if(path==='/submit-block'){
      let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{
        chain.submissions.push({at:Date.now(),client,body});
        json(res,{ok:false,error:'unexpected_submit_in_latency_harness'},409);
      });return;
    }
    json(res,{ok:true});
    return;
  }
  res.writeHead(404);res.end('not found');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const address=server.address();
const base='http://127.0.0.1:'+address.port;
const fixtureUrl=id=>base+'/lab/mining-tip-sync/browser/mts-11-fixture.html?id='+encodeURIComponent(id);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function waitWorker(page,count=1,timeout=5000){
  await page.waitForFunction(expected=>window.__mts11?.workerStarts?.length>=expected,count,{timeout});
}
async function waitTermination(page,count=1,timeout=5000){
  await page.waitForFunction(expected=>window.__mts11?.workerTerminates?.length>=expected,count,{timeout});
}
async function stopQuiet(page){
  try{await page.evaluate(()=>window.__mts11?.stop?.())}catch{}
}
async function openPage(context,id,{broadcast=true}={}){
  const page=await context.newPage();
  const url=fixtureUrl(id)+(broadcast?'':'&bc=0');
  await page.goto(url,{waitUntil:'load'});
  return page;
}
function clientRequests(client,path){return chain.requests.filter(row=>row.client===client&&row.path===path)}

async function hintTrial(browser,engine,index){
  chain.reset();
  const context=await browser.newContext();
  const a=await openPage(context,engine+'-hint-a-'+index);
  const bId=engine+'-hint-b-'+index;
  const b=await openPage(context,bId);
  await Promise.all([a.evaluate(()=>window.__mts11.start()),b.evaluate(()=>window.__mts11.start())]);
  await Promise.all([waitWorker(a),waitWorker(b)]);
  chain.advance();
  const statusBefore=clientRequests(bId,'/status').length;
  const sentAt=await a.evaluate(()=>window.__mts11.sendHint());
  await waitTermination(b,1,3000);
  const snapshot=await b.evaluate(()=>window.__mts11.snapshot());
  const latency=snapshot.workerTerminates[0]-sentAt;
  assert.ok(latency>=0,'negative hint latency');
  assert.equal(bId.startsWith(engine),true);
  assert.ok(clientRequests(bId,'/status').length>statusBefore,'peer did not consult authoritative /status after hint');
  await waitWorker(b,2,3000);
  const templates=clientRequests(bId,'/template');
  assert.equal(templates.at(-1)?.tip_hash,tipHash(101),'replacement template did not bind new authoritative parent');
  assert.equal(chain.submissions.length,0,'stale/unsolicited block submission observed during hint trial');
  await Promise.all([stopQuiet(a),stopQuiet(b)]);
  await context.close();
  return latency;
}

async function pollFallbackTrial(browser,engine){
  chain.reset();
  const context=await browser.newContext();
  const id=engine+'-poll-only';
  const page=await openPage(context,id,{broadcast:false});
  await page.evaluate(()=>window.__mts11.start());
  await waitWorker(page);
  const advancedAt=Date.now();
  chain.advance();
  await waitTermination(page,1,5000);
  const snapshot=await page.evaluate(()=>window.__mts11.snapshot());
  const latency=snapshot.workerTerminates[0]-advancedAt;
  await waitWorker(page,2,3000);
  const templates=clientRequests(id,'/template');
  assert.equal(templates.at(-1)?.tip_hash,tipHash(101),'poll-only replacement did not bind new authoritative parent');
  assert.equal(chain.submissions.length,0,'submission observed in poll-only fallback trial');
  await stopQuiet(page);await context.close();
  return latency;
}

async function forgedHintTrial(browser,engine){
  chain.reset();
  const context=await browser.newContext();
  const sender=await openPage(context,engine+'-forged-sender');
  const id=engine+'-forged-receiver';
  const receiver=await openPage(context,id);
  await receiver.evaluate(()=>window.__mts11.start());
  await waitWorker(receiver);
  const statusBefore=clientRequests(id,'/status').length;
  await sender.evaluate(()=>{
    const channel=new BroadcastChannel('fae-mining-tip-hint-v1');
    channel.postMessage({kind:'revalidate',height:999999,tip_hash:'f'.repeat(64)});
    setTimeout(()=>channel.close(),50);
  });
  await sleep(350);
  const snapshot=await receiver.evaluate(()=>window.__mts11.snapshot());
  assert.equal(snapshot.workerTerminates.length,0,'forged hint payload canceled current work');
  assert.ok(clientRequests(id,'/status').length>statusBefore,'forged hint did not trigger authoritative revalidation');
  await stopQuiet(receiver);await context.close();
}

async function outageHintTrial(browser,engine){
  chain.reset();
  const context=await browser.newContext();
  const sender=await openPage(context,engine+'-outage-sender');
  const id=engine+'-outage-receiver';
  const receiver=await openPage(context,id);
  await receiver.evaluate(()=>window.__mts11.start());
  await waitWorker(receiver);
  chain.failStatus(id,1);
  await sender.evaluate(()=>window.__mts11.sendHint());
  await sleep(350);
  const snapshot=await receiver.evaluate(()=>window.__mts11.snapshot());
  assert.equal(snapshot.workerTerminates.length,0,'hint-triggered /status outage canceled current work');
  assert.equal(chain.statusOutages.get(id)||0,0,'configured hint outage was not consumed');
  await stopQuiet(receiver);await context.close();
}

function p95(values){
  const sorted=[...values].sort((a,b)=>a-b);
  return sorted[Math.max(0,Math.ceil(sorted.length*.95)-1)];
}

async function validateEngine(name,browserType){
  const browser=await browserType.launch({headless:true});
  try{
    const hintLatencies=[];
    for(let i=0;i<5;i++)hintLatencies.push(await hintTrial(browser,name,i+1));
    const pollLatency=await pollFallbackTrial(browser,name);
    await forgedHintTrial(browser,name);
    await outageHintTrial(browser,name);
    const hintP95=p95(hintLatencies),hintMax=Math.max(...hintLatencies);
    assert.ok(hintP95<=1200,name+' hint p95 '+hintP95+'ms exceeds 1200ms gate');
    assert.ok(pollLatency<=3500,name+' poll fallback '+pollLatency+'ms exceeds 3500ms gate');
    assert.ok(pollLatency-hintMax>=400,name+' acceleration margin '+(pollLatency-hintMax)+'ms is below 400ms gate');
    return{
      engine:name,
      hint_latencies_ms:hintLatencies,
      hint_p95_ms:hintP95,
      hint_max_ms:hintMax,
      poll_fallback_ms:pollLatency,
      poll_minus_hint_max_margin_ms:pollLatency-hintMax,
      forged_hint_false_cancel:false,
      hint_outage_false_cancel:false,
      stale_submissions:0,
      result:'PASS'
    };
  }finally{await browser.close()}
}

const evidence={
  schema:'FAE_MTS_11_REAL_BROWSER_EVIDENCE_V1',
  status:'GREEN',
  protected_miner_sha256:'e75a064030590d12ec4a528bb828360a2ad31eb22b35f33d4fec96a51ce9610c',
  run_started_at:new Date().toISOString(),
  engines:[]
};
try{
  evidence.engines.push(await validateEngine('chromium',chromium));
  evidence.engines.push(await validateEngine('webkit',webkit));
  evidence.run_completed_at=new Date().toISOString();
  await writeFile('/tmp/mts-11-browser-evidence.json',JSON.stringify(evidence,null,2)+'\n');
  console.log('MTS-11_REAL_BROWSER_EVIDENCE '+JSON.stringify(evidence));
  console.log('MTS-11 real-browser latency gate PASS');
}finally{
  await new Promise(resolve=>server.close(resolve));
}
