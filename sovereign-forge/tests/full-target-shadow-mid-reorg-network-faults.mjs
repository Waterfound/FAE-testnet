import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createFullTargetShadowPeerNode} from '../node/lab/full-target-shadow-peer-node.mjs';
import {createShadowValidationFixture} from '../node/lab/full-target-shadow-validation-fixtures.mjs';

function createFaultProxy(targetBaseUrl){
  const targetBase=new URL(targetBaseUrl);
  let secureOrdinal=0;
  let dropAt=null;

  const server=http.createServer((req,res)=>{
    const requestUrl=new URL(req.url,targetBase);
    const isSecure=req.method==='POST'&&requestUrl.pathname==='/peer/secure';
    const ordinal=isSecure?++secureOrdinal:null;
    const shouldDrop=isSecure&&dropAt!==null&&ordinal===dropAt;

    const upstream=http.request({
      protocol:targetBase.protocol,
      hostname:targetBase.hostname,
      port:targetBase.port,
      method:req.method,
      path:`${requestUrl.pathname}${requestUrl.search}`,
      headers:req.headers
    },upstreamRes=>{
      res.writeHead(upstreamRes.statusCode??502,upstreamRes.headers);
      let interrupted=false;
      upstreamRes.on('data',chunk=>{
        if(shouldDrop&&!interrupted){
          interrupted=true;
          const prefix=chunk.subarray(0,Math.max(1,Math.floor(chunk.length/2)));
          if(prefix.length&&!res.destroyed)res.write(prefix);
          upstreamRes.destroy();
          res.destroy();
          return;
        }
        if(!interrupted&&!res.destroyed)res.write(chunk);
      });
      upstreamRes.on('end',()=>{if(!interrupted&&!res.destroyed)res.end()});
      upstreamRes.on('error',()=>{if(!res.destroyed)res.destroy()});
    });
    upstream.on('error',()=>{if(!res.destroyed)res.destroy()});
    req.on('error',()=>upstream.destroy());
    req.pipe(upstream);
  });

  return{
    async start(){await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.off('error',reject);resolve()})});return this},
    baseUrl(){const address=server.address();if(!address||typeof address==='string')throw new Error('fault_proxy_not_listening');return `http://127.0.0.1:${address.port}`},
    arm(ordinal){assert.ok(Number.isSafeInteger(ordinal)&&ordinal>=1);secureOrdinal=0;dropAt=ordinal},
    disarm(){secureOrdinal=0;dropAt=null},
    async close(){if(server.listening)await new Promise(resolve=>server.close(resolve))}
  };
}

async function persistedTip(file){const state=JSON.parse(await readFile(file,'utf8'));assert.ok(Array.isArray(state.chain)&&state.chain.length>0);return state.chain.at(-1).hash}

const dir=await mkdtemp(join(tmpdir(),'fae-shadow-mid-reorg-faults-'));
const nodes=[];
let proxy=null;
try{
  const trusted=createShadowValidationFixture('trusted');
  const weak=createShadowValidationFixture('weak-a');
  const strong=createShadowValidationFixture('strong-b');
  assert.equal(trusted.expected_weak_work,weak.expected_work);
  assert.equal(trusted.expected_strong_work,strong.expected_work);
  assert.ok(BigInt(strong.expected_work)>BigInt(weak.expected_work));

  const options=(name,fixture)=>({
    host:'127.0.0.1',port:0,
    dataFile:join(dir,`${name}.json`),
    identityFile:join(dir,`${name}-identity.json`),
    policy:fixture.policy,
    trustedPrefix:fixture.trustedPrefix,
    initialChain:fixture.initialChain
  });

  const a=createFullTargetShadowPeerNode(options('a',weak));
  const b=createFullTargetShadowPeerNode(options('b',strong));
  let c=createFullTargetShadowPeerNode(options('c',trusted));
  nodes.push(a,b,c);
  for(const node of nodes)await node.start();

  // Establish the persisted lower-work starting point first. This represents C
  // having converged to A before discovering B.
  const adoptWeak=await c.syncPeer(a.baseUrl());
  assert.equal(adoptWeak.adopted,true,`weak adoption failed: ${JSON.stringify(adoptWeak)}`);
  assert.equal(c.status().tip_hash,weak.expected_tip_hash);
  assert.equal(await persistedTip(join(dir,'c.json')),weak.expected_tip_hash);

  proxy=createFaultProxy(b.baseUrl());
  await proxy.start();

  // Secure request order inside syncPeer is ancestor -> headers -> blocks.
  // Fault 1 truncates the headers response after the common ancestor is known.
  proxy.arm(2);
  await assert.rejects(()=>c.syncPeer(proxy.baseUrl()));
  assert.equal(c.status().tip_hash,weak.expected_tip_hash,'headers interruption must not mutate live state');
  assert.equal(await persistedTip(join(dir,'c.json')),weak.expected_tip_hash,'headers interruption must not mutate persisted state');

  // Fault 2 permits headers validation, then truncates the block-body response.
  // Candidate state must still remain entirely uncommitted.
  proxy.arm(3);
  await assert.rejects(()=>c.syncPeer(proxy.baseUrl()));
  assert.equal(c.status().tip_hash,weak.expected_tip_hash,'blocks interruption must not mutate live state');
  assert.equal(await persistedTip(join(dir,'c.json')),weak.expected_tip_hash,'blocks interruption must not mutate persisted state');

  // Restore connectivity. A fresh secure session must repeat validation and only
  // then atomically commit the stronger branch.
  proxy.disarm();
  const recovered=await c.syncPeer(proxy.baseUrl());
  assert.equal(recovered.adopted,true,`recovery sync failed: ${JSON.stringify(recovered)}`);
  assert.equal(recovered.headers_validated,3);
  assert.equal(recovered.blocks_validated,3);
  assert.equal(c.status().tip_hash,strong.expected_tip_hash);
  assert.equal(c.status().chain_work,strong.expected_work);
  assert.equal(await persistedTip(join(dir,'c.json')),strong.expected_tip_hash);

  // Once strong B is committed, reachable weak A must never cause rollback.
  const rollback=await c.syncPeer(a.baseUrl());
  assert.equal(rollback.adopted,false);
  assert.equal(rollback.reason,'validated_but_not_preferred');
  assert.equal(c.status().tip_hash,strong.expected_tip_hash);

  // Restart from disk after the interrupted attempts and successful recovery.
  // The recovered tip must survive with no repair or copied state.
  await c.close();
  nodes.splice(nodes.indexOf(c),1);
  c=createFullTargetShadowPeerNode(options('c',trusted));
  nodes.push(c);
  await c.start();
  assert.equal(c.status().tip_hash,strong.expected_tip_hash);
  assert.equal(c.status().chain_work,strong.expected_work);
  assert.equal(c.status().secure_context_binding,c.status().policy_id);
  const current=await c.syncPeer(b.baseUrl());
  assert.equal(current.adopted,false);
  assert.equal(current.reason,'already_current');

  console.log(JSON.stringify({
    status:'PASS',shadow_only:true,
    scenario:'mid-reorg-network-interruption-recovery',
    common_ancestor_height:12,crosses_activation:true,
    headers_response_interrupted:true,blocks_response_interrupted:true,
    no_partial_live_adoption:true,no_partial_persisted_adoption:true,
    fresh_session_recovery:true,stronger_work_selected:true,
    lower_work_rollback_rejected:true,persistence_restart:true
  }));
}finally{
  await proxy?.close().catch(()=>{});
  await Promise.allSettled(nodes.map(node=>node.close()));
  await rm(dir,{recursive:true,force:true});
}
