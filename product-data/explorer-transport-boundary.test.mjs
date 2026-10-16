/**
 * Element 5 transport fail-closed: real node 503-tip differs from a generic
 * 503 outage; a response whose headers arrived but body stalls must observe
 * the caller's bounded timeout. Local loopback only, no provider or secrets.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createExplorerReadAdapter,ExplorerDataError} from './explorer-read-adapter.mjs';

const N='fairyelf-public-testnet-v4';
const reply=(status,body)=>({ok:status>=200&&status<300,status,json:async()=>body});
const reader=fetchImpl=>createExplorerReadAdapter({
  baseUrl:'https://node-reader.invalid/',fetchImpl,timeoutMs:100
});
async function shouldFail(promise,code,status){
  await assert.rejects(promise,e=>e instanceof ExplorerDataError&&e.code===code&&
    (status===undefined||e.status===status));
}
test('real 503 tip_changed_retry is retry, but generic unavailable 503 is not a reorg',async()=>{
  const tip=reader(async()=>reply(503,{ok:false,error:'tip_changed_retry'}));
  await shouldFail(tip.status(),'TIP_CHANGED',503);
  const offline=reader(async()=>reply(503,{ok:false,error:'service_unavailable'}));
  await shouldFail(offline.status(),'NODE_HTTP_ERROR',503);
});
test('502/404 are unavailable node responses, never synthetic data',async()=>{
  for(const status of [502,404]){
    const a=reader(async()=>reply(status,{ok:false,error:'upstream_error'}));
    await shouldFail(a.status(),'NODE_HTTP_ERROR',status);
  }
});
test('total GET timeout also applies when HTTP headers arrived but JSON body never completes',
  {timeout:5000},async t=>{
  const server=createServer((_req,res)=>{
    res.writeHead(200,{'content-type':'application/json'});
    res.write('{"ok":true'); // valid header, incomplete JSON body and no EOF
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
  });
  const a=createExplorerReadAdapter({
    baseUrl:'http://127.0.0.1:'+server.address().port+'/',
    timeoutMs:100
  });
  const observation=await Promise.race([
    a.status().then(()=>({state:'unexpected_success'}),e=>({state:'error',code:e?.code})),
    new Promise(resolve=>setTimeout(()=>resolve({state:'unbounded_hang'}),450))
  ]);
  assert.deepEqual(observation,{state:'error',code:'TIMEOUT'},
    'a slow JSON body must fail closed at the original request timeout, not hang');
});
