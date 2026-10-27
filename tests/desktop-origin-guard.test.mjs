'use strict';
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const NODE=resolve(new URL('../sovereign-forge/node/fae-node.mjs',import.meta.url).pathname);
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function availablePort(){
  const s=createServer();
  s.listen(0,'127.0.0.1');
  await once(s,'listening');
  const port=s.address().port;
  await new Promise(resolve=>s.close(resolve));
  return port;
}
async function fixture(desktopLock){
  const port=await availablePort(),base='http://127.0.0.1:'+port;
  const root=await mkdtemp(join(tmpdir(),'fae-origin-guard-'));
  const child=spawn(process.execPath,[NODE],{
    env:{...process.env,FAE_HOST:'127.0.0.1',FAE_PORT:String(port),
      FAE_DATA_FILE:join(root,'state.json'),FAE_SYNC:'0',
      FAE_UPSTREAM_API:'',FAE_PEERS:'',FAE_BOOTSTRAP_FEEDS:'',
      FAE_DESKTOP_LOCAL_ONLY:desktopLock?'1':'0'},
    stdio:['ignore','ignore','pipe']
  });
  let stderr='';
  child.stderr.on('data',v=>{stderr+=String(v).slice(0,2048)});
  async function stop(){
    if(child.exitCode===null){
      const done=once(child,'exit').catch(()=>{});
      child.kill('SIGTERM');
      await Promise.race([done,pause(2000)]);
    }
    if(child.exitCode===null)child.kill('SIGKILL');
    await rm(root,{recursive:true,force:true});
  }
  try{
    for(let i=0;i<110;i++){
      if(child.exitCode!==null)throw Error('Node exited before status: '+stderr);
      try{
        const r=await fetch(base+'/status',{signal:AbortSignal.timeout(500)});
        if(r.ok&&((await r.json()).network==='fairyelf-public-testnet-v4'))
          return {base,stop};
      }catch{}
      await pause(40);
    }
    throw Error('Node not ready: '+stderr);
  }catch(e){await stop();throw e}
}
test('opt-in desktop node rejects browser origins and OPTIONS without wildcard CORS',async()=>{
  const f=await fixture(true);
  try{
    const headers={origin:'https://other.example'};
    const good=await fetch(f.base+'/status');
    assert.equal(good.status,200);
    assert.equal(good.headers.get('access-control-allow-origin'),null);
    const blocked=await fetch(f.base+'/status',{headers});
    assert.equal(blocked.status,403);
    assert.equal((await blocked.json()).error,'desktop_browser_origin_forbidden');
    assert.equal(blocked.headers.get('access-control-allow-origin'),null);
    const preflight=await fetch(f.base+'/submit-tx',{method:'OPTIONS',headers:{...headers,
      'access-control-request-method':'POST'}});
    assert.equal(preflight.status,403);
    assert.equal(preflight.headers.get('access-control-allow-origin'),null);
    const post=await fetch(f.base+'/submit-block',{method:'POST',headers:{...headers,'content-type':'application/json'},
      body:'{}'});
    assert.equal(post.status,403);
    const final=await(await fetch(f.base+'/status')).json();
    assert.equal(final.height,0,'Origin rejection must not change chain state');
  }finally{await f.stop()}
});
test('without opt-in, current public-testnet CORS contract remains intact',async()=>{
  const f=await fixture(false);
  try{
    const request=await fetch(f.base+'/status',{headers:{origin:'https://app.example'}});
    assert.equal(request.status,200);
    assert.equal(request.headers.get('access-control-allow-origin'),'*');
    const preflight=await fetch(f.base+'/explorer/status',{method:'OPTIONS',headers:{origin:'https://app.example',
      'access-control-request-method':'GET'}});
    assert.equal(preflight.status,204);
    assert.equal(preflight.headers.get('access-control-allow-origin'),'*');
  }finally{await f.stop()}
});
