import assert from 'node:assert/strict';
import test from 'node:test';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {generateKeyPairSync} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {legacyBlocks} from './legacy-testnet-fixture.mjs';
import {emptyState,appendBlockFromFeed} from '../node/authoritative/fae-v4-core.mjs';
import {createAuthoritativeV4PeerNode} from '../node/authoritative/fae-v4-peer-node.mjs';
import {generateNodeIdentity} from '../node/authoritative/node-identity.mjs';
import {encodeAddress} from '../node/authoritative/address.mjs';
import {sha256} from '../node/authoritative/crypto.mjs';

const root=resolve(new URL('..',import.meta.url).pathname);
const nodeEntrypoint=join(root,'lab','stability-soak-v3','node-runtime.mjs');
const monitorEntrypoint=join(root,'lab','stability-soak-v3','monitor-runtime.mjs');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function legacyState(){let state=emptyState();for(const b of legacyBlocks)state=appendBlockFromFeed(state,b,new Map(),{activationHeight:null});return state}
function wallet(){const{publicKey}=generateKeyPairSync('ed25519'),spki=publicKey.export({type:'spki',format:'der'});return encodeAddress(sha256(spki).subarray(0,20),'faet')}
async function freePort(){const s=net.createServer();await new Promise((resolve,reject)=>{s.once('error',reject);s.listen(0,'127.0.0.1',resolve)});const p=s.address().port;await new Promise(resolve=>s.close(resolve));return p}
async function getJson(url){const r=await fetch(url);const b=await r.json();if(!r.ok)throw new Error(`${r.status} ${JSON.stringify(b)}`);return b}
async function waitJson(url,predicate,{timeoutMs=20_000}={}){const deadline=Date.now()+timeoutMs;let last;while(Date.now()<deadline){try{last=await getJson(url);if(predicate(last))return last}catch{}await delay(100)}throw new Error(`timeout waiting for ${url}: ${JSON.stringify(last)}`)}
function childWithLogs(entrypoint,env){
  const child=spawn(process.execPath,[entrypoint],{env:{...process.env,...env},stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c);child.logs=()=>({stdout,stderr});return child;
}
async function kill(child){if(!child||child.exitCode!==null||child.signalCode!==null)return;const done=new Promise(r=>child.once('exit',r));child.kill('SIGKILL');await Promise.race([done,delay(2000)])}
async function waitLog(child,needle,{timeoutMs=20_000}={}){const deadline=Date.now()+timeoutMs;while(Date.now()<deadline){if(child.logs().stdout.includes(needle))return child.logs();if(child.exitCode!==null)throw new Error(`child exited: ${JSON.stringify(child.logs())}`);await delay(100)}throw new Error(`log timeout ${needle}: ${JSON.stringify(child.logs())}`)}

test('V3 node wrapper rematerializes stable identity, proxies P2P, and fresh-bootstraps after total local loss',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'fae-v3-harness-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const sourceState=legacyState();
  const p1=await freePort(),p2=await freePort();
  const s1=createAuthoritativeV4PeerNode({host:'127.0.0.1',port:p1,initialState:sourceState,identityFile:join(dir,'s1-id.json')});
  const s2=createAuthoritativeV4PeerNode({host:'127.0.0.1',port:p2,initialState:sourceState,identityFile:join(dir,'s2-id.json')});
  await s1.start();await s2.start();t.after(()=>Promise.allSettled([s1.close(),s2.close()]));

  const identity=generateNodeIdentity(),encoded=Buffer.from(JSON.stringify(identity)).toString('base64');
  const externalPort=await freePort(),internalPort=await freePort(),stateDir=join(dir,'ephemeral');
  const env={
    FAE_V3_ROLE:'node-a',FAE_V3_RUN_ID:'smoke',PORT:String(externalPort),FAE_V3_INTERNAL_PORT:String(internalPort),
    FAE_V3_STATE_DIR:stateDir,FAE_PEERS:`http://127.0.0.1:${p1},http://127.0.0.1:${p2}`,
    FAE_NODE_IDENTITY_JSON_B64:encoded,RENDER_GIT_COMMIT:'harness-smoke'
  };
  let child=childWithLogs(nodeEntrypoint,env);t.after(()=>kill(child));
  const base=`http://127.0.0.1:${externalPort}`;
  const first=await waitJson(`${base}/v3/meta?anchor_height=11`,x=>x?.status?.height===11);
  assert.equal(first.node_identity,identity.id);assert.equal(first.status.configured_peers,2);
  assert.equal(first.anchor.hash,first.status.tip_hash);
  assert.equal((await getJson(`${base}/status`)).height,11,'proxy must expose canonical P2P status');
  const firstBoot=first.boot_id;
  await kill(child);await rm(stateDir,{recursive:true,force:true});

  child=childWithLogs(nodeEntrypoint,env);
  const second=await waitJson(`${base}/v3/meta`,x=>x?.status?.height===11);
  assert.equal(second.node_identity,identity.id,'identity must be rematerialized from stable config');
  assert.notEqual(second.boot_id,firstBoot,'restart must have a new process boot id');
  assert.equal(second.status.height,11,'empty local filesystem must fresh-bootstrap from peers');

  const observerPort=await freePort();
  const observer=childWithLogs(monitorEntrypoint,{
    FAE_V3_ROLE:'observer',FAE_V3_RUN_ID:'smoke',PORT:String(observerPort),
    FAE_V3_NODE_A:base,FAE_V3_NODE_B:base,FAE_V3_NODE_C:base,RENDER_GIT_COMMIT:'harness-smoke'
  });t.after(()=>kill(observer));
  await waitJson(`http://127.0.0.1:${observerPort}/v3/health`,x=>x?.ok===true);
  const observerLogs=await waitLog(observer,'FAE_V3_HEARTBEAT',{timeoutMs:15_000});
  assert.match(observerLogs.stdout,/FAE_V3_MONITOR_BOOT/);

  const controllerPort=await freePort(),miner=wallet(),t0=new Date(Date.now()-301_000).toISOString();
  const controller=childWithLogs(monitorEntrypoint,{
    FAE_V3_ROLE:'controller',FAE_V3_RUN_ID:'smoke',PORT:String(controllerPort),
    FAE_V3_NODE_A:base,FAE_V3_NODE_B:base,FAE_V3_NODE_C:base,
    FAE_V3_T0_UTC:t0,FAE_V3_START_HEIGHT:'11',FAE_V3_MINER_ADDRESS:miner,RENDER_GIT_COMMIT:'harness-smoke'
  });t.after(()=>kill(controller));
  await waitLog(controller,'FAE_V3_BLOCK_MINED',{timeoutMs:20_000});
  const afterMine=await waitJson(`${base}/status`,x=>x.height>=12);
  assert.ok(afterMine.height>=12,'controller must produce operational test traffic without changing consensus rules');
});
