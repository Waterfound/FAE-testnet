import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {createExplorerClient,ExplorerClientError,EXPLORER_NETWORK} from '../../../explorer/api-client.mjs';

const root=new URL('../../../',import.meta.url);
const read=async path=>readFile(new URL(path,root),'utf8');
const TIP='1'.repeat(64);
const DIGEST='2'.repeat(64);
const ADDRESS='faet1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqw2770k';

async function withServer(handler,run){
  const server=http.createServer(handler);
  await new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(0,'127.0.0.1',resolve);
  });
  const address=server.address();
  try{return await run('http://127.0.0.1:'+address.port)}
  finally{await new Promise(resolve=>server.close(()=>resolve()))}
}

function success(extra={}){
  return{
    ok:true,
    network:EXPLORER_NETWORK,
    observed_tip_height:1,
    observed_tip_hash:TIP,
    ...extra
  };
}

test('standalone shell does not import Wallet/Mining application code',async()=>{
  const html=await read('explorer/index.html');
  assert.match(html,/FAE Explorer/);
  assert.match(html,/Read-only/);
  assert.match(html,/\.\/app\.mjs/);
  assert.match(html,/\.\/styles\.css/);
  for(const forbidden of ['core.js','wallet.js','wallet-crypto.js','mining.js','coordinator-trust.js','supabase']){
    assert.equal(html.includes(forbidden),false,forbidden+' leaked into Explorer shell');
  }
});

test('Explorer source exposes no mutation, signing, mining or secret operation',async()=>{
  const sources=(await Promise.all([
    read('explorer/api-client.mjs'),
    read('explorer/app.mjs'),
    read('explorer/index.html')
  ])).join('\n');
  for(const forbidden of [
    '/submit-tx','/submit-block','method:\'POST\'','method:"POST"',
    'privateKey','private_key','seedPhrase','seed_phrase','signTransaction','startMining'
  ]){
    assert.equal(sources.includes(forbidden),false,forbidden+' must not exist in Explorer source');
  }
  assert.equal(sources.includes('innerHTML'),false,'Explorer UI must not render network data with innerHTML');
});

test('application config remains read-only, testnet-bound and NOT_LIVE',async()=>{
  const config=JSON.parse(await read('explorer/config.json'));
  assert.equal(config.schema,'FAE_EXPLORER_APP_CONFIG_V1');
  assert.equal(config.network,EXPLORER_NETWORK);
  assert.equal(config.read_only,true);
  assert.equal(config.deployment_state,'NOT_LIVE');
  assert.equal(config.api_base,'http://127.0.0.1:8787');
});

test('client emits GET only across every verified Explorer resource',async()=>{
  const seen=[];
  await withServer((req,res)=>{
    seen.push({method:req.method,url:req.url});
    res.writeHead(200,{'content-type':'application/json'});
    res.end(JSON.stringify(success({
      blocks:[],
      block:{height:1,hash:DIGEST},
      transaction:{txid:DIGEST},
      address:ADDRESS,
      events:[],
      matches:[]
    })));
  },async base=>{
    const client=createExplorerClient({apiBase:base});
    await client.status();
    await client.blocks({limit:3});
    await client.blockByHeight(1);
    await client.blockByHash(DIGEST);
    await client.transaction(DIGEST);
    await client.address({address:ADDRESS,limit:2,cursor:null});
    await client.search(DIGEST);
  });
  assert.equal(seen.length,7);
  assert.ok(seen.every(entry=>entry.method==='GET'));
  assert.deepEqual(
    seen.map(entry=>entry.url.split('?')[0]),
    ['/explorer/status','/explorer/blocks','/explorer/block','/explorer/block','/explorer/transaction','/explorer/address','/explorer/search']
  );
});

test('client fails closed on network identity mismatch',async()=>{
  await withServer((req,res)=>{
    res.writeHead(200,{'content-type':'application/json'});
    res.end(JSON.stringify({
      ok:true,
      network:'wrong-network',
      observed_tip_height:1,
      observed_tip_hash:TIP
    }));
  },async base=>{
    const client=createExplorerClient({apiBase:base});
    await assert.rejects(
      ()=>client.status(),
      error=>error instanceof ExplorerClientError&&error.code==='network_mismatch'
    );
  });
});

test('client fails closed when observed tip binding is malformed',async()=>{
  await withServer((req,res)=>{
    res.writeHead(200,{'content-type':'application/json'});
    res.end(JSON.stringify({
      ok:true,
      network:EXPLORER_NETWORK,
      observed_tip_height:1,
      observed_tip_hash:'not-a-hash'
    }));
  },async base=>{
    const client=createExplorerClient({apiBase:base});
    await assert.rejects(
      ()=>client.status(),
      error=>error instanceof ExplorerClientError&&error.code==='invalid_payload'
    );
  });
});

test('client rejects credential-bearing or non-HTTP API bases',()=>{
  assert.throws(
    ()=>createExplorerClient({apiBase:'https://user:pass@example.com'}),
    error=>error instanceof ExplorerClientError&&error.code==='invalid_api_base'
  );
  assert.throws(
    ()=>createExplorerClient({apiBase:'file:///tmp/fae'}),
    error=>error instanceof ExplorerClientError&&error.code==='invalid_api_base'
  );
});

test('client surface does not expose a generic arbitrary-path request primitive',()=>{
  const client=createExplorerClient({
    apiBase:'https://example.test',
    fetchImpl:async()=>{throw new Error('not called')}
  });
  assert.equal('request' in client,false);
  assert.deepEqual(
    Object.keys(client).sort(),
    ['address','apiBase','blockByHash','blockByHeight','blocks','expectedNetwork','search','status','transaction'].sort()
  );
});

test('hash routing avoids server rewrite authority',async()=>{
  const app=await read('explorer/app.mjs');
  assert.match(app,/location\.hash/);
  assert.match(app,/hashchange/);
  assert.equal(app.includes('history.pushState'),false);
  assert.equal(app.includes('history.replaceState'),false);
});

test('Explorer deletion boundary stays physically separate from active root site',async()=>{
  const authority=JSON.parse(await read('lab/block-explorer/authority.json'));
  assert.equal(authority.current_frontier,'BE-03');
  assert.equal(authority.be03_authority.state,'AUTHORIZED_BOUNDED');
  assert.equal(authority.explorer_application_write_authorized,true);
  assert.equal(authority.explorer_application_live_authorized,false);
  assert.equal(authority.public_deployment_authorized,false);
  assert.equal(authority.node_query_surface_write_authorized,false);
  assert.equal(authority.wallet_write_authorized,false);
  assert.equal(authority.mining_authority_authorized,false);
  assert.ok(authority.be03_authority.allowed_write_scopes.some(scope=>scope.prefix==='explorer/'));
  assert.equal(authority.current_stage_protected_path_exceptions.length,0);
});


test('HTML shell contains every DOM binding required by app.mjs',async()=>{
  const html=await read('explorer/index.html');
  for(const id of [
    'network-pill','network-label','api-origin','search-form','search-input',
    'refresh-button','home-button','latest-blocks','detail-eyebrow','detail-title',
    'detail-content','notice','metric-height','metric-supply','metric-target','metric-mempool'
  ]){
    assert.ok(html.includes('id="'+id+'"'),'missing Explorer DOM binding: '+id);
  }
});

test('stale address cursor remains a node-owned fail-closed retry signal',async()=>{
  await withServer((req,res)=>{
    res.writeHead(503,{'content-type':'application/json'});
    res.end(JSON.stringify({ok:false,error:'tip_changed_retry',detail:'cursor_tip_mismatch'}));
  },async base=>{
    const client=createExplorerClient({apiBase:base});
    await assert.rejects(
      ()=>client.address({address:ADDRESS,limit:2,cursor:TIP+':2'}),
      error=>error instanceof ExplorerClientError&&error.code==='tip_changed_retry'&&error.status===503
    );
  });
});
