'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { NETWORK, doubleHashHex, hashHeaderNonce, workMeetsTarget } from '../standalone/mining-core.mjs';

const root=resolve(new URL('..',import.meta.url).pathname);
const minerFile=join(root,'standalone','fae-miner.mjs');
const address='faet1z5g4r8qgv29jcy350mvxgr3hpk35vjhdk3s6fn';

function send(res,status,payload){
  res.writeHead(status,{'content-type':'application/json'});
  res.end(JSON.stringify(payload));
}
async function body(req){
  let value='';
  for await(const chunk of req)value+=chunk;
  return value?JSON.parse(value):{};
}
function runProcess(config){
  return new Promise((resolveRun,rejectRun)=>{
    const child=spawn(process.execPath,[minerFile,'--config',config,'--once','--nonce-start','0','--json'],{stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';
    child.stdout.on('data',chunk=>stdout+=chunk);
    child.stderr.on('data',chunk=>stderr+=chunk);
    const timer=setTimeout(()=>{child.kill('SIGTERM');rejectRun(Error('miner process timeout'))},10_000);
    child.once('exit',code=>{
      clearTimeout(timer);
      if(code!==0)return rejectRun(Error(`miner exited ${code}: ${stderr}\n${stdout}`));
      resolveRun(stdout.trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)));
    });
  });
}

test('process restart trusts persisted public config but reacquires fresh node/template state',{timeout:20_000},async()=>{
  let height=0,tipHash='0'.repeat(64);
  const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1');
    if(url.pathname==='/status')return send(res,200,{ok:true,network:NETWORK,height,tip_hash:tipHash});
    if(url.pathname==='/template'){
      const txids=[];
      return send(res,200,{
        ok:true,
        template_policy:'snapshot',
        header:{
          network:NETWORK,
          height:height+1,
          previous_hash:tipHash,
          timestamp_ms:1770000010000+height,
          difficulty_bits:1,
          miner_address:address,
          reward_atoms:'1000000000',
          tx_root:doubleHashHex(txids),
          tx_count:0
        },
        txids
      });
    }
    if(url.pathname==='/submit-block'&&req.method==='POST'){
      const submission=await body(req);
      assert.equal(submission.header.height,height+1);
      assert.equal(submission.header.previous_hash,tipHash);
      assert.equal(hashHeaderNonce(submission.header,submission.nonce),submission.hash);
      assert.equal(workMeetsTarget(submission.hash,submission.header.difficulty_bits),true);
      height++;
      tipHash=submission.hash;
      return send(res,200,{ok:true,height,hash:tipHash});
    }
    send(res,404,{ok:false,error:'not_found'});
  });
  await new Promise((resolveListen,rejectListen)=>{
    server.once('error',rejectListen);
    server.listen(0,'127.0.0.1',resolveListen);
  });
  const dir=await mkdtemp(join(tmpdir(),'fae-miner-restart-'));
  const config=join(dir,'miner.json');
  const base=`http://127.0.0.1:${server.address().port}`;
  try{
    await writeFile(config,JSON.stringify({
      node:base,
      address,
      chunk_size:16,
      tip_poll_ms:100,
      reconnect_min_ms:100,
      reconnect_max_ms:200,
      rate_interval_ms:1000,
      yield_ms:0
    },null,2));
    const first=await runProcess(config);
    assert.ok(first.some(event=>event.state==='WORK_ACCEPTED'&&event.height===1));
    assert.equal(height,1);

    const second=await runProcess(config);
    assert.ok(second.some(event=>event.state==='TEMPLATE_READY'&&event.height===2));
    assert.ok(second.some(event=>event.state==='WORK_ACCEPTED'&&event.height===2));
    assert.equal(height,2);
  }finally{
    await new Promise(resolveClose=>server.close(resolveClose));
    await rm(dir,{recursive:true,force:true});
  }
});
