import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {chromium,webkit} from 'playwright';

const paths={
  '/': '../../../index.html',
  '/bip39-en.js': '../../../bip39-en.js',
  '/network-status.js': '../../../network-status.js',
  '/core.js': '../../../core.js',
  '/wallet-crypto.js': '../../../wallet-crypto.js',
  '/wallet.js': '../../../wallet.js',
  '/mining.js': '../../../mining.js',
  '/coordinator-trust.js': '../../../coordinator-trust.js',
  '/lab/mining-tip-sync/mts-12-ipad-acceptance.html': '../mts-12-ipad-acceptance.html'
};
const files={};
for(const [urlPath,relative] of Object.entries(paths))files[urlPath]=await readFile(new URL(relative,import.meta.url));
const expected='e75a064030590d12ec4a528bb828360a2ad31eb22b35f33d4fec96a51ce9610c';
const watch='faet1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqw2770k';
const tip='a'.repeat(64);

const server=createServer((req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  const body=files[url.pathname];
  if(body){
    const type=url.pathname.endsWith('.js')?'text/javascript; charset=utf-8':'text/html; charset=utf-8';
    res.writeHead(200,{'content-type':type,'cache-control':'no-store'});res.end(body);return;
  }
  res.writeHead(404);res.end('not found');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const port=server.address().port,runnerUrl='http://127.0.0.1:'+port+'/lab/mining-tip-sync/mts-12-ipad-acceptance.html';

async function fulfillApi(route){
  const url=new URL(route.request().url()),path=url.pathname.split('/fae-public-testnet-v4')[1]||'/';
  const response=body=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
  if(path.startsWith('/status'))return response({ok:true,node_version:5,network:'fairyelf-public-testnet-v4',height:100,tip_hash:tip,difficulty_bits:64,target_seconds:180,issued_atoms:'0',issued_fae:'0',max_supply_fae:'12000000',halving_era_blocks:600000,reward_fae:'10'});
  if(path.startsWith('/state'))return response({ok:true,height:100,tip_hash:tip,recent:[]});
  if(path.startsWith('/transactions'))return response({ok:true,transactions:[]});
  if(path.startsWith('/balance'))return response({ok:true,balance_fae:'0'});
  if(path.startsWith('/spendable'))return response({ok:true,spendable_fae:'0',utxos:[]});
  if(path.startsWith('/template'))return response({ok:true,template_policy:'snapshot',header:{network:'fairyelf-public-testnet-v4',height:101,previous_hash:tip,timestamp_ms:Date.now(),difficulty_bits:64,miner_address:watch,reward_atoms:'1000000000',tx_root:'0'.repeat(64),tx_count:0},txids:[]});
  if(path.startsWith('/submit-block'))return response({ok:false,error:'unexpected_submit'});
  return response({ok:true});
}

async function run(name,type){
  const browser=await type.launch({headless:true});
  try{
    const context=await browser.newContext();
    await context.addInitScript(()=>{
      try{Object.defineProperty(navigator,'platform',{configurable:true,get:()=> 'MacIntel'});Object.defineProperty(navigator,'maxTouchPoints',{configurable:true,get:()=>5})}catch{}
    });
    await context.route('**/fae-public-testnet-v4**',fulfillApi);
    const page=await context.newPage();
    await page.goto(runnerUrl,{waitUntil:'load'});
    await page.waitForFunction(value=>document.getElementById('miner-sha')?.textContent===value,expected,{timeout:5000});

    const initial=await page.evaluate(()=>({
      sha:document.getElementById('miner-sha')?.textContent,
      device:document.getElementById('device')?.textContent,
      primitives:document.getElementById('primitives')?.textContent,
      iframeCount:document.querySelectorAll('iframe').length
    }));
    assert.equal(initial.sha,expected);
    assert.equal(initial.device,'iPad/iPadOS detected');
    assert.equal(initial.primitives,'Worker + BroadcastChannel + crypto + lifecycle + top-level tabs ready');
    assert.equal(initial.iframeCount,0);

    await page.click('#arm-tip');
    await page.waitForFunction(()=>document.getElementById('tip-result')?.textContent.includes('open A and B first'));

    const popupAPromise=page.waitForEvent('popup');
    await page.click('#open-a');
    const popupA=await popupAPromise;
    await popupA.waitForLoadState('load');
    assert.equal(new URL(popupA.url()).pathname,'/');
    await page.waitForFunction(()=>document.getElementById('status-a')?.textContent==='Running',null,{timeout:15000});

    const popupBPromise=page.waitForEvent('popup');
    await page.click('#open-b');
    const popupB=await popupBPromise;
    await popupB.waitForLoadState('load');
    assert.equal(new URL(popupB.url()).pathname,'/');
    await page.waitForFunction(()=>document.getElementById('status-b')?.textContent==='Running',null,{timeout:15000});

    await page.click('#arm-tip');
    await page.waitForFunction(()=>document.getElementById('tip-result')?.textContent.startsWith('Armed'));

    const result=await page.evaluate(()=>({
      a:document.getElementById('status-a')?.textContent,
      b:document.getElementById('status-b')?.textContent,
      tip:document.getElementById('tip-result')?.textContent,
      stale:document.getElementById('stale-count')?.textContent,
      manual:document.getElementById('manual-restart')?.textContent
    }));
    assert.equal(result.a,'Running');assert.equal(result.b,'Running');
    assert.match(result.tip,/^Armed/);assert.equal(result.stale,'0');assert.equal(result.manual,'No');
    await context.close();
    return{name,result:'PASS',...initial,...result};
  }finally{await browser.close()}
}
try{
  const results=[await run('chromium',chromium),await run('webkit',webkit)];
  console.log('MTS-12 top-level-tab browser preflight '+JSON.stringify(results));
  console.log('MTS-12 no-iframe acceptance runner browser preflight PASS');
}finally{
  await new Promise(resolve=>server.close(resolve));
}
