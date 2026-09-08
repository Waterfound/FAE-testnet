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
import {verifyEnvelope} from '../node/authoritative/node-identity.mjs';
import {CANDIDATE_FUNCTION_PATH} from '../node/authoritative/pplns-http-adapter.mjs';
import {createShareCoordinatorRuntime} from '../node/fae-share-coordinator-v1-candidate.mjs';

const NETWORK='fairyelf-public-testnet-v4';
function wallet(){const{publicKey}=generateKeyPairSync('ed25519'),spki=publicKey.export({type:'spki',format:'der'});return encodeAddress(sha256(spki).subarray(0,20),'faet')}
function send(res,status,payload){res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(payload))}
async function body(req){let text='';for await(const chunk of req)text+=chunk;return text?JSON.parse(text):{}}
function findShare(candidate,target,block){for(let nonce=0;nonce<2_000_000;nonce++){const hash=hashHex({...candidate.header,nonce}),bits=leadingZeroBits(hash);if(bits>=target&&bits<block)return{nonce,hash,bits}}throw Error('share search exhausted')}

function backend(){
  const state={height:20,tip:'a'.repeat(64),bits:8};
  const server=http.createServer(async(req,res)=>{const u=new URL(req.url,'http://fake');
    if(req.method==='GET'&&u.pathname===CANDIDATE_FUNCTION_PATH+'/status')return send(res,200,{ok:true,network:NETWORK,height:state.height,tip_hash:state.tip,difficulty_bits:state.bits,pplns_coinbase_activation_height:21});
    if(req.method==='POST'&&u.pathname===CANDIDATE_FUNCTION_PATH+'/template/pplns'){
      const request=await body(req),weights=request.weights.map(x=>({address:String(x.address),weight:BigInt(x.weight)})),payouts=allocatePplnsOutputs(1000n,weights),txids=[],header={network:NETWORK,height:21,previous_hash:state.tip,timestamp_ms:Date.now(),difficulty_bits:state.bits,miner_address:payouts[0].address,reward_atoms:'1000',fee_atoms:'0',tx_root:hashHex(txids),tx_count:0,coinbase_root:hashHex(payouts),coinbase_count:payouts.length,coinbase_mode:'pplns-direct'};return send(res,200,{ok:true,header,txids,payouts,coinbase_outputs:payouts});
    }
    return send(res,404,{ok:false,error:'not_found'});
  });
  return{server,async start(){await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return`http://127.0.0.1:${server.address().port}${CANDIDATE_FUNCTION_PATH}`},async close(){if(server.listening)await new Promise(resolve=>server.close(resolve))}};
}

test('HTTP coordinator signs acceptance only after durable ledger append',async t=>{
  const upstream=backend(),candidateApiUrl=await upstream.start(),dataDir=await mkdtemp(join(tmpdir(),'fae-share-receipt-')),runtime=createShareCoordinatorRuntime({host:'127.0.0.1',port:0,dataDir,candidateApiUrl,shareDifficultyDelta:4});await runtime.start();t.after(async()=>{await runtime.close();await upstream.close();await rm(dataDir,{recursive:true,force:true})});
  const address=wallet(),workResponse=await fetch(runtime.baseUrl()+'/work',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({address})}),work=await workResponse.json();assert.equal(work.ok,true);
  const solution=findShare(work,work.targetDifficultyBits,work.blockDifficultyBits),response=await fetch(runtime.baseUrl()+'/share',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jobId:work.jobId,nonce:solution.nonce,hash:solution.hash})}),accepted=await response.json();assert.equal(response.status,200);assert.equal(accepted.ok,true);assert.equal(accepted.block,null);
  const payload=verifyEnvelope(accepted.shareReceipt,{kind:'coordinator-share-acceptance',expectedSignerId:runtime.identity.id});assert.equal(payload.receiptVersion,1);assert.equal(payload.jobId,work.jobId);assert.equal(payload.address,address);assert.equal(payload.nonce,solution.nonce);assert.equal(payload.hash,solution.hash);assert.equal(payload.zeroBits,solution.bits);assert.equal(payload.seq,accepted.share.seq);assert.equal(payload.entryHash,accepted.share.entryHash);assert.equal(payload.payoutCommitment,work.payoutCommitment);assert.equal(payload.weightsCommitment,work.weightsCommitment);assert.equal(payload.templateCommitment,work.templateCommitment);assert.equal(payload.blockAccepted,false);
  const persisted=runtime.getCoordinator?await runtime.getCoordinator():null;assert.ok(persisted);const entry=persisted.ledger.shares[payload.seq-1];assert.equal(entry.entryHash,payload.entryHash);assert.equal(entry.hash,payload.hash);assert.equal(entry.nonce,payload.nonce);
  const tampered=structuredClone(accepted.shareReceipt);tampered.payload.nonce++;assert.throws(()=>verifyEnvelope(tampered,{kind:'coordinator-share-acceptance',expectedSignerId:runtime.identity.id}));
});
