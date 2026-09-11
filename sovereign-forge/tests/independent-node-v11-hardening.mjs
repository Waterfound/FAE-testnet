import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import {generateKeyPairSync} from 'node:crypto';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {legacyBlocks} from './legacy-testnet-fixture.mjs';
import {prepareIndependentNodeStorage} from '../node/authoritative/node-state-recovery.mjs';
import {PeerGuard} from '../node/authoritative/peer-guard.mjs';
import {createAuthoritativeV4PeerNode,verifyPersistedState} from '../node/authoritative/fae-v4-peer-node.mjs';
import {emptyState,appendBlockFromFeed,NETWORK} from '../node/authoritative/fae-v4-core.mjs';
import {encodeAddress} from '../node/authoritative/address.mjs';
import {hashHex,leadingZeroBits,sha256} from '../node/authoritative/crypto.mjs';
import {generateNodeIdentity,signEnvelope} from '../node/authoritative/node-identity.mjs';

function legacyState(){let state=emptyState();for(const block of legacyBlocks)state=appendBlockFromFeed(state,block,new Map(),{activationHeight:null});return state}
function wallet(){const{publicKey}=generateKeyPairSync('ed25519'),spki=publicKey.export({type:'spki',format:'der'});return{address:encodeAddress(sha256(spki).subarray(0,20),'faet')}}
async function json(url,options={}){const response=await fetch(url,options),body=await response.json();if(!response.ok)throw new Error(`${response.status} ${url}: ${JSON.stringify(body)}`);return body}
async function mine(node,address){const base=node.baseUrl(),template=await json(`${base}/template?address=${encodeURIComponent(address)}`);let nonce=0,hash='';for(;nonce<12_000_000;nonce++){hash=hashHex({...template.header,nonce});if(leadingZeroBits(hash)>=template.header.difficulty_bits)break}if(nonce>=12_000_000)throw new Error('PoW search exhausted');const block={header:template.header,nonce,hash,txids:template.txids||[],coinbase_outputs:template.coinbase_outputs??null};await json(`${base}/submit-block`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(block)});return block}
async function submitBlock(node,block){return json(`${node.baseUrl()}/submit-block`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(block)})}
async function closeServer(server){if(!server.listening)return;await new Promise(resolve=>server.close(resolve))}

test('Independent Node v1.1 recovers a corrupted raw state and durable primary from the verified backup',async context=>{
  const dir=await mkdtemp(join(tmpdir(),'fae-v11-recovery-'));context.after(()=>rm(dir,{recursive:true,force:true}));
  const dataFile=join(dir,'state.json'),durableFile=`${dataFile}.durable`,base=legacyState();
  await writeFile(dataFile,`${JSON.stringify(base,null,2)}\n`);

  const first=await prepareIndependentNodeStorage({dataFile,durableFile,activationHeight:null});
  assert.equal(first.boot.source,'raw-only');
  const checkpoint=await first.checkpoint(base);assert.equal(checkpoint.saved,true);

  await writeFile(dataFile,'{"broken":');
  await writeFile(durableFile,'{"broken":');
  const recovered=await prepareIndependentNodeStorage({dataFile,durableFile,activationHeight:null});
  assert.equal(recovered.boot.recovered,true);assert.equal(recovered.boot.source,'durable-recovery');
  assert.ok(recovered.status().store.recovery_errors.length>=1,'corrupted durable primary must be recorded');

  const restored=JSON.parse(await readFile(dataFile,'utf8')),verified=verifyPersistedState(restored,{activationHeight:null});
  assert.equal(verified.chain.length,legacyBlocks.length);assert.equal(verified.chain.at(-1).hash,legacyBlocks.at(-1).hash);
});

test('Independent Node v1.1 peer guard stays memory-bounded and escalates repeat bans',()=>{
  const guard=new PeerGuard({windowMs:1000,maxCostPerWindow:3,banScore:4,banMs:100,maxBanMs:1000,maxRecords:64});
  for(let i=0;i<200;i++)assert.equal(guard.allow(`peer-${i}`,1,i).allowed,true);
  assert.ok(guard.snapshot(500).length<=64,'peer guard record map must remain bounded');

  guard.penalize('repeat-abuser',4,1000);
  const first=guard.allow('repeat-abuser',1,1001);assert.equal(first.reason,'temporarily-banned');
  assert.ok(first.retryAfterMs>=99);
  guard.penalize('repeat-abuser',4,1101);
  const second=guard.allow('repeat-abuser',1,1102);assert.equal(second.reason,'temporarily-banned');
  assert.ok(second.retryAfterMs>=199,'second ban should be longer than first');
  const record=guard.snapshot(1102).find(row=>row.id==='repeat-abuser');assert.ok(record.banCount>=2);
});

test('Independent nodes survive partition/reconnect, coordinator-off operation and an adversarial bootstrap peer',async context=>{
  const base=legacyState(),miner=wallet();
  const a=createAuthoritativeV4PeerNode({initialState:base,activationHeight:null});
  const b=createAuthoritativeV4PeerNode({initialState:base,activationHeight:null});
  const c=createAuthoritativeV4PeerNode({initialState:base,activationHeight:null});
  const d=createAuthoritativeV4PeerNode({activationHeight:null});
  for(const node of[a,b,c,d]){await node.start();context.after(()=>node.close())}
  for(const node of[a,b,c,d])assert.equal(node.status().discovered_coordinators,0,'consensus must not require a coordinator');

  const common=await mine(a,miner.address);await submitBlock(b,common);await submitBlock(c,common);
  assert.equal(a.status().height,12);assert.equal(b.status().height,12);assert.equal(c.status().height,12);

  await mine(a,miner.address);assert.equal(a.status().height,13);
  const cToA=await c.syncPeer(a.baseUrl());assert.equal(cToA.adopted,true);assert.equal(c.status().height,13);
  await mine(b,miner.address);await mine(b,miner.address);assert.equal(b.status().height,14);
  assert.notEqual(a.status().tip_hash,b.status().tip_hash,'partition must produce divergent tips');

  const aRecovery=await a.syncPeer(b.baseUrl()),cRecovery=await c.syncPeer(b.baseUrl());
  assert.equal(aRecovery.adopted,true);assert.equal(cRecovery.adopted,true);
  assert.equal(a.status().tip_hash,b.status().tip_hash);assert.equal(c.status().tip_hash,b.status().tip_hash);

  const maliciousIdentity=generateNodeIdentity(),wrongGenesis='f'.repeat(64);
  const malicious=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost');
    if(req.method==='GET'&&url.pathname==='/peer/hello'){
      const challenge=url.searchParams.get('challenge')||'';
      const envelope=signEnvelope(maliciousIdentity,'peer-hello',{challenge,software:'adversarial-peer',protocol_version:6,network:NETWORK,genesis:wrongGenesis,height:999999,tip_hash:'e'.repeat(64),chain_work:'999999999999999999',capabilities:['headers-first']});
      res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify(envelope));
    }
    res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:'unexpected_path'}));
  });
  await new Promise(resolve=>malicious.listen(0,'127.0.0.1',resolve));context.after(()=>closeServer(malicious));
  const maliciousBase=`http://127.0.0.1:${malicious.address().port}`;
  await assert.rejects(a.syncPeer(maliciousBase),/peer_genesis_mismatch/);
  assert.equal(a.status().height,14,'malicious peer must not mutate local chain');

  await mine(c,miner.address);
  await a.syncPeer(c.baseUrl()).catch(()=>{});await b.syncPeer(c.baseUrl()).catch(()=>{});
  assert.equal(a.status().height,15);assert.equal(b.status().height,15);assert.equal(c.status().height,15);
  const bootstrap=await d.syncPeer(c.baseUrl());assert.equal(bootstrap.adopted,true);assert.equal(d.status().height,15);
  const tips=new Set([a,b,c,d].map(node=>node.status().tip_hash));assert.equal(tips.size,1,'all independent nodes must converge after reconnect');
  for(const node of[a,b,c,d])assert.equal(node.status().discovered_coordinators,0,'coordinator-off invariant must remain true');
});
