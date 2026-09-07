import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import {generateKeyPairSync,sign as nodeSign} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {legacyBlocks} from './legacy-testnet-fixture.mjs';
import {CANONICAL_GENESIS_HASH,createAuthoritativeV4PeerNode} from '../node/authoritative/fae-v4-peer-node.mjs';
import {emptyState,appendBlockFromFeed,NETWORK} from '../node/authoritative/fae-v4-core.mjs';
import {encodeAddress} from '../node/authoritative/address.mjs';
import {hashHex,leadingZeroBits,sha256} from '../node/authoritative/crypto.mjs';
import {stableStringify} from '../node/authoritative/canonical.mjs';
import {generateNodeIdentity,signEnvelope} from '../node/authoritative/node-identity.mjs';
import {createPeerDescriptor} from '../node/authoritative/peer-directory.mjs';

function wallet(){const{privateKey,publicKey}=generateKeyPairSync('ed25519'),spki=publicKey.export({type:'spki',format:'der'});return{privateKey,pub:spki.toString('base64'),address:encodeAddress(sha256(spki).subarray(0,20),'faet')}}
function signedTx(from,inputs,outputs){const unsigned={version:2,network:NETWORK,inputs,outputs,public_key_spki:from.pub},payload={domain:'FAIRYELF_TX_V2',network:NETWORK,inputs,outputs,public_key_spki:from.pub},signature=nodeSign(null,Buffer.from(stableStringify(payload)),from.privateKey).toString('base64');return{...unsigned,signature}}
async function json(url,options={}){const response=await fetch(url,options),body=await response.json();if(!response.ok)throw new Error(`${response.status} ${url}: ${JSON.stringify(body)}`);return body}
async function mine(base,address){const template=await json(`${base}/template?address=${encodeURIComponent(address)}`);let nonce=0,hash='';for(;nonce<10_000_000;nonce++){hash=hashHex({...template.header,nonce});if(leadingZeroBits(hash)>=template.header.difficulty_bits)break}if(nonce>=10_000_000)throw new Error('PoW search exhausted');const block={header:template.header,nonce,hash,txids:template.txids||[],coinbase_outputs:template.coinbase_outputs??null};await json(`${base}/submit-block`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(block)});return block}
async function submitBlock(base,block){return json(`${base}/submit-block`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(block)})}
async function submitTx(base,tx){return json(`${base}/submit-tx`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({tx})})}
function legacyState(){let state=emptyState();for(const block of legacyBlocks)state=appendBlockFromFeed(state,block,new Map(),{activationHeight:null});return state}
function findTx(state,txid){return state.transactions[txid]??null}

test('Authoritative protocol 6 performs encrypted headers-first recovery, authenticated discovery and repropagates detached transactions',async context=>{
  const dir=await mkdtemp(join(tmpdir(),'fae-p2pv6-'));context.after(()=>rm(dir,{recursive:true,force:true}));
  const baseState=legacyState(),miner=wallet(),recipient=wallet();
  const b=createAuthoritativeV4PeerNode({initialState:baseState,dataFile:join(dir,'b-state.json'),identityFile:join(dir,'b-id.json'),peerTrustFile:join(dir,'b-trust.json')});
  const c=createAuthoritativeV4PeerNode({initialState:baseState,dataFile:join(dir,'c-state.json'),identityFile:join(dir,'c-id.json'),peerTrustFile:join(dir,'c-trust.json')});
  const a=createAuthoritativeV4PeerNode({initialState:baseState,dataFile:join(dir,'a-state.json'),identityFile:join(dir,'a-id.json'),peerTrustFile:join(dir,'a-trust.json')});
  await a.start();await b.start();await c.start();context.after(()=>a.close());context.after(()=>b.close());context.after(()=>c.close());

  const common=await mine(a.baseUrl(),miner.address);await submitBlock(b.baseUrl(),common);await submitBlock(c.baseUrl(),common);
  assert.equal(a.status().height,12);assert.equal(b.status().height,12);assert.equal(c.status().height,12);

  const tx=signedTx(miner,[`${common.hash}:0`],[{address:recipient.address,amount_atoms:'100000000'},{address:miner.address,amount_atoms:'899999000'}]);
  const accepted=await submitTx(a.baseUrl(),tx),txid=hashHex(tx);assert.equal(accepted.txid,txid);assert.equal(accepted.fee_atoms,'1000');assert.equal(b.status().mempool_size,0,'partitioned peer must not receive the original transaction');
  const orphan=await mine(a.baseUrl(),miner.address);assert.ok(orphan.txids.includes(txid));assert.equal(findTx(a.getState(),txid)?.status,'confirmed');

  await mine(b.baseUrl(),miner.address);await mine(b.baseUrl(),miner.address);assert.equal(b.status().height,14);assert.notEqual(a.status().tip_hash,b.status().tip_hash);

  const cDescriptor=createPeerDescriptor(c.identity,{networkId:NETWORK,endpoint:c.baseUrl(),capabilities:['headers-first','encrypted-peer-channel-v1']});
  b.directory.register(cDescriptor,{source:'integration-test'});

  const recovery=await a.syncPeer(b.baseUrl());
  assert.equal(recovery.adopted,true);assert.equal(recovery.headers_validated,2);assert.equal(recovery.blocks_downloaded,2);assert.equal(recovery.reaccepted,1);assert.equal(recovery.repropagated,1);
  assert.equal(a.status().height,14);assert.equal(a.status().tip_hash,b.status().tip_hash);assert.equal(a.status().mempool_size,1);assert.equal(findTx(a.getState(),txid)?.status,'pending');
  assert.equal(b.status().mempool_size,1,'recovered transaction must be repropagated to the winning peer');assert.equal(findTx(b.getState(),txid)?.status,'pending');
  const trustAfterFirst=a.trust.list().peers[b.baseUrl()];assert.equal(trustAfterFirst.identityId,b.identity.id);assert.ok(trustAfterFirst.observations>=1);

  const discovered=a.directory.observations().find(row=>row.identityId===c.identity.id);assert.ok(discovered,'signed peer descriptor should gossip through the secure peer channel');assert.equal(discovered.descriptorOnly,true);assert.equal(a.authenticatedPeerObservations().some(row=>row.identityId===c.identity.id),false,'descriptor must not count as authenticated before hello');
  const syncCycle=await a.syncPeers();
  if(!a.authenticatedPeerObservations().some(row=>row.identityId===c.identity.id)){
    let directResult=null,directError=null;try{directResult=await a.syncPeer(discovered.endpoint,{source:'diagnostic-descriptor',expectedIdentityId:discovered.identityId})}catch(error){directError=error.message}
    assert.fail(`automatic descriptor authentication failed: ${JSON.stringify({discovered,syncCycle,directResult,directError,authenticated:a.authenticatedPeerObservations(),directory:a.directory.observations()})}`);
  }
  assert.equal(a.status().peer_diversity.distinctIdentities,2);assert.equal(a.status().peer_diversity.distinctNetworkGroups,1);assert.equal(a.status().peer_diversity.ready,false,'two loopback peers in one /24 must not claim eclipse diversity readiness');

  const finalBlock=await mine(a.baseUrl(),miner.address);assert.ok(finalBlock.txids.includes(txid));assert.equal(a.status().height,15);assert.equal(findTx(a.getState(),txid)?.confirmed_height,15);

  const bCatchup=await b.syncPeer(a.baseUrl()),cCatchup=await c.syncPeer(a.baseUrl());assert.equal(bCatchup.adopted,true);assert.equal(cCatchup.adopted,true);
  for(const node of[a,b,c]){assert.equal(node.status().height,15);assert.equal(node.status().tip_hash,a.status().tip_hash);const record=findTx(node.getState(),txid);assert.equal(record?.status,'confirmed');assert.equal(record?.confirmed_height,15)}

  const fresh=createAuthoritativeV4PeerNode({dataFile:join(dir,'fresh-state.json'),identityFile:join(dir,'fresh-id.json'),peerTrustFile:join(dir,'fresh-trust.json')});await fresh.start();context.after(()=>fresh.close());
  assert.equal(fresh.status().height,0);assert.equal(fresh.status().genesis_hash,CANONICAL_GENESIS_HASH);
  const bootstrap=await fresh.syncPeer(a.baseUrl());assert.equal(bootstrap.adopted,true);assert.equal(bootstrap.headers_validated,15);assert.equal(bootstrap.blocks_downloaded,15);assert.equal(fresh.status().height,15);assert.equal(fresh.status().tip_hash,a.status().tip_hash);assert.equal(findTx(fresh.getState(),txid)?.confirmed_height,15);

  const aIdentity=a.identity.id;await a.close();
  const restarted=createAuthoritativeV4PeerNode({dataFile:join(dir,'a-state.json'),identityFile:join(dir,'a-id.json'),peerTrustFile:join(dir,'a-trust.json'),peers:[b.baseUrl()]});await restarted.start();context.after(()=>restarted.close());
  assert.equal(restarted.identity.id,aIdentity);assert.equal(restarted.status().tip_hash,b.status().tip_hash);assert.equal(restarted.trust.list().peers[b.baseUrl()].identityId,b.identity.id);

  console.log(JSON.stringify({ok:true,protocol:6,nodes:4,height:15,headers_first:true,common_ancestor:12,fresh_bootstrap:true,canonical_genesis:CANONICAL_GENESIS_HASH,authenticated_descriptor_discovery:true,peer_diversity_integrated:true,recovered_txid:txid,repropagated:true,reconfirmed_height:15,persistent_identity:true,tofu_continuity:true}));
});

test('fresh node rejects an authenticated peer that advertises a non-canonical genesis before opening the secure bootstrap channel',async context=>{
  const identity=generateNodeIdentity(),wrongGenesis='f'.repeat(64);
  const server=http.createServer((req,res)=>{const url=new URL(req.url,'http://localhost');if(req.method==='GET'&&url.pathname==='/peer/hello'){const challenge=url.searchParams.get('challenge')||'';const envelope=signEnvelope(identity,'peer-hello',{challenge,software:'fairyelf',protocol_version:6,network:NETWORK,genesis:wrongGenesis,height:11,tip_hash:'e'.repeat(64),chain_work:'2883584',capabilities:['headers-first']});res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify(envelope))}res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:'secure_channel_should_not_be_reached'}))});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));context.after(()=>new Promise(resolve=>server.close(resolve)));
  const address=server.address(),base=`http://127.0.0.1:${address.port}`;
  const fresh=createAuthoritativeV4PeerNode();await fresh.start();context.after(()=>fresh.close());
  await assert.rejects(fresh.syncPeer(base),/peer_genesis_mismatch/);assert.equal(fresh.status().height,0);assert.equal(fresh.trust.list().peers[base],undefined,'wrong-genesis peer must not enter TOFU trust store');
});
