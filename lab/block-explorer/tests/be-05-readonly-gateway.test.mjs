import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  BE05_PUBLIC_ROUTES,
  createReadonlyGateway,
  normalizeNodeOrigin,
  normalizeExplorerOrigin
} from '../be05-readonly-gateway.mjs';

const EXPLORER_ORIGIN='https://fae-block-explorer-e2z4q3.v2.appdeploy.ai';

async function listen(server){
  await new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(0,'127.0.0.1',resolve);
  });
  const address=server.address();
  return 'http://127.0.0.1:'+address.port;
}
async function close(server){
  await new Promise(resolve=>server.close(()=>resolve()));
}
async function withTopology(upstreamHandler,run){
  const upstream=http.createServer(upstreamHandler);
  const upstreamOrigin=await listen(upstream);
  const gateway=createReadonlyGateway({
    nodeOrigin:upstreamOrigin,
    explorerOrigin:EXPLORER_ORIGIN,
    timeoutMs:3000
  });
  const gatewayOrigin=await listen(gateway);
  try{return await run({gatewayOrigin,upstreamOrigin})}
  finally{
    await close(gateway);
    await close(upstream);
  }
}

test('gateway has the exact six Explorer read routes',()=>{
  assert.deepEqual([...BE05_PUBLIC_ROUTES].sort(),[
    '/explorer/address',
    '/explorer/block',
    '/explorer/blocks',
    '/explorer/search',
    '/explorer/status',
    '/explorer/transaction'
  ]);
});

test('internal node origin is loopback HTTP only',()=>{
  assert.equal(normalizeNodeOrigin('http://127.0.0.1:8787'),'http://127.0.0.1:8787');
  assert.equal(normalizeNodeOrigin('http://localhost:8787'),'http://localhost:8787');
  assert.throws(()=>normalizeNodeOrigin('https://127.0.0.1:8787'),/loopback_http/);
  assert.throws(()=>normalizeNodeOrigin('http://node.example:8787'),/must_be_loopback/);
  assert.throws(()=>normalizeNodeOrigin('http://user:pass@127.0.0.1:8787'),/invalid_node_origin/);
});

test('production Explorer origin requires HTTPS',()=>{
  assert.equal(normalizeExplorerOrigin(EXPLORER_ORIGIN),EXPLORER_ORIGIN);
  assert.throws(()=>normalizeExplorerOrigin('http://example.test'),/requires_https/);
  assert.equal(normalizeExplorerOrigin('http://127.0.0.1:3000'),'http://127.0.0.1:3000');
});

test('GET allowlist proxies query to the private node and preserves JSON',async()=>{
  const seen=[];
  await withTopology((req,res)=>{
    seen.push({method:req.method,url:req.url});
    res.writeHead(200,{'content-type':'application/json'});
    res.end(JSON.stringify({
      ok:true,
      network:'fairyelf-public-testnet-v4',
      observed_tip_height:7,
      observed_tip_hash:'1'.repeat(64)
    }));
  },async({gatewayOrigin})=>{
    const response=await fetch(gatewayOrigin+'/explorer/blocks?limit=1',{
      headers:{origin:EXPLORER_ORIGIN,accept:'application/json'}
    });
    assert.equal(response.status,200);
    assert.equal(response.headers.get('access-control-allow-origin'),EXPLORER_ORIGIN);
    assert.equal(response.headers.get('cache-control'),'no-store');
    assert.equal((await response.json()).observed_tip_height,7);
  });
  assert.deepEqual(seen,[{method:'GET',url:'/explorer/blocks?limit=1'}]);
});

test('non-Explorer routes never reach the node',async()=>{
  let upstreamCalls=0;
  await withTopology((req,res)=>{
    upstreamCalls++;
    res.writeHead(200,{'content-type':'application/json'});
    res.end('{}');
  },async({gatewayOrigin})=>{
    for(const path of ['/status','/feed','/submit-tx','/submit-block','/state','/peers']){
      const response=await fetch(gatewayOrigin+path);
      assert.equal(response.status,404,path);
      assert.equal((await response.json()).error,'public_route_not_found');
    }
  });
  assert.equal(upstreamCalls,0);
});

test('mutating methods are rejected at gateway before reaching node',async()=>{
  let upstreamCalls=0;
  await withTopology((req,res)=>{
    upstreamCalls++;
    res.writeHead(500,{'content-type':'application/json'});
    res.end('{}');
  },async({gatewayOrigin})=>{
    const response=await fetch(gatewayOrigin+'/explorer/status',{
      method:'POST',
      headers:{origin:EXPLORER_ORIGIN,'content-type':'application/json'},
      body:'{}'
    });
    assert.equal(response.status,405);
    assert.equal((await response.json()).error,'read_only');
  });
  assert.equal(upstreamCalls,0);
});

test('CORS is exact-origin GET/OPTIONS with no POST advertisement',async()=>{
  let upstreamCalls=0;
  await withTopology((req,res)=>{
    upstreamCalls++;
    res.writeHead(200,{'content-type':'application/json'});
    res.end('{}');
  },async({gatewayOrigin})=>{
    const good=await fetch(gatewayOrigin+'/explorer/status',{
      method:'OPTIONS',
      headers:{origin:EXPLORER_ORIGIN}
    });
    assert.equal(good.status,204);
    assert.equal(good.headers.get('access-control-allow-origin'),EXPLORER_ORIGIN);
    assert.equal(good.headers.get('access-control-allow-methods'),'GET,OPTIONS');
    assert.equal(good.headers.get('access-control-allow-methods').includes('POST'),false);

    const bad=await fetch(gatewayOrigin+'/explorer/status',{
      headers:{origin:'https://attacker.example'}
    });
    assert.equal(bad.status,403);
    assert.equal((await bad.json()).error,'origin_not_allowed');
  });
  assert.equal(upstreamCalls,0);
});

test('gateway fails closed on non-JSON node responses',async()=>{
  await withTopology((req,res)=>{
    res.writeHead(200,{'content-type':'text/plain'});
    res.end('not-json');
  },async({gatewayOrigin})=>{
    const response=await fetch(gatewayOrigin+'/explorer/status');
    assert.equal(response.status,502);
    assert.equal((await response.json()).error,'invalid_node_content_type');
  });
});
