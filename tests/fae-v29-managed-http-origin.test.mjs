import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {fork} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

const SCRIPT=resolve('sovereign-forge/node/fae-node.mjs');
const ADDRESS='faet1z5g4r8qgv29jcy350mvxgr3hpk35vjhdk3s6fn';
async function openPort(){
  return await new Promise((resolvePort,rejectPort)=>{
    const s=net.createServer();
    s.once('error',rejectPort);
    s.listen(0,'127.0.0.1',()=>{
      const p=s.address().port;
      s.close(error=>error?rejectPort(error):resolvePort(p));
    });
  });
}
async function request(port,method,pathname,headers={},data=null){
  return await new Promise((done,reject)=>{
    const r=http.request({host:'127.0.0.1',port,method,path:pathname,
      headers:{...headers,...(data===null?{}:{'content-type':'application/json'})},
      timeout:3500},res=>{
      let body='';
      res.on('data',d=>body+=String(d));
      res.on('end',()=>done({status:res.statusCode,headers:res.headers,body}));
    });
    r.once('error',reject);
    r.once('timeout',()=>r.destroy(Error('http_timeout')));
    r.end(data===null?undefined:JSON.stringify(data));
  });
}
async function withOriginalNode(managed,work,extra={}){
  const port=await openPort();
  const dir=await mkdtemp(join(tmpdir(),'fae-v29-managed-guard-'));
  const child=fork(SCRIPT,[],{cwd:process.cwd(),env:{
    ...process.env,FAE_TRIUM_IPC:managed?'1':'0',FAE_SYNC:'0',
    FAE_UPSTREAM_API:'',FAE_PEERS:'',FAE_BOOTSTRAP_FEEDS:'',
    FAE_DATA_FILE:join(dir,'state.json'),FAE_PORT:String(port),
    FAE_HOST:'127.0.0.1',...extra
  },stdio:['ignore','pipe','pipe','ipc']});
  try{
    await new Promise((yes,no)=>{
      let output='',settled=false;
      const done=error=>{
        if(settled)return;settled=true;clearTimeout(timer);
        child.stdout.off('data',data);child.off('exit',exited);
        if(error)no(error);else yes();
      };
      const exited=()=>done(Error('original_node_exited_before_ready'));
      const data=b=>{output+=String(b);if(output.length>5000)output=output.slice(-5000);
        if(output.includes(' listening on http://127.0.0.1:'+port+' height='))done();
      };
      const timer=setTimeout(()=>done(Error('original_node_timeout')),7000);
      child.stdout.on('data',data);child.once('exit',exited);
    });
    return await work(port,child);
  }finally{
    if(child.connected)child.disconnect();
    if(child.exitCode===null&&!child.killed)child.kill();
    await new Promise(resolve=>{
      if(child.exitCode!==null||child.signalCode!==null)return resolve();
      const timer=setTimeout(resolve,3500);
      child.once('exit',()=>{clearTimeout(timer);resolve()});
    });
    await rm(dir,{recursive:true,force:true});
  }
}
test('actual managed original FAE node: native Node miner GET/POST ingress preserved, browser CORS removed',
  {timeout:15000},async()=>{
  await withOriginalNode(true,async port=>{
    const good=await request(port,'GET','/status');
    assert.equal(good.status,200);
    assert.equal(good.headers['access-control-allow-origin'],undefined);
    assert.equal(JSON.parse(good.body).network,'fairyelf-public-testnet-v4');
    const template=await request(port,'GET','/template?address='+encodeURIComponent(ADDRESS));
    assert.equal(template.status,200);
    assert.equal(JSON.parse(template.body).ok,true);
    const badBlock=await request(port,'POST','/submit-block',{},{
      header:{},nonce:0,hash:'invalid',txids:[]});
    assert.notEqual(badBlock.status,403,'native miner submit route must remain reachable');
    assert.equal(JSON.parse(badBlock.body).ok,false);
    const again=await request(port,'GET','/status');
    assert.equal(JSON.parse(again.body).height,0);
  });
});
test('actual managed original node rejects browser origin, preflight, DNS rebinding and navigation',
  {timeout:15000},async()=>{
  await withOriginalNode(true,async port=>{
    const attempts=[
      ['GET','/status',{Host:'evil.example:'+port}],
      ['GET','/status',{Origin:'https://evil.invalid'}],
      ['GET','/status',{Origin:'null'}],
      ['GET','/status',{'sec-fetch-site':'cross-site'}],
      ['GET','/status',{'sec-fetch-site':'same-origin'}],
      ['GET','/status',{'sec-fetch-dest':'image'}],
      ['GET','/status',{Referer:'https://evil.invalid/'}],
      ['OPTIONS','/submit-block',{'access-control-request-method':'POST'}],
      ['POST','/submit-tx',{Origin:'https://evil.invalid'}],
      ['POST','/submit-block',{'sec-fetch-site':'cross-site'}]
    ];
    for(const [method,route,headers] of attempts){
      const r=await request(port,method,route,headers,method==='POST'?{}:null);
      assert.equal(r.status,403,method+' '+route+' '+JSON.stringify(headers));
      assert.equal(r.headers['access-control-allow-origin'],undefined);
      assert.equal(JSON.parse(r.body).error,'managed_http_ingress_denied');
    }
    const stable=await request(port,'GET','/status');
    assert.equal(JSON.parse(stable.body).height,0);
  });
});
test('managed local wallet HTTP submission denied; miner block HTTP still requires owner gate',
  {timeout:15000},async()=>{
  await withOriginalNode(true,async port=>{
    const tx=await request(port,'POST','/submit-tx',{},{
      version:2,network:'fairyelf-public-testnet-v4',inputs:[],outputs:[]});
    assert.equal(tx.status,403);
    assert.equal(JSON.parse(tx.body).error,'managed_tx_ingress_requires_native_owner');
    const block=await request(port,'POST','/submit-block',{},{
      header:{},nonce:0,hash:'invalid',txids:[]});
    assert.notEqual(block.status,403);
    assert.equal(JSON.parse(block.body).ok,false);
    assert.equal(JSON.parse((await request(port,'GET','/status')).body).height,0);
  });
});
test('ordinary standalone original FAE node retains historical HTTP policy',
  {timeout:15000},async()=>{
  await withOriginalNode(false,async port=>{
    const r=await request(port,'GET','/status',{Origin:'https://example.invalid'});
    assert.equal(r.status,200);
    assert.equal(r.headers['access-control-allow-origin'],'*');
  });
});
test('native managed node refuses wildcard listener bind at source startup',
  {timeout:12000},async()=>{
  const dir=await mkdtemp(join(tmpdir(),'fae-v29-bind-'));
  const child=fork(SCRIPT,[],{cwd:process.cwd(),env:{
    ...process.env,FAE_TRIUM_IPC:'1',FAE_SYNC:'0',FAE_HOST:'0.0.0.0',
    FAE_DATA_FILE:join(dir,'state.json'),FAE_PORT:'0'
  },stdio:['ignore','pipe','pipe','ipc']});
  try{
    let stderr='';child.stderr.on('data',x=>stderr+=String(x));
    const code=await Promise.race([
      new Promise(resolveCode=>child.on('exit',resolveCode)),
      new Promise((_,reject)=>setTimeout(()=>reject(Error('refused_to_exit')),5000))
    ]);
    assert.notEqual(code,0);
    assert.match(stderr,/requires literal IPv4 loopback binding/);
  }finally{
    if(child.exitCode===null&&!child.killed)child.kill();
    await rm(dir,{recursive:true,force:true});
  }
});
