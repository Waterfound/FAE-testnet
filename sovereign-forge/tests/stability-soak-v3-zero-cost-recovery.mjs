import assert from 'node:assert/strict';
import test from 'node:test';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {generateKeyPairSync} from 'node:crypto';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {legacyBlocks} from './legacy-testnet-fixture.mjs';
import {emptyState,appendBlockFromFeed} from '../node/authoritative/fae-v4-core.mjs';
import {createAuthoritativeV4PeerNode} from '../node/authoritative/fae-v4-peer-node.mjs';
import {encodeAddress} from '../node/authoritative/address.mjs';
import {hashHex,leadingZeroBits,sha256} from '../node/authoritative/crypto.mjs';

const root=resolve(new URL('..',import.meta.url).pathname);
const entrypoint=join(root,'node','fae-node-v6-candidate.mjs');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function legacyState(){let state=emptyState();for(const block of legacyBlocks)state=appendBlockFromFeed(state,block,new Map(),{activationHeight:null});return state}
function wallet(){const{publicKey}=generateKeyPairSync('ed25519'),spki=publicKey.export({type:'spki',format:'der'});return encodeAddress(sha256(spki).subarray(0,20),'faet')}
async function freePort(){const s=net.createServer();await new Promise((resolve,reject)=>{s.once('error',reject);s.listen(0,'127.0.0.1',resolve)});const p=s.address().port;await new Promise(resolve=>s.close(resolve));return p}
async function json(url,options={}){const response=await fetch(url,options),body=await response.json();if(!response.ok)throw new Error(`${response.status} ${url}: ${JSON.stringify(body)}`);return body}
async function waitHeight(base,height,{timeoutMs=30_000}={}){const start=Date.now(),deadline=start+timeoutMs;let last=null;while(Date.now()<deadline){try{last=await json(`${base}/status`);if(last.height===height)return{status:last,elapsedMs:Date.now()-start}}catch{}await delay(100)}throw new Error(`height timeout target=${height} last=${last?.height}`)}
async function mine(base,address){const template=await json(`${base}/template?address=${encodeURIComponent(address)}`);let nonce=0,hash='';for(;nonce<12_000_000;nonce++){hash=hashHex({...template.header,nonce});if(leadingZeroBits(hash)>=template.header.difficulty_bits)break}if(nonce>=12_000_000)throw new Error('PoW search exhausted');await json(`${base}/submit-block`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({header:template.header,nonce,hash,txids:template.txids||[],coinbase_outputs:template.coinbase_outputs??null})});return hash}
function startProcess({port,dataFile,durableFile,identityFile,trustFile,peers}){
  const child=spawn(process.execPath,[entrypoint],{env:{...process.env,FAE_HOST:'127.0.0.1',FAE_PORT:String(port),FAE_DATA_FILE:dataFile,FAE_DURABLE_STATE_FILE:durableFile,FAE_IDENTITY_FILE:identityFile,FAE_PEER_TRUST_FILE:trustFile,FAE_PEERS:peers.join(','),FAE_SYNC:'1',FAE_SYNC_MS:'5000',FAE_DURABLE_CHECKPOINT_MS:'1000'},stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c);child.logs=()=>({stdout,stderr});return child;
}
async function hardStop(child){if(!child||child.exitCode!==null||child.signalCode!==null)return;const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));assert.equal(child.kill('SIGKILL'),true);const result=await Promise.race([exited,delay(2000).then(()=>null)]);assert.ok(result,'SIGKILL must terminate process');assert.equal(result.signal,'SIGKILL')}
async function wipeEphemeralState({dataFile,durableFile,trustFile}){for(const path of [dataFile,durableFile,`${durableFile}.bak`,`${durableFile}.tmp`,trustFile])await rm(path,{force:true})}

test('zero-cost candidate: total ephemeral state loss recovers from peers under frozen 180s while identity/bootstrap remain stable',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'fae-zero-cost-v3-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const ports={a:await freePort(),b:await freePort(),c:await freePort()};
  const base={a:`http://127.0.0.1:${ports.a}`,b:`http://127.0.0.1:${ports.b}`,c:`http://127.0.0.1:${ports.c}`};
  const paths=name=>({dataFile:join(dir,`${name}-state.json`),durableFile:join(dir,`${name}-state.durable`),identityFile:join(dir,`${name}-identity.json`),trustFile:join(dir,`${name}-trust.json`)});
  const pa=paths('a'),pb=paths('b'),pc=paths('c'),initial=legacyState(),address=wallet();
  await writeFile(pb.dataFile,`${JSON.stringify(initial,null,2)}\n`);

  const a=createAuthoritativeV4PeerNode({host:'127.0.0.1',port:ports.a,dataFile:pa.dataFile,identityFile:pa.identityFile,peerTrustFile:pa.trustFile,peers:[base.b,base.c],initialState:initial});
  const c=createAuthoritativeV4PeerNode({host:'127.0.0.1',port:ports.c,dataFile:pc.dataFile,identityFile:pc.identityFile,peerTrustFile:pc.trustFile,peers:[base.a,base.b],initialState:initial});
  await a.start();await c.start();t.after(()=>Promise.allSettled([a.close(),c.close()]));

  let b=startProcess({port:ports.b,...pb,peers:[base.a,base.c]});t.after(()=>hardStop(b).catch(()=>{}));
  const first=await waitHeight(base.b,11);const stableIdentity=first.status.node_identity;
  await a.syncPeer(base.b);await c.syncPeer(base.b);

  const recoveries=[];
  for(let cycle=1;cycle<=3;cycle++){
    await hardStop(b);
    await mine(base.a,address);
    const target=11+cycle;
    await c.syncPeer(base.a);
    assert.equal(c.status().height,target);

    await wipeEphemeralState(pb);
    const restartAt=Date.now();
    b=startProcess({port:ports.b,...pb,peers:[base.a,base.c]});

    const recovered=await waitHeight(base.b,target,{timeoutMs:45_000});
    const elapsedMs=Date.now()-restartAt;
    assert.ok(elapsedMs<180_000,`fresh bootstrap exceeded frozen 180s: ${elapsedMs}ms`);
    assert.equal(recovered.status.node_identity,stableIdentity,'identity must survive via non-ephemeral configuration');
    assert.equal(recovered.status.configured_peers,2,'peer bootstrap must survive via configuration');
    assert.equal(recovered.status.tip_hash,a.status().tip_hash,'fresh node must converge to canonical live peer tip');

    const aToB=await a.syncPeer(base.b),cToB=await c.syncPeer(base.b);
    assert.ok(['already_current','already_adopted','validated_but_not_preferred'].includes(aToB.reason)||aToB.adopted===false);
    assert.ok(['already_current','already_adopted','validated_but_not_preferred'].includes(cToB.reason)||cToB.adopted===false);

    recoveries.push({cycle,target,recoveryMs:elapsedMs,identityStable:true,configuredPeers:recovered.status.configured_peers});
  }

  console.log(JSON.stringify({event:'FAE_V3_ZERO_COST_FRESH_BOOTSTRAP_GATE',ok:true,frozenBoundMs:180000,recoveries}));
});
