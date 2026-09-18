import assert from 'node:assert/strict';
import test from 'node:test';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {legacyBlocks} from './legacy-testnet-fixture.mjs';
import {emptyState,appendBlockFromFeed} from '../node/authoritative/fae-v4-core.mjs';
import {createAuthoritativeV4PeerNode} from '../node/authoritative/fae-v4-peer-node.mjs';
import {generateNodeIdentity} from '../node/authoritative/node-identity.mjs';
import {generateKeyPairSync} from 'node:crypto';
import {encodeAddress} from '../node/authoritative/address.mjs';
import {sha256} from '../node/authoritative/crypto.mjs';

const root=resolve(new URL('..',import.meta.url).pathname);
const entrypoint=join(root,'lab','stability-soak-v3','node-runtime.mjs');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function legacyState(){let s=emptyState();for(const b of legacyBlocks)s=appendBlockFromFeed(s,b,new Map(),{activationHeight:null});return s}
function wallet(){const{publicKey}=generateKeyPairSync('ed25519'),spki=publicKey.export({type:'spki',format:'der'});return encodeAddress(sha256(spki).subarray(0,20),'faet')}
async function freePort(){const s=net.createServer();await new Promise((resolve,reject)=>{s.once('error',reject);s.listen(0,'127.0.0.1',resolve)});const p=s.address().port;await new Promise(resolve=>s.close(resolve));return p}
function start(env){const c=spawn(process.execPath,[entrypoint],{env:{...process.env,...env},stdio:['ignore','pipe','pipe']});let stdout='',stderr='';c.stdout.on('data',x=>stdout+=x);c.stderr.on('data',x=>stderr+=x);c.logs=()=>({stdout,stderr});return c}
async function kill(c){if(!c||c.exitCode!==null||c.signalCode!==null)return;const done=new Promise(r=>c.once('exit',r));c.kill('SIGKILL');await Promise.race([done,delay(2000)])}
async function json(url){const r=await fetch(url),b=await r.json();if(!r.ok)throw new Error(`${r.status}:${JSON.stringify(b)}`);return b}
async function waitJson(url,p,{timeoutMs=20_000}={}){const end=Date.now()+timeoutMs;let last;while(Date.now()<end){try{last=await json(url);if(p(last))return last}catch{}await delay(100)}throw new Error(`timeout ${url}: ${JSON.stringify(last)}`)}
async function waitLog(c,needle,{timeoutMs=20_000}={}){const end=Date.now()+timeoutMs;while(Date.now()<end){if(c.logs().stdout.includes(needle))return;if(c.exitCode!==null)throw new Error(JSON.stringify(c.logs()));await delay(100)}throw new Error(`log timeout ${needle}: ${JSON.stringify(c.logs())}`)}

test('embedded controller remains disarmed pre-T0 and produces one rotating V3 traffic block when armed',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'fae-v3-embed-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const state=legacyState(),bPort=await freePort(),cPort=await freePort();
  const b=createAuthoritativeV4PeerNode({host:'127.0.0.1',port:bPort,initialState:state,identityFile:join(dir,'b-id.json')});
  const c=createAuthoritativeV4PeerNode({host:'127.0.0.1',port:cPort,initialState:state,identityFile:join(dir,'c-id.json')});
  await b.start();await c.start();t.after(()=>Promise.allSettled([b.close(),c.close()]));

  const ext=await freePort(),internal=await freePort(),base=`http://127.0.0.1:${ext}`;
  const identity=Buffer.from(JSON.stringify(generateNodeIdentity())).toString('base64');
  const common={
    FAE_V3_ROLE:'node-a',FAE_V3_RUN_ID:'fallback-smoke',PORT:String(ext),FAE_V3_INTERNAL_PORT:String(internal),
    FAE_V3_STATE_DIR:join(dir,'a-state'),FAE_PEERS:`http://127.0.0.1:${bPort},http://127.0.0.1:${cPort}`,
    FAE_NODE_IDENTITY_JSON_B64:identity,FAE_V3_EMBED_CONTROLLER:'1',
    FAE_V3_NODE_A:base,FAE_V3_NODE_B:`http://127.0.0.1:${bPort}`,FAE_V3_NODE_C:`http://127.0.0.1:${cPort}`,
    FAE_V3_MINER_ADDRESS:wallet()
  };

  let child=start(common);t.after(()=>kill(child));
  const pre=await waitJson(`${base}/v3/meta`,x=>x?.status?.height===11);
  assert.equal(pre.embedded_controller.enabled,true);
  assert.equal(pre.embedded_controller.run_started,false);
  await delay(1500);
  assert.equal((await json(`${base}/status`)).height,11,'prestart must not mine before T0');
  await kill(child);

  child=start({...common,FAE_V3_T0_UTC:new Date(Date.now()-301_000).toISOString()});
  await waitLog(child,'FAE_V3_EMBEDDED_BLOCK_MINED',{timeoutMs:20_000});
  const post=await waitJson(`${base}/v3/meta`,x=>x?.status?.height>=12);
  assert.equal(post.embedded_controller.enabled,true);
  assert.equal(post.embedded_controller.run_started,true);
  assert.ok(post.embedded_controller.last_block?.height>=12);
});
