import assert from 'node:assert/strict';
import test from 'node:test';
import {generateKeyPairSync} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {legacyBlocks} from './legacy-testnet-fixture.mjs';
import {createAuthoritativeV4PeerNode} from '../node/authoritative/fae-v4-peer-node.mjs';
import {emptyState,appendBlockFromFeed} from '../node/authoritative/fae-v4-core.mjs';
import {encodeAddress} from '../node/authoritative/address.mjs';
import {hashHex,leadingZeroBits,sha256} from '../node/authoritative/crypto.mjs';
import {createPeerIsolationProtocol6Candidate} from '../node/lab/peer-isolation-protocol6-candidate.mjs';

function legacyState(){let state=emptyState();for(const block of legacyBlocks)state=appendBlockFromFeed(state,block,new Map(),{activationHeight:null});return state}
function wallet(){const{publicKey}=generateKeyPairSync('ed25519'),spki=publicKey.export({type:'spki',format:'der'});return{address:encodeAddress(sha256(spki).subarray(0,20),'faet')}}
async function json(url,options={}){const response=await fetch(url,options),body=await response.json();if(!response.ok)throw new Error(`${response.status} ${url}: ${JSON.stringify(body)}`);return body}
async function mine(base,address){const template=await json(`${base}/template?address=${encodeURIComponent(address)}`);let nonce=0,hash='';for(;nonce<10_000_000;nonce++){hash=hashHex({...template.header,nonce});if(leadingZeroBits(hash)>=template.header.difficulty_bits)break}if(nonce>=10_000_000)throw new Error('PoW search exhausted');await json(`${base}/submit-block`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({header:template.header,nonce,hash,txids:template.txids||[],coinbase_outputs:template.coinbase_outputs??null})});return hash}

test('protocol-6 victim fails closed under ordinary-peer eclipse pressure and recovers through the pinned anchor',async context=>{
  const dir=await mkdtemp(join(tmpdir(),'fae-eclipse-g2-'));context.after(()=>rm(dir,{recursive:true,force:true}));
  const initial=legacyState(),miner=wallet();let clock=1_910_000_000_000;

  const anchorPaths={dataFile:join(dir,'anchor-state.json'),identityFile:join(dir,'anchor-id.json'),peerTrustFile:join(dir,'anchor-trust.json')};
  const anchorCold=createAuthoritativeV4PeerNode({initialState:initial,host:'127.10.0.1',...anchorPaths});
  await anchorCold.start();
  await mine(anchorCold.baseUrl(),miner.address);await mine(anchorCold.baseUrl(),miner.address);
  assert.equal(anchorCold.status().height,13);
  const anchorEndpoint=anchorCold.baseUrl(),anchorIdentity=anchorCold.identity.id,anchorTip=anchorCold.status().tip_hash,anchorPort=Number(new URL(anchorEndpoint).port);
  await anchorCold.close();

  const attackerHosts=['127.20.0.1','127.30.0.1','127.40.0.1'],attackers=[];
  for(let i=0;i<attackerHosts.length;i++){
    const node=createAuthoritativeV4PeerNode({initialState:initial,host:attackerHosts[i]});await node.start();attackers.push(node);context.after(()=>node.close());
  }
  assert.ok(attackers.every(node=>node.status().height===11));

  const knownPeers=attackers.map((node,index)=>({endpoint:node.baseUrl(),identityId:node.identity.id,source:`ordinary-${index+1}`}));
  const victim=createPeerIsolationProtocol6Candidate({
    initialState:initial,host:'127.50.0.1',
    knownPeers,pinnedPeers:[{endpoint:anchorEndpoint,identityId:anchorIdentity,source:'out-of-band-anchor'}],
    discoveryOptions:{now:()=>clock,failureBackoffMs:100,maxFailureBackoffMs:1000,healthyReprobeMs:10_000,maxProbeBatch:8}
  });
  await victim.start();context.after(()=>victim.close());

  const isolated=await victim.syncPeers();
  const anchorFailure=isolated.find(row=>row.peer_id===anchorIdentity);assert.ok(anchorFailure);assert.equal(anchorFailure.ok,false,'offline anchor must fail its real protocol-6 probe');
  assert.equal(isolated.filter(row=>row.ok&&row.peer_id!==anchorIdentity).length,3,'all three ordinary peers remain reachable');
  const held=victim.status().eclipse_resistance;
  assert.equal(held.state,'HOLD');assert.equal(held.ready,false);assert.equal(held.livePinned,0);
  assert.equal(held.distinctIdentities,3);assert.equal(held.distinctNetworkGroups,3,'ordinary peers span three apparent network groups');
  assert.ok(held.violations.some(v=>v.code==='insufficient_out_of_band_anchors'));
  assert.equal(victim.status().height,11,'ordinary population must not invent progress while honest stronger view is isolated');

  const anchorWarm=createAuthoritativeV4PeerNode({host:'127.10.0.1',port:anchorPort,...anchorPaths});
  await anchorWarm.start();context.after(()=>anchorWarm.close());
  assert.equal(anchorWarm.identity.id,anchorIdentity,'reconnected anchor preserves its cryptographic identity');
  assert.equal(anchorWarm.baseUrl(),anchorEndpoint,'reconnected anchor returns on the same out-of-band endpoint');
  assert.equal(anchorWarm.status().tip_hash,anchorTip);assert.equal(anchorWarm.status().height,13);

  clock+=101;
  const recovered=await victim.syncPeers(),anchorRecovery=recovered.find(row=>row.peer_id===anchorIdentity);assert.ok(anchorRecovery);assert.equal(anchorRecovery.ok,true);assert.equal(anchorRecovery.adopted,true,'fresh authenticated anchor session exposes and transfers the stronger valid chain');
  assert.equal(victim.status().height,13);assert.equal(victim.status().tip_hash,anchorTip);
  const ready=victim.status().eclipse_resistance;assert.equal(ready.ready,true);assert.equal(ready.state,'READY');assert.equal(ready.livePinned,1);assert.equal(ready.distinctNetworkGroups,4);

  await anchorWarm.close();
  clock+=10_001;
  const relost=await victim.syncPeers(),secondFailure=relost.find(row=>row.peer_id===anchorIdentity);assert.ok(secondFailure);assert.equal(secondFailure.ok,false);
  const degraded=victim.status().eclipse_resistance;assert.equal(degraded.ready,false);assert.equal(degraded.state,'HOLD');assert.equal(degraded.livePinned,0,'readiness must not remain sticky after anchor loss');
  assert.equal(victim.status().height,13,'chain state remains valid while network-view readiness degrades independently');

  console.log(JSON.stringify({ok:true,gate:2,protocol:6,ordinary_peers:3,ordinary_network_groups:3,pinned_anchor:true,offline_state:'HOLD',fresh_session_recovery:true,stronger_chain_adopted:true,recovered_height:13,post_disconnect_state:'HOLD',sticky_readiness:false}));
});
