import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
const {createDesktopReadGateway}=require('../standalone/desktop-read-gateway.cjs');
const NODE=fileURLToPath(new URL('../sovereign-forge/node/fae-node.mjs',import.meta.url));
const MANIFEST=fileURLToPath(new URL('../FAE_FORGE_MAIN.sha256',import.meta.url));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function freePort(){
  const server=createServer();server.listen(0,'127.0.0.1');
  await once(server,'listening');
  const port=server.address().port;
  await new Promise(resolve=>server.close(resolve));return port;
}
async function fixture(){
  const port=await freePort(),base='http://127.0.0.1:'+port;
  const root=await mkdtemp(join(tmpdir(),'ts-desktop-origin-'));
  const child=spawn(process.execPath,[NODE],{
    env:{...process.env,FAE_HOST:'127.0.0.1',FAE_PORT:String(port),
      FAE_DATA_FILE:join(root,'state.json'),FAE_SYNC:'0',
      FAE_UPSTREAM_API:'',FAE_PEERS:'',FAE_BOOTSTRAP_FEEDS:''},
    stdio:['ignore','ignore','pipe']
  });
  let stderr='';child.stderr.on('data',data=>{stderr+=String(data).slice(0,1000)});
  const gateway=createDesktopReadGateway({upstream:base});let active=false;
  async function stop(){
    if(active)await gateway.stop();
    if(child.exitCode===null){
      const done=once(child,'exit').catch(()=>{});
      child.kill('SIGTERM');
      await Promise.race([done,wait(1200)]);
    }
    if(child.exitCode===null)child.kill('SIGKILL');
    await rm(root,{recursive:true,force:true});
  }
  try{
    let ready=false;
    for(let i=0;i<120;i++){
      if(child.exitCode!==null)throw Error('Frozen node crashed: '+stderr);
      try{
        const r=await fetch(base+'/status',{signal:AbortSignal.timeout(550)});
        if(r.ok&&(await r.json()).network==='fairyelf-public-testnet-v4'){ready=true;break}
      }catch{}
      await wait(45);
    }
    if(!ready)throw Error('Frozen node readiness failure: '+stderr);
    const access=await gateway.start();active=true;
    return {...access,base,stop};
  }catch(e){await stop();throw e}
}
test('immutable FAE snapshot retains the exact authoritative checksum',async()=>{
  const manifest=await readFile(MANIFEST,'utf8');
  const line=manifest.split(/\r?\n/).find(x=>x.trimEnd().endsWith('  sovereign-forge/node/fae-node.mjs'));
  assert.ok(line);
  const checkout=await readFile(NODE);
  // git autocrlf converts text on Windows runners; verify canonical LF bytes without changing Git or its manifest.
  const normalized=process.platform==='win32'?Buffer.from(checkout.toString('utf8').replace(/\r\n/g,'\n'),'utf8'):checkout;
  assert.equal(createHash('sha256').update(normalized).digest('hex'),line.slice(0,64));
});
test('native-only read gateway denies browser origins, unauthorized reads and mutation',async()=>{
  const f=await fixture();const headers={'x-ts-read-token':f.key};
  try{
    const status=await fetch(f.url+'/status',{headers});
    assert.equal(status.status,200);
    assert.equal(status.headers.get('access-control-allow-origin'),null);
    const state=await status.json();
    assert.equal(state.network,'fairyelf-public-testnet-v4');
    assert.equal(state.height,0);
    const explorer=await fetch(f.url+'/explorer/status',{headers});
    assert.equal(explorer.status,200);
    assert.equal((await explorer.json()).network,state.network);
    assert.equal((await fetch(f.url+'/status')).status,401);
    assert.equal((await fetch(f.url+'/status',{headers:{'x-ts-read-token':'0'.repeat(64)}})).status,401);
    const hostile=await fetch(f.url+'/status',{headers:{...headers,origin:'https://hostile.example'}});
    assert.equal(hostile.status,403);
    assert.equal(hostile.headers.get('access-control-allow-origin'),null);
    assert.equal((await fetch(f.url+'/submit-tx',{method:'OPTIONS',headers:{origin:'https://hostile.example'}})).status,403);
    assert.equal((await fetch(f.url+'/submit-block',{method:'POST',headers,body:'{}'})).status,405);
    assert.equal((await fetch(f.url+'/template',{headers})).status,400);
    const after=await(await fetch(f.base+'/status')).json();
    assert.equal(after.height,0);
    // The immutable original listener is still reachable directly and has permissive CORS:
    // This gateway is defense-in-depth, NOT a complete node-authentication fix.
    const direct=await fetch(f.base+'/status',{headers:{origin:'https://hostile.example'}});
    assert.equal(direct.status,200);
    assert.equal(direct.headers.get('access-control-allow-origin'),'*');
  }finally{await f.stop()}
});

test('gateway bounds untrusted upstream streaming bodies even without Content-Length',async()=>{
  const gateway=createDesktopReadGateway({
    upstream:'http://127.0.0.1:8787',
    fetchFn:async()=>new Response(new ReadableStream({start(controller){
      controller.enqueue(new Uint8Array(1048577));controller.close();
    }}),{status:200,headers:{'content-type':'application/json'}})
  });
  const access=await gateway.start();
  try{
    const reply=await fetch(access.url+'/status',{headers:{'x-ts-read-token':access.key}});
    assert.equal(reply.status,502);
    assert.equal((await reply.json()).error,'unverified_read');
  }finally{await gateway.stop()}
});
