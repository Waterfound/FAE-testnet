import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {chromium,webkit} from 'playwright';

const html=await readFile(new URL('../mts-12-ipad-acceptance.html',import.meta.url));
const mining=await readFile(new URL('../../../mining.js',import.meta.url));
const expected='e75a064030590d12ec4a528bb828360a2ad31eb22b35f33d4fec96a51ce9610c';

const server=createServer((req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  if(url.pathname==='/lab/mining-tip-sync/mts-12-ipad-acceptance.html'){
    res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});res.end(html);return;
  }
  if(url.pathname==='/mining.js'){
    res.writeHead(200,{'content-type':'text/javascript; charset=utf-8','cache-control':'no-store'});res.end(mining);return;
  }
  res.writeHead(404);res.end('not found');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const port=server.address().port,url='http://127.0.0.1:'+port+'/lab/mining-tip-sync/mts-12-ipad-acceptance.html';

async function run(name,type){
  const browser=await type.launch({headless:true});
  try{
    const context=await browser.newContext();
    await context.addInitScript(()=>{
      try{Object.defineProperty(navigator,'platform',{configurable:true,get:()=> 'MacIntel'});Object.defineProperty(navigator,'maxTouchPoints',{configurable:true,get:()=>5})}catch{}
    });
    const page=await context.newPage();
    await page.route('**/fae-public-testnet-v4/status',async route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,node_version:5,network:'fairyelf-public-testnet-v4',height:100,tip_hash:'a'.repeat(64),difficulty_bits:17,target_seconds:180})}));
    await page.goto(url,{waitUntil:'load'});
    await page.waitForFunction(value=>document.getElementById('miner-sha')?.textContent===value,expected,{timeout:5000});
    const result=await page.evaluate(()=>({
      sha:document.getElementById('miner-sha')?.textContent,
      device:document.getElementById('device')?.textContent,
      primitives:document.getElementById('primitives')?.textContent,
      buttons:['open-a','open-b','arm-tip','arm-resume','export'].map(id=>Boolean(document.getElementById(id)))
    }));
    assert.equal(result.sha,expected);
    assert.equal(result.device,'iPad/iPadOS detected');
    assert.equal(result.primitives,'Worker + BroadcastChannel + crypto + lifecycle ready');
    assert.deepEqual(result.buttons,[true,true,true,true,true]);
    await context.close();
    return{name,result:'PASS',...result};
  }finally{await browser.close()}
}
try{
  const results=[await run('chromium',chromium),await run('webkit',webkit)];
  console.log('MTS-12 browser preflight '+JSON.stringify(results));
  console.log('MTS-12 acceptance runner browser preflight PASS');
}finally{
  await new Promise(resolve=>server.close(resolve));
}
