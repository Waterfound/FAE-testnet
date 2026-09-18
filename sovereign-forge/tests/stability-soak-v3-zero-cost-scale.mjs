import assert from 'node:assert/strict';
import test from 'node:test';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {generateKeyPairSync} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {legacyBlocks} from './legacy-testnet-fixture.mjs';
import {
  NETWORK,emptyState,appendBlockFromFeed,appendBlockFromSubmission,
  nextDifficulty,expectedReward,tip
} from '../node/authoritative/fae-v4-core.mjs';
import {createAuthoritativeV4PeerNode} from '../node/authoritative/fae-v4-peer-node.mjs';
import {encodeAddress} from '../node/authoritative/address.mjs';
import {hashHex,leadingZeroBits,sha256} from '../node/authoritative/crypto.mjs';

const root=resolve(new URL('..',import.meta.url).pathname);
const entrypoint=join(root,'node','fae-node-v6-candidate.mjs');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function legacyState(){let state=emptyState();for(const block of legacyBlocks)state=appendBlockFromFeed(state,block,new Map(),{activationHeight:null});return state}
function wallet(){const{publicKey}=generateKeyPairSync('ed25519'),spki=publicKey.export({type:'spki',format:'der'});return encodeAddress(sha256(spki).subarray(0,20),'faet')}
async function freePort(){const s=net.createServer();await new Promise((resolve,reject)=>{s.once('error',reject);s.listen(0,'127.0.0.1',resolve)});const p=s.address().port;await new Promise(resolve=>s.close(resolve));return p}
async function json(url){const r=await fetch(url),b=await r.json();if(!r.ok)throw new Error(`${r.status} ${JSON.stringify(b)}`);return b}
async function waitHeight(base,height,{timeoutMs=180_000}={}){const start=Date.now(),deadline=start+timeoutMs;let last=null;while(Date.now()<deadline){try{last=await json(`${base}/status`);if(last.height===height)return{status:last,elapsedMs:Date.now()-start}}catch{}await delay(100)}throw new Error(`fresh bootstrap timeout target=${height} last=${last?.height}`)}
function mineOffline(state,address,timestampMs){
  const height=state.chain.length+1,bits=nextDifficulty(state.chain),header={
    network:NETWORK,height,previous_hash:tip(state)?.hash||'0'.repeat(64),timestamp_ms:timestampMs,
    difficulty_bits:bits,miner_address:address,reward_atoms:expectedReward(state,height).toString(),
    tx_root:hashHex([]),tx_count:0
  };
  for(let nonce=0;nonce<20_000_000;nonce++){
    const hash=hashHex({...header,nonce});
    if(leadingZeroBits(hash)<bits)continue;
    return appendBlockFromSubmission(state,{header,nonce,hash,txids:[]},{activationHeight:null});
  }
  throw new Error(`nonce budget exhausted height=${height} bits=${bits}`);
}
function buildV3SizedState(address){
  let state=legacyState(),timestamp=Number(tip(state).timestamp_ms);
  // 1,152 additional blocks ~= 96h at 300 seconds/block. Timestamps are
  // deliberately spaced farther apart only to lower PoW cost for this
  // transport/bootstrap scale test; no economic or timing claim is made.
  for(let i=0;i<1152;i++){timestamp+=720_000;state=mineOffline(state,address,timestamp)}
  return state;
}
function startFresh({port,dataFile,durableFile,identityFile,trustFile,peer}){
  const child=spawn(process.execPath,[entrypoint],{env:{...process.env,FAE_HOST:'127.0.0.1',FAE_PORT:String(port),FAE_DATA_FILE:dataFile,FAE_DURABLE_STATE_FILE:durableFile,FAE_IDENTITY_FILE:identityFile,FAE_PEER_TRUST_FILE:trustFile,FAE_PEERS:peer,FAE_SYNC:'1',FAE_SYNC_MS:'5000',FAE_DURABLE_CHECKPOINT_MS:'1000'},stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c);child.logs=()=>({stdout,stderr});return child;
}
async function hardStop(child){if(!child||child.exitCode!==null||child.signalCode!==null)return;const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));child.kill('SIGKILL');await Promise.race([exited,delay(2000)])}

test('zero-cost V3 scale gate: fresh node bootstraps a 96h-sized chain below 180s',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'fae-v3-scale-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const address=wallet(),buildStarted=Date.now(),sourceState=buildV3SizedState(address),buildMs=Date.now()-buildStarted;
  assert.equal(sourceState.chain.length,1163);

  const aPort=await freePort(),bPort=await freePort();
  const a=createAuthoritativeV4PeerNode({host:'127.0.0.1',port:aPort,initialState:sourceState,identityFile:join(dir,'a-identity.json')});
  await a.start();t.after(()=>a.close());
  const aBase=`http://127.0.0.1:${aPort}`,bBase=`http://127.0.0.1:${bPort}`;
  const b=startFresh({port:bPort,dataFile:join(dir,'b-state.json'),durableFile:join(dir,'b-state.durable'),identityFile:join(dir,'b-identity.json'),trustFile:join(dir,'b-trust.json'),peer:aBase});
  t.after(()=>hardStop(b));

  const recovered=await waitHeight(bBase,1163,{timeoutMs:180_000});
  assert.equal(recovered.status.tip_hash,a.status().tip_hash);
  assert.equal(recovered.status.configured_peers,1);
  console.log(JSON.stringify({event:'FAE_V3_ZERO_COST_SCALE_GATE',ok:true,additionalBlocks:1152,totalHeight:1163,buildMs,recoveryMs:recovered.elapsedMs,frozenBoundMs:180000}));
});
