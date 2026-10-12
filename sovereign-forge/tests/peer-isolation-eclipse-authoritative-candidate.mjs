import assert from 'node:assert/strict';
import test from 'node:test';
import {generateKeyPairSync} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EclipseResistantDiscovery} from '../node/lab/peer-isolation-eclipse-candidate.mjs';
import {EclipseResistantDiscoveryCandidate} from '../node/authoritative/eclipse-resistant-discovery-candidate.mjs';
import {createAuthoritativeV4PeerNodeEclipseCandidate} from '../node/authoritative/fae-v4-peer-node-eclipse-candidate.mjs';
import {createAuthoritativeV4PeerNode} from '../node/authoritative/fae-v4-peer-node.mjs';
import {emptyState,appendBlockFromFeed} from '../node/authoritative/fae-v4-core.mjs';
import {encodeAddress} from '../node/authoritative/address.mjs';
import {hashHex,leadingZeroBits,sha256} from '../node/authoritative/crypto.mjs';
import {legacyBlocks} from './legacy-testnet-fixture.mjs';

const id=n=>n.toString(16).padStart(64,'0');
function peer(endpoint,identityId,source='gossip'){return{endpoint,identityId,source}}
function legacyState(){let state=emptyState();for(const block of legacyBlocks)state=appendBlockFromFeed(state,block,new Map(),{activationHeight:null});return state}
function wallet(){const{publicKey}=generateKeyPairSync('ed25519'),spki=publicKey.export({type:'spki',format:'der'});return{address:encodeAddress(sha256(spki).subarray(0,20),'faet')}}
async function json(url,options={}){const response=await fetch(url,options),body=await response.json();if(!response.ok)throw new Error(`${response.status} ${url}: ${JSON.stringify(body)}`);return body}
async function mine(base,address){const template=await json(`${base}/template?address=${encodeURIComponent(address)}`);let nonce=0,hash='';for(;nonce<10_000_000;nonce++){hash=hashHex({...template.header,nonce});if(leadingZeroBits(hash)>=template.header.difficulty_bits)break}if(nonce>=10_000_000)throw new Error('PoW search exhausted');await json(`${base}/submit-block`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({header:template.header,nonce,hash,txids:template.txids||[],coinbase_outputs:template.coinbase_outputs??null})});return hash}
function comparableSnapshot(view){return view.snapshot().map(({firstSeenAt,lastSeenAt,...row})=>row)}

test('promoted authoritative candidate preserves the frozen Gate-1 decisions',()=>{
  let clock=1_920_000_000_000;const anchor=id(1),options={pinnedIdentityIds:[anchor],maxRecords:12,maxEndpointsPerIdentity:2,maxProbeBatch:5,failureBackoffMs:100,maxFailureBackoffMs:1000,healthyReprobeMs:5000,now:()=>clock};
  const lab=new EclipseResistantDiscovery(options),candidate=new EclipseResistantDiscoveryCandidate(options);
  const records=[peer('https://anchor.example',anchor,'operator'),...Array.from({length:20},(_,i)=>peer(`http://10.9.8.${i+1}:8787`,id(i+10))),peer('https://independent-a.example',id(80)),peer('https://independent-b.example',id(81))];
  lab.ingest(records);candidate.ingest(records);
  assert.deepEqual(comparableSnapshot(candidate),comparableSnapshot(lab));
  const labBatch=lab.probeBatch({limit:5}),candidateBatch=candidate.probeBatch({limit:5});assert.deepEqual(candidateBatch,labBatch);
  for(let i=0;i<labBatch.length;i++){const row=labBatch[i],ok=i!==0;lab.markProbeResult({identityId:row.identityId,endpoint:row.endpoint,ok});candidate.markProbeResult({identityId:row.identityId,endpoint:row.endpoint,ok})}
  assert.deepEqual(candidate.assessment(),lab.assessment());clock+=101;
  assert.deepEqual(candidate.probeBatch({limit:5}),lab.probeBatch({limit:5}));
});

test('authoritative candidate fails closed, adopts stronger anchor chain, and loses readiness when anchor disappears',async context=>{
  const dir=await mkdtemp(join(tmpdir(),'fae-eclipse-auth-'));context.after(()=>rm(dir,{recursive:true,force:true}));
  const initial=legacyState(),miner=wallet();let clock=1_920_100_000_000;
  const anchorPaths={dataFile:join(dir,'anchor-state.json'),identityFile:join(dir,'anchor-id.json'),peerTrustFile:join(dir,'anchor-trust.json')};
  const anchorCold=createAuthoritativeV4PeerNode({initialState:initial,host:'127.11.0.1',...anchorPaths});await anchorCold.start();await mine(anchorCold.baseUrl(),miner.address);await mine(anchorCold.baseUrl(),miner.address);
  const anchor={endpoint:anchorCold.baseUrl(),identityId:anchorCold.identity.id,source:'out-of-band-anchor'},anchorTip=anchorCold.status().tip_hash,anchorPort=Number(new URL(anchor.endpoint).port);assert.equal(anchorCold.status().height,13);await anchorCold.close();

  const attackers=[];for(const host of['127.21.0.1','127.31.0.1','127.41.0.1']){const node=createAuthoritativeV4PeerNode({initialState:initial,host});await node.start();attackers.push(node);context.after(()=>node.close())}
  const victim=createAuthoritativeV4PeerNodeEclipseCandidate({initialState:initial,host:'127.51.0.1',knownPeers:attackers.map((node,i)=>({endpoint:node.baseUrl(),identityId:node.identity.id,source:`ordinary-${i+1}`})),pinnedPeers:[anchor],eclipseDiscoveryOptions:{now:()=>clock,failureBackoffMs:100,maxFailureBackoffMs:1000,healthyReprobeMs:10_000,maxProbeBatch:8}});
  await victim.start();context.after(()=>victim.close());
  const isolated=await victim.syncPeers();assert.equal(isolated.filter(row=>row.ok&&row.peer_id!==anchor.identityId).length,3);assert.equal(isolated.find(row=>row.peer_id===anchor.identityId)?.ok,false);
  let view=victim.status();assert.equal(view.peer_view_authority,'eclipse-resistant-candidate-v1');assert.equal(view.peer_diversity.state,'HOLD');assert.equal(view.peer_diversity.livePinned,0);assert.equal(view.peer_diversity.distinctNetworkGroups,3);assert.equal(view.height,11);

  const anchorWarm=createAuthoritativeV4PeerNode({host:'127.11.0.1',port:anchorPort,...anchorPaths});await anchorWarm.start();context.after(()=>anchorWarm.close());assert.equal(anchorWarm.identity.id,anchor.identityId);assert.equal(anchorWarm.baseUrl(),anchor.endpoint);assert.equal(anchorWarm.status().tip_hash,anchorTip);
  clock+=101;const recovered=await victim.syncPeers(),anchorRecovery=recovered.find(row=>row.peer_id===anchor.identityId);assert.equal(anchorRecovery?.ok,true);assert.equal(anchorRecovery?.adopted,true);
  view=victim.status();assert.equal(view.height,13);assert.equal(view.tip_hash,anchorTip);assert.equal(view.peer_diversity.state,'READY');assert.equal(view.peer_diversity.livePinned,1);assert.equal(view.peer_diversity.distinctNetworkGroups,4);

  await anchorWarm.close();clock+=10_001;const relost=await victim.syncPeers();assert.equal(relost.find(row=>row.peer_id===anchor.identityId)?.ok,false);
  view=victim.status();assert.equal(view.peer_diversity.state,'HOLD');assert.equal(view.peer_diversity.livePinned,0);assert.equal(view.height,13);assert.equal(view.tip_hash,anchorTip);
  console.log(JSON.stringify({ok:true,gate:'authoritative-candidate',protocol:6,parity:'frozen-gate1',offline:'HOLD',recovered:'READY',relost:'HOLD',stronger_chain_adopted:true,consensus_path:'unchanged'}));
});
