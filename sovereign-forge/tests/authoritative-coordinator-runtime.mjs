import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateKeyPairSync} from 'node:crypto';
import {encodeAddress} from '../node/authoritative/address.mjs';
import {sha256,hashHex,leadingZeroBits} from '../node/authoritative/crypto.mjs';
import {allocatePplnsOutputs} from '../node/authoritative/share-coordinator.mjs';
import {CANDIDATE_FUNCTION_PATH} from '../node/authoritative/pplns-http-adapter.mjs';
import {createShareCoordinatorRuntime} from '../node/fae-share-coordinator-v1-candidate.mjs';

const NETWORK='fairyelf-public-testnet-v4';
function wallet(){const{publicKey}=generateKeyPairSync('ed25519'),spki=publicKey.export({type:'spki',format:'der'});return encodeAddress(sha256(spki).subarray(0,20),'faet')}
function send(res,status,payload){res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(payload))}
async function readBody(req){let text='';for await(const chunk of req)text+=chunk;return text?JSON.parse(text):{}}
function findNonce(candidate,minBits,maxBits=Infinity){for(let nonce=0;nonce<2_000_000;nonce++){const hash=hashHex({...candidate.header,nonce}),bits=leadingZeroBits(hash);if(bits>=minBits&&bits<maxBits)return{nonce,hash,bits}}throw new Error('nonce search exhausted')}
async function jsonFetch(url,options={}){const response=await fetch(url,{...options,headers:{'content-type':'application/json',...(options.headers||{})}}),payload=await response.json();return{response,payload}}

function fakeBackend(){
  const state={height:343,tip_hash:'a'.repeat(64),difficulty_bits:8,activation:null,submissions:0};
  const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://backend.invalid');
    if(req.method==='GET'&&url.pathname===CANDIDATE_FUNCTION_PATH+'/status')return send(res,200,{ok:true,network:NETWORK,height:state.height,tip_hash:state.tip_hash,difficulty_bits:state.difficulty_bits,pplns_coinbase_activation_height:state.activation});
    if(req.method==='POST'&&url.pathname===CANDIDATE_FUNCTION_PATH+'/template/pplns'){
      const body=await readBody(req),weights=body.weights.map(x=>({address:String(x.address),weight:BigInt(x.weight)})),reward=1000n,fees=37n,payouts=allocatePplnsOutputs(reward+fees,weights),txids=['f'.repeat(64)],header={network:NETWORK,height:state.height+1,previous_hash:state.tip_hash,timestamp_ms:1788895000000,difficulty_bits:state.difficulty_bits,miner_address:payouts[0].address,reward_atoms:reward.toString(),fee_atoms:fees.toString(),tx_root:hashHex(txids),tx_count:1,coinbase_root:hashHex(payouts),coinbase_count:payouts.length,coinbase_mode:'pplns-direct'};
      return send(res,200,{ok:true,header,txids,payouts,coinbase_outputs:payouts});
    }
    if(req.method==='POST'&&url.pathname===CANDIDATE_FUNCTION_PATH+'/submit-block'){
      const body=await readBody(req),calculated=hashHex({...body.header,nonce:Number(body.nonce)});state.submissions++;
      if(body.header.previous_hash!==state.tip_hash)return send(res,409,{ok:false,error:'stale_tip'});
      if(calculated!==body.hash||leadingZeroBits(calculated)<state.difficulty_bits)return send(res,400,{ok:false,error:'invalid_pow'});
      state.height=Number(body.header.height);state.tip_hash=body.hash;return send(res,200,{ok:true,height:state.height,hash:state.tip_hash,tx_count:body.txids.length});
    }
    send(res,404,{ok:false,error:'not_found'});
  });
  return{state,server,async start(){await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return `http://127.0.0.1:${server.address().port}${CANDIDATE_FUNCTION_PATH}`},async close(){if(server.listening)await new Promise(resolve=>server.close(resolve))}};
}

test('standalone coordinator persists identity and share ledger while staying fail-closed before activation',async t=>{
  const backend=fakeBackend(),candidateApiUrl=await backend.start(),dataDir=await mkdtemp(join(tmpdir(),'fae-coordinator-'));t.after(async()=>{await backend.close();await rm(dataDir,{recursive:true,force:true})});
  const first=createShareCoordinatorRuntime({host:'127.0.0.1',port:0,dataDir,candidateApiUrl,publicUrl:'https://coordinator.example.test'});await first.start();
  const health=(await jsonFetch(first.baseUrl()+'/health')).payload;assert.equal(health.ok,true);assert.equal(health.mining_enabled,false);assert.equal(health.holds_payout_private_key,false);const identity=health.coordinator_id;
  const pre=await jsonFetch(first.baseUrl()+'/work',{method:'POST',body:JSON.stringify({address:wallet()})});assert.equal(pre.response.status,409);assert.match(pre.payload.error,/activation required/);
  backend.state.activation=344;const miner=wallet(),work=(await jsonFetch(first.baseUrl()+'/work',{method:'POST',body:JSON.stringify({address:miner})})).payload;assert.equal(work.ok,true);assert.equal(work.targetDifficultyBits,4);assert.equal(work.blockDifficultyBits,8);assert.equal(work.header.fee_atoms,'37');
  const shareOnly=findNonce(work,work.targetDifficultyBits,work.blockDifficultyBits),accepted=(await jsonFetch(first.baseUrl()+'/share',{method:'POST',body:JSON.stringify({jobId:work.jobId,nonce:shareOnly.nonce,hash:shareOnly.hash})})).payload;assert.equal(accepted.ok,true);assert.equal(accepted.share.seq,1);assert.equal(accepted.block,null);
  const beforeRestart=(await jsonFetch(first.baseUrl()+'/shares?limit=10')).payload;assert.equal(beforeRestart.summary.totalShares,1);const ledgerHash=beforeRestart.summary.lastEntryHash;await first.close();

  const second=createShareCoordinatorRuntime({host:'127.0.0.1',port:0,dataDir,candidateApiUrl,publicUrl:'https://coordinator.example.test'});await second.start();t.after(()=>second.close());const status=(await jsonFetch(second.baseUrl()+'/status')).payload;assert.equal(status.coordinator_id,identity);assert.equal(status.totalShares,1);assert.equal(status.lastEntryHash,ledgerHash);assert.equal(status.holds_payout_private_key,false);
  const descriptor=(await jsonFetch(second.baseUrl()+'/descriptor')).payload;assert.equal(descriptor.ok,true);assert.equal(descriptor.descriptor.kind,'coordinator-descriptor');assert.equal(descriptor.descriptor.signer.id,identity);
  const work2=(await jsonFetch(second.baseUrl()+'/work',{method:'POST',body:JSON.stringify({address:wallet()})})).payload,full=findNonce(work2,work2.blockDifficultyBits),block=(await jsonFetch(second.baseUrl()+'/share',{method:'POST',body:JSON.stringify({jobId:work2.jobId,nonce:full.nonce,hash:full.hash})})).payload;assert.equal(block.ok,true);assert.equal(block.block.ok,true);assert.equal(block.block.height,344);assert.equal(backend.state.submissions,1);
});

test('coordinator rejects stale jobs and oversized JSON without mutating the share ledger',async t=>{
  const backend=fakeBackend(),candidateApiUrl=await backend.start(),dataDir=await mkdtemp(join(tmpdir(),'fae-coordinator-'));backend.state.activation=344;const runtime=createShareCoordinatorRuntime({host:'127.0.0.1',port:0,dataDir,candidateApiUrl});await runtime.start();t.after(async()=>{await runtime.close();await backend.close();await rm(dataDir,{recursive:true,force:true})});
  const work=(await jsonFetch(runtime.baseUrl()+'/work',{method:'POST',body:JSON.stringify({address:wallet()})})).payload,share=findNonce(work,work.targetDifficultyBits);backend.state.height=344;backend.state.tip_hash='b'.repeat(64);const stale=await jsonFetch(runtime.baseUrl()+'/share',{method:'POST',body:JSON.stringify({jobId:work.jobId,nonce:share.nonce,hash:share.hash})});assert.equal(stale.response.status,409);assert.match(stale.payload.error,/Stale share job/);assert.equal((await jsonFetch(runtime.baseUrl()+'/shares')).payload.summary.totalShares,0);
  const huge=await jsonFetch(runtime.baseUrl()+'/work',{method:'POST',body:JSON.stringify({address:'x'.repeat(70_000)})});assert.equal(huge.response.status,413);assert.equal(huge.payload.error,'body_too_large');assert.equal((await jsonFetch(runtime.baseUrl()+'/shares')).payload.summary.totalShares,0);
});
