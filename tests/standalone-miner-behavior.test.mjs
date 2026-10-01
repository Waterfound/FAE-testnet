'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  normalizeNodeEndpoint, parseArgs, readConfig, resolveOptions, runMiner, saveConfig
} from '../standalone/fae-miner.mjs';
import {
  NETWORK, doubleHashHex, hashHeaderNonce, workMeetsTarget
} from '../standalone/mining-core.mjs';

const address='faet1z5g4r8qgv29jcy350mvxgr3hpk35vjhdk3s6fn';
const ZERO='0'.repeat(64);

function makeTemplate({height,previousHash,difficulty}){
  const txids=[];
  return{
    ok:true,
    template_policy:'snapshot',
    header:{
      network:NETWORK,
      height,
      previous_hash:previousHash,
      timestamp_ms:1770000000000+height,
      difficulty_bits:difficulty,
      miner_address:address,
      reward_atoms:'1000000000',
      tx_root:doubleHashHex(txids),
      tx_count:0
    },
    txids
  };
}
function listen(handler){
  const server=http.createServer(handler);
  return new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(0,'127.0.0.1',()=>resolve({
      server,
      base:`http://127.0.0.1:${server.address().port}`
    }));
  });
}
function close(server){return new Promise(resolve=>server.close(resolve))}
async function jsonBody(req){
  let body='';
  for await(const chunk of req)body+=chunk;
  return body?JSON.parse(body):{};
}
function send(res,status,payload){
  res.writeHead(status,{'content-type':'application/json'});
  res.end(JSON.stringify(payload));
}
function options(base,overrides={}){
  return{
    node:base,address,chunkSize:8,tipPollMs:0,reconnectMinMs:10,reconnectMaxMs:20,
    rateIntervalMs:100000,yieldMs:0,nonceStart:0,once:true,json:false,...overrides
  };
}

test('remote plaintext endpoints fail closed while loopback HTTP remains usable',()=>{
  assert.equal(normalizeNodeEndpoint('http://127.0.0.1:8787'),'http://127.0.0.1:8787');
  assert.equal(normalizeNodeEndpoint('https://node.example/'),'https://node.example');
  assert.throws(()=>normalizeNodeEndpoint('http://node.example'),/HTTPS/);
  assert.throws(()=>normalizeNodeEndpoint('https://user:pass@node.example'),/credentials/);
});


test('invalid reward address is rejected before any node request',()=>{
  const args=parseArgs(['--node','http://127.0.0.1:8787','--address','faet1invalid']);
  assert.throws(()=>resolveOptions(args,{}),/Invalid FAE reward address/);
});

test('malformed template fails closed without block submission',async()=>{
  let submissions=0;
  const {server,base}=await listen(async(req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1');
    if(url.pathname==='/status')return send(res,200,{ok:true,network:NETWORK,height:0,tip_hash:ZERO});
    if(url.pathname==='/template'){
      const malformed=makeTemplate({height:1,previousHash:ZERO,difficulty:1});
      malformed.header.network='wrong-network';
      return send(res,200,malformed);
    }
    if(url.pathname==='/submit-block'){submissions++;return send(res,200,{ok:true})}
    send(res,404,{ok:false,error:'not_found'});
  });
  try{
    await assert.rejects(()=>runMiner(options(base),{emit:()=>{}}),/TEMPLATE_NETWORK_MISMATCH/);
    assert.equal(submissions,0);
  }finally{
    await close(server);
  }
});

test('secret-free config persists only public miner settings',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'fae-miner-config-'));
  const file=join(dir,'miner.json');
  try{
    const configOptions=options('http://127.0.0.1:8787',{chunkSize:64,tipPollMs:500});
    await saveConfig(file,configOptions);
    const parsed=JSON.parse(await readFile(file,'utf8'));
    assert.equal(parsed.node,configOptions.node);
    assert.equal(parsed.address,address);
    assert.deepEqual(Object.keys(parsed).sort(),[
      'address','chunk_size','node','rate_interval_ms','reconnect_max_ms',
      'reconnect_min_ms','tip_poll_ms','yield_ms'
    ]);
    const loaded=await readConfig(file);
    assert.equal(loaded.address,address);

    const forbidden=join(dir,'forbidden.json');
    await writeFile(forbidden,JSON.stringify({node:configOptions.node,address,private_key:'forbidden'}));
    await assert.rejects(()=>readConfig(forbidden),/Forbidden secret-bearing config field/);
  }finally{
    await rm(dir,{recursive:true,force:true});
  }
});

test('stale template is abandoned and replaced before any stale submission',async()=>{
  let tipHeight=0,tipHash=ZERO,templateCalls=0,statusCalls=0,submissions=0;
  const events=[];
  const {server,base}=await listen(async(req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1');
    if(url.pathname==='/status'){
      statusCalls++;
      if(templateCalls===1&&statusCalls>=2){tipHeight=1;tipHash='1'.repeat(64)}
      return send(res,200,{ok:true,network:NETWORK,height:tipHeight,tip_hash:tipHash});
    }
    if(url.pathname==='/template'){
      templateCalls++;
      return send(res,200,makeTemplate({
        height:tipHeight+1,
        previousHash:tipHash,
        difficulty:templateCalls===1?64:1
      }));
    }
    if(url.pathname==='/submit-block'&&req.method==='POST'){
      submissions++;
      const body=await jsonBody(req);
      assert.equal(body.header.height,2);
      assert.equal(body.header.previous_hash,'1'.repeat(64));
      assert.equal(hashHeaderNonce(body.header,body.nonce),body.hash);
      assert.equal(workMeetsTarget(body.hash,body.header.difficulty_bits),true);
      return send(res,200,{ok:true,height:2,hash:body.hash});
    }
    send(res,404,{ok:false,error:'not_found'});
  });
  try{
    const result=await runMiner(options(base),{emit:(state,message,details)=>events.push({state,message,details})});
    assert.equal(result.accepted,1);
    assert.equal(result.workReplacements,1);
    assert.equal(result.rejected,1);
    assert.equal(submissions,1);
    assert.ok(events.some(event=>event.state==='WORK_REJECTED'&&event.details?.reason==='stale_tip'));
    assert.ok(events.some(event=>event.state==='WORK_ACCEPTED'));
  }finally{
    await close(server);
  }
});

test('node 5xx is treated as unavailable and recovered with bounded reconnect',async()=>{
  let statusRequests=0;
  const events=[];
  const {server,base}=await listen(async(req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1');
    if(url.pathname==='/status'){
      statusRequests++;
      if(statusRequests<=2)return send(res,503,{ok:false,error:'temporary_unavailable'});
      return send(res,200,{ok:true,network:NETWORK,height:0,tip_hash:ZERO});
    }
    if(url.pathname==='/template')return send(res,200,makeTemplate({height:1,previousHash:ZERO,difficulty:1}));
    if(url.pathname==='/submit-block'&&req.method==='POST'){
      const body=await jsonBody(req);
      return send(res,200,{ok:true,height:1,hash:body.hash});
    }
    send(res,404,{ok:false,error:'not_found'});
  });
  try{
    const result=await runMiner(options(base),{emit:(state,message,details)=>events.push({state,message,details})});
    assert.equal(result.accepted,1);
    assert.ok(events.filter(event=>event.state==='NODE_UNAVAILABLE').length>=2);
    assert.ok(events.filter(event=>event.state==='RECONNECTING').length>=2);
  }finally{
    await close(server);
  }
});

test('abort produces cooperative graceful STOPPED state without submitting unknown work',async()=>{
  let submissions=0;
  const events=[];
  const {server,base}=await listen(async(req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1');
    if(url.pathname==='/status')return send(res,200,{ok:true,network:NETWORK,height:0,tip_hash:ZERO});
    if(url.pathname==='/template')return send(res,200,makeTemplate({height:1,previousHash:ZERO,difficulty:64}));
    if(url.pathname==='/submit-block'){submissions++;return send(res,500,{ok:false,error:'unexpected'})}
    send(res,404,{ok:false,error:'not_found'});
  });
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),25);
  try{
    const result=await runMiner(options(base,{chunkSize:32,tipPollMs:100000,once:false}),{
      emit:(state,message,details)=>events.push({state,message,details}),
      signal:controller.signal
    });
    assert.equal(result.accepted,0);
    assert.equal(submissions,0);
    assert.equal(events.at(-1)?.state,'STOPPED');
  }finally{
    clearTimeout(timer);
    await close(server);
  }
});
