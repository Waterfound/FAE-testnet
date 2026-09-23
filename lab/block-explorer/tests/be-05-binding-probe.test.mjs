import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {probeBinding,normalizePublicNodeOrigin,normalizeFrontendOrigin} from '../be05-binding-probe.mjs';

const FRONTEND='https://fae-block-explorer-e2z4q3.v2.appdeploy.ai';
const TIP='1'.repeat(64);

function responseJson(res,status,payload,headers={}){
  const body=JSON.stringify(payload);
  res.writeHead(status,{'content-type':'application/json','content-length':String(Buffer.byteLength(body)),...headers});
  res.end(body);
}
async function listen(server){
  await new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(0,'127.0.0.1',resolve);
  });
  return server.address().port;
}
async function close(server){await new Promise(resolve=>server.close(()=>resolve()))}

function makeFetch(httpOrigin){
  return async(input,options={})=>{
    const url=new URL(input);
    const mapped=httpOrigin+url.pathname+url.search;
    return fetch(mapped,options);
  };
}
function validStatus(){
  return{
    ok:true,
    network:'fairyelf-public-testnet-v4',
    height:9,
    tip_hash:TIP,
    observed_tip_height:9,
    observed_tip_hash:TIP,
    node_version:'independent-0.3.0',
    chain_work:'123456'
  };
}
function validBlocks(){
  return{
    ok:true,
    network:'fairyelf-public-testnet-v4',
    observed_tip_height:9,
    observed_tip_hash:TIP,
    blocks:[{height:9,hash:TIP}]
  };
}
function mockGateway({wrongNetwork=false,allowPost=false,exposeSubmit=false,badCors=false}={}){
  return http.createServer((req,res)=>{
    const origin=req.headers.origin;
    const cors=origin?{'access-control-allow-origin':badCors?'https://wrong.example':origin}:{};

    if(req.url==='/explorer/status'&&req.method==='OPTIONS'){
      res.writeHead(204,{
        ...cors,
        'access-control-allow-methods':allowPost?'GET,OPTIONS,POST':'GET,OPTIONS'
      });
      return res.end();
    }
    if(req.url==='/explorer/status'&&req.method==='POST'){
      if(allowPost)return responseJson(res,200,{ok:true},cors);
      return responseJson(res,405,{ok:false,error:'read_only'},cors);
    }
    if(req.url==='/explorer/status'&&req.method==='GET'){
      const payload=validStatus();
      if(wrongNetwork)payload.network='wrong-network';
      return responseJson(res,200,payload,cors);
    }
    if(req.url==='/explorer/blocks?limit=1'&&req.method==='GET'){
      return responseJson(res,200,validBlocks(),cors);
    }
    if(req.url==='/submit-tx'&&req.method==='GET'){
      if(exposeSubmit)return responseJson(res,200,{ok:true});
      return responseJson(res,404,{ok:false,error:'public_route_not_found'});
    }
    return responseJson(res,404,{ok:false,error:'public_route_not_found'});
  });
}

test('binding origins require production HTTPS and origin-only URLs',()=>{
  assert.equal(normalizePublicNodeOrigin('https://node.example'),'https://node.example');
  assert.equal(normalizeFrontendOrigin(FRONTEND),FRONTEND);
  assert.throws(()=>normalizePublicNodeOrigin('http://node.example'),/requires_https/);
  assert.throws(()=>normalizePublicNodeOrigin('https://user:pass@node.example'),/invalid_public_node_origin/);
  assert.throws(()=>normalizePublicNodeOrigin('https://node.example/path'),/origin_only/);
  assert.throws(()=>normalizeFrontendOrigin('http://example.test'),/requires_https/);
});

test('probe verifies two coherent read-only observations',async()=>{
  const server=mockGateway();
  const port=await listen(server);
  try{
    const report=await probeBinding({
      publicOrigin:'https://node.example',
      frontendOrigin:FRONTEND,
      fetchImpl:makeFetch('http://127.0.0.1:'+port),
      delayMs:0
    });
    assert.equal(report.ok,true);
    assert.equal(report.network,'fairyelf-public-testnet-v4');
    assert.equal(report.observations.length,2);
    assert.ok(report.observations.every(row=>row.height===9&&row.tip_hash===TIP));
    assert.equal(report.read_only_surface_verified,true);
    assert.equal(report.public_submit_route_hidden,true);
    assert.equal(report.live_authority_granted,false);
  }finally{await close(server)}
});

test('probe fails closed on network identity mismatch',async()=>{
  const server=mockGateway({wrongNetwork:true});
  const port=await listen(server);
  try{
    await assert.rejects(
      ()=>probeBinding({publicOrigin:'https://node.example',frontendOrigin:FRONTEND,fetchImpl:makeFetch('http://127.0.0.1:'+port),delayMs:0}),
      /wrong_network/
    );
  }finally{await close(server)}
});

test('probe fails if public gateway accepts Explorer POST',async()=>{
  const server=mockGateway({allowPost:true});
  const port=await listen(server);
  try{
    await assert.rejects(
      ()=>probeBinding({publicOrigin:'https://node.example',frontendOrigin:FRONTEND,fetchImpl:makeFetch('http://127.0.0.1:'+port),delayMs:0}),
      /explorer_post_not_rejected/
    );
  }finally{await close(server)}
});

test('probe fails if submit-tx is publicly routed',async()=>{
  const server=mockGateway({exposeSubmit:true});
  const port=await listen(server);
  try{
    await assert.rejects(
      ()=>probeBinding({publicOrigin:'https://node.example',frontendOrigin:FRONTEND,fetchImpl:makeFetch('http://127.0.0.1:'+port),delayMs:0}),
      /submit_tx_publicly_routed/
    );
  }finally{await close(server)}
});

test('probe fails on CORS origin mismatch',async()=>{
  const server=mockGateway({badCors:true});
  const port=await listen(server);
  try{
    await assert.rejects(
      ()=>probeBinding({publicOrigin:'https://node.example',frontendOrigin:FRONTEND,fetchImpl:makeFetch('http://127.0.0.1:'+port),delayMs:0}),
      /status_cors_origin_mismatch/
    );
  }finally{await close(server)}
});
