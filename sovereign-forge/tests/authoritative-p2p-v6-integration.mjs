import assert from 'node:assert/strict';
import test from 'node:test';
import {generateKeyPairSync,sign as nodeSign} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {legacyBlocks} from './legacy-testnet-fixture.mjs';
import {createAuthoritativeV4PeerNode} from '../node/authoritative/fae-v4-peer-node.mjs';
import {emptyState,appendBlockFromFeed,NETWORK} from '../node/authoritative/fae-v4-core.mjs';
import {encodeAddress} from '../node/authoritative/address.mjs';
import {hashHex,leadingZeroBits,sha256} from '../node/authoritative/crypto.mjs';
import {stableStringify} from '../node/authoritative/canonical.mjs';

function wallet(){const{privateKey,publicKey}=generateKeyPairSync('ed25519'),spki=publicKey.export({type:'spki',format:'der'});return{privateKey,pub:spki.toString('base64'),address:encodeAddress(sha256(spki).subarray(0,20),'faet')}}
function signedTx(from,inputs,outputs){const unsigned={version:2,network:NETWORK,inputs,outputs,public_key_spki:from.pub},payload={domain:'FAIRYELF_TX_V2',network:NETWORK,inputs,outputs,public_key_spki:from.pub},signature=nodeSign(null,Buffer.from(stableStringify(payload)),from.privateKey).toString('base64');return{...unsigned,signature}}
async function json(url,options={}){const response=await fetch(url,options),body=await response.json();if(!response.ok)throw new Error(`${response.status} ${url}: ${JSON.stringify(body)}`);return body}
async function mine(base,address){const template=await json(`${base}/template?address=${encodeURIComponent(address)}`);let nonce=0,hash='';for(;nonce<10_000_000;nonce++){hash=hashHex({...template.header,nonce});if(leadingZeroBits(hash)>=template.header.difficulty_bits)break}if(nonce>=10_000_000)throw new Error('PoW search exhausted');const block={header:template.header,nonce,hash,txids:template.txids||[],coinbase_outputs:template.coinbase_outputs??null};await json(`${base}/submit-block`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(block)});return block}
async function submitBlock(base,block){return json(`${base}/submit-block`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(block)})}
async function submitTx(base,tx){return json(`${base}/submit-tx`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({tx})})}
function legacyState(){let state=emptyState();for(const block of legacyBlocks)state=appendBlockFromFeed(state,block,new Map(),{activationHeight:null});return state}
function findTx(state,txid){return state.transactions[txid]??null}

test('Authoritative protocol 6 performs encrypted headers-first recovery and repropagates detached transactions',async context=>{
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

  const recovery=await a.syncPeer(b.baseUrl());
  assert.equal(recovery.adopted,true);assert.equal(recovery.headers_validated,2);assert.equal(recovery.blocks_downloaded,2);assert.equal(recovery.reaccepted,1);assert.equal(recovery.repropagated,1);
  assert.equal(a.status().height,14);assert.equal(a.status().tip_hash,b.status().tip_hash);assert.equal(a.status().mempool_size,1);assert.equal(findTx(a.getState(),txid)?.status,'pending');
  assert.equal(b.status().mempool_size,1,'recovered transaction must be repropagated to the winning peer');assert.equal(findTx(b.getState(),txid)?.status,'pending');
  const trustAfterFirst=a.trust.list().peers[b.baseUrl()];assert.equal(trustAfterFirst.identityId,b.identity.id);assert.ok(trustAfterFirst.observations>=1);

  const finalBlock=await mine(a.baseUrl(),miner.address);assert.ok(finalBlock.txids.includes(txid));assert.equal(a.status().height,15);assert.equal(findTx(a.getState(),txid)?.confirmed_height,15);

  const bCatchup=await b.syncPeer(a.baseUrl()),cCatchup=await c.syncPeer(a.baseUrl());assert.equal(bCatchup.adopted,true);assert.equal(cCatchup.adopted,true);
  for(const node of[a,b,c]){assert.equal(node.status().height,15);assert.equal(node.status().tip_hash,a.status().tip_hash);const record=findTx(node.getState(),txid);assert.equal(record?.status,'confirmed');assert.equal(record?.confirmed_height,15)}

  const aIdentity=a.identity.id;await a.close();
  const restarted=createAuthoritativeV4PeerNode({dataFile:join(dir,'a-state.json'),identityFile:join(dir,'a-id.json'),peerTrustFile:join(dir,'a-trust.json'),peers:[b.baseUrl()]});await restarted.start();context.after(()=>restarted.close());
  assert.equal(restarted.identity.id,aIdentity);assert.equal(restarted.status().tip_hash,b.status().tip_hash);assert.equal(restarted.trust.list().peers[b.baseUrl()].identityId,b.identity.id);

  console.log(JSON.stringify({ok:true,protocol:6,nodes:3,height:15,headers_first:true,common_ancestor:12,recovered_txid:txid,repropagated:true,reconfirmed_height:15,persistent_identity:true,tofu_continuity:true}));
});
