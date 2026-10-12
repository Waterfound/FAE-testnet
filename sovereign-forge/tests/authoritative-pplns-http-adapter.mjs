import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import {generateKeyPairSync} from 'node:crypto';
import {encodeAddress} from '../node/authoritative/address.mjs';
import {sha256,hashHex,leadingZeroBits} from '../node/authoritative/crypto.mjs';
import {allocatePplnsOutputs} from '../node/authoritative/share-coordinator.mjs';
import {AuthoritativePplnsHttpAdapter,CANDIDATE_FUNCTION_PATH} from '../node/authoritative/pplns-http-adapter.mjs';

const NETWORK='fairyelf-public-testnet-v4';
function wallet(){const {publicKey}=generateKeyPairSync('ed25519'),spki=publicKey.export({type:'spki',format:'der'});return{address:encodeAddress(sha256(spki).subarray(0,20),'faet')}}
function json(res,status,body){res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(body))}
async function body(req){let text='';for await(const chunk of req)text+=chunk;return text?JSON.parse(text):{}}
function findNonce(candidate,minBits,maxBits=Infinity){for(let nonce=0;nonce<2_000_000;nonce++){const hash=hashHex({...candidate.header,nonce}),bits=leadingZeroBits(hash);if(bits>=minBits&&bits<maxBits)return{nonce,hash,bits}}throw new Error('nonce search exhausted')}

function fakeCandidateServer(){
  const state={height:343,tip_hash:'a'.repeat(64),difficulty_bits:8,activation:null,templateRequests:0,submitRequests:0,lastSubmission:null};
  const server=http.createServer(async(req,res)=>{
    try{
      const url=new URL(req.url,'http://localhost');
      if(req.method==='GET'&&url.pathname===CANDIDATE_FUNCTION_PATH+'/status')return json(res,200,{ok:true,node_version:'authoritative-candidate-v1',network:NETWORK,height:state.height,tip_hash:state.tip_hash,difficulty_bits:state.difficulty_bits,target_seconds:180,issued_atoms:'343000000000',pplns_coinbase_activation_height:state.activation,coinbase_policy:state.activation===null?'candidate-inactive':'activation-configured'});
      if(req.method==='POST'&&url.pathname===CANDIDATE_FUNCTION_PATH+'/template/pplns'){
        state.templateRequests++;const request=await body(req),weights=request.weights.map(w=>({address:String(w.address),weight:BigInt(w.weight)}));
        const reward=1000n,fees=37n,payouts=allocatePplnsOutputs(reward+fees,weights),txids=['f'.repeat(64)],header={network:NETWORK,height:state.height+1,previous_hash:state.tip_hash,timestamp_ms:1788895000000,difficulty_bits:state.difficulty_bits,miner_address:payouts[0].address,reward_atoms:reward.toString(),fee_atoms:fees.toString(),tx_root:hashHex(txids),tx_count:txids.length,coinbase_root:hashHex(payouts),coinbase_count:payouts.length,coinbase_mode:'pplns-direct'};
        return json(res,200,{ok:true,template_policy:'snapshot',header,txids,coinbase_outputs:payouts,payouts});
      }
      if(req.method==='POST'&&url.pathname===CANDIDATE_FUNCTION_PATH+'/submit-block'){
        state.submitRequests++;const submission=await body(req);state.lastSubmission=submission;
        if(submission.header.previous_hash!==state.tip_hash)return json(res,409,{ok:false,error:'stale_tip'});
        const calculated=hashHex({...submission.header,nonce:Number(submission.nonce)});if(calculated!==submission.hash||leadingZeroBits(calculated)<state.difficulty_bits)return json(res,400,{ok:false,error:'invalid proof of work'});
        state.height=Number(submission.header.height);state.tip_hash=submission.hash;return json(res,200,{ok:true,height:state.height,hash:state.tip_hash,tx_count:submission.txids.length});
      }
      return json(res,404,{ok:false,error:'not_found'});
    }catch(error){return json(res,500,{ok:false,error:error.message})}
  });
  return{state,server,async start(){await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();return `http://127.0.0.1:${address.port}${CANDIDATE_FUNCTION_PATH}`},async close(){if(server.listening)await new Promise(resolve=>server.close(resolve))}};
}

test('PPLNS HTTP adapter refuses the active-v4 endpoint path',()=>{
  assert.throws(()=>new AuthoritativePplnsHttpAdapter({baseUrl:'https://example.invalid/functions/v1/fae-public-testnet-v4'}),/Authoritative candidate endpoint/);
});

test('PPLNS HTTP coordinator remains fail-closed while activation is null',async t=>{
  const fake=fakeCandidateServer();t.after(()=>fake.close());const baseUrl=await fake.start(),alice=wallet(),adapter=new AuthoritativePplnsHttpAdapter({baseUrl}),coordinator=await adapter.createCoordinator({shareDifficultyDelta:4});
  const status=await coordinator.status();assert.equal(status.activation,'candidate-awaiting-multi-output-coinbase');assert.equal(await adapter.activationReady(),false);
  await assert.rejects(coordinator.createWork(alice.address),/activation required/);assert.equal(fake.state.templateRequests,0,'activation null must fail before requesting a PPLNS template');
});

test('PPLNS HTTP adapter runs subsidy-plus-fees share round through submit-block after activation',async t=>{
  const fake=fakeCandidateServer();t.after(()=>fake.close());const baseUrl=await fake.start(),alice=wallet(),bob=wallet(),adapter=new AuthoritativePplnsHttpAdapter({baseUrl}),coordinator=await adapter.createCoordinator({shareDifficultyDelta:4,windowSize:32});fake.state.activation=344;
  assert.equal(await adapter.activationReady(),true);
  const first=await coordinator.createWork(alice.address);assert.equal(first.header.height,344);assert.equal(first.header.reward_atoms,'1000');assert.equal(first.header.fee_atoms,'37');assert.equal(first.payouts.reduce((sum,o)=>sum+BigInt(o.amount_atoms),0n),1037n);
  const shareOnly=findNonce(first,first.targetDifficultyBits,first.blockDifficultyBits),shareResult=await coordinator.submitShare({jobId:first.jobId,nonce:shareOnly.nonce,hash:shareOnly.hash});assert.equal(shareResult.block,null);assert.equal(shareResult.share.seq,1);
  const second=await coordinator.createWork(bob.address);assert.equal(second.payouts[0].address,alice.address,'PPLNS window must control direct payout');assert.equal(second.payouts.reduce((sum,o)=>sum+BigInt(o.amount_atoms),0n),1037n);
  const full=findNonce(second,second.blockDifficultyBits),blockResult=await coordinator.submitShare({jobId:second.jobId,nonce:full.nonce,hash:full.hash});assert.equal(blockResult.block.ok,true);assert.equal(blockResult.block.height,344);assert.equal(blockResult.block.hash,full.hash);assert.equal(fake.state.submitRequests,1);
  assert.deepEqual(fake.state.lastSubmission.coinbase_outputs,second.coinbase_outputs);assert.equal(fake.state.lastSubmission.header.coinbase_mode,'pplns-direct');assert.equal(fake.state.lastSubmission.header.fee_atoms,'37');assert.equal(fake.state.height,344);assert.equal(fake.state.tip_hash,full.hash);
});

test('PPLNS HTTP coordinator rejects a stale job before block submission',async t=>{
  const fake=fakeCandidateServer();t.after(()=>fake.close());const baseUrl=await fake.start(),alice=wallet(),adapter=new AuthoritativePplnsHttpAdapter({baseUrl}),coordinator=await adapter.createCoordinator({shareDifficultyDelta:4});fake.state.activation=344;
  const work=await coordinator.createWork(alice.address),share=findNonce(work,work.targetDifficultyBits);fake.state.height=344;fake.state.tip_hash='b'.repeat(64);
  await assert.rejects(coordinator.submitShare({jobId:work.jobId,nonce:share.nonce,hash:share.hash}),/Stale share job/);assert.equal(fake.state.submitRequests,0);
});

test('PPLNS HTTP adapter rejects malformed payout commitments from candidate backend',async t=>{
  const fake=fakeCandidateServer();t.after(()=>fake.close());const baseUrl=await fake.start(),alice=wallet(),adapter=new AuthoritativePplnsHttpAdapter({baseUrl});fake.state.activation=344;
  const original=fake.server.listeners('request')[0];fake.server.removeAllListeners('request');fake.server.on('request',async(req,res)=>{
    const url=new URL(req.url,'http://localhost');if(req.method==='GET'&&url.pathname===CANDIDATE_FUNCTION_PATH+'/status')return json(res,200,{ok:true,network:NETWORK,height:343,tip_hash:'a'.repeat(64),difficulty_bits:8,pplns_coinbase_activation_height:344});
    if(req.method==='POST'&&url.pathname===CANDIDATE_FUNCTION_PATH+'/template/pplns'){const request=await body(req),payouts=allocatePplnsOutputs(1037n,request.weights.map(w=>({address:w.address,weight:BigInt(w.weight)}))),txids=['f'.repeat(64)],header={network:NETWORK,height:344,previous_hash:'a'.repeat(64),timestamp_ms:1,difficulty_bits:8,miner_address:payouts[0].address,reward_atoms:'1000',fee_atoms:'37',tx_root:hashHex(txids),tx_count:1,coinbase_root:'0'.repeat(64),coinbase_count:payouts.length,coinbase_mode:'pplns-direct'};return json(res,200,{ok:true,header,txids,payouts,coinbase_outputs:payouts})}
    return original(req,res);
  });
  await assert.rejects(adapter.distributedTemplate({weights:[{address:alice.address,weight:'1'}]}),/coinbase root mismatch/);
});
