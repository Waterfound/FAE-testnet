'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root=resolve(new URL('..',import.meta.url).pathname);
const nodeFile=join(root,'sovereign-forge','node','fae-node.mjs');
const minerFile=join(root,'standalone','fae-miner.mjs');
const address='faet1z5g4r8qgv29jcy350mvxgr3hpk35vjhdk3s6fn';

async function waitForNode(base){
  for(let attempt=0;attempt<120;attempt++){
    try{
      const response=await fetch(base+'/status');
      if(response.ok)return await response.json();
    }catch{}
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  throw Error('independent node did not start');
}

function runMiner(base){
  return new Promise((resolveRun,rejectRun)=>{
    const child=spawn(process.execPath,[
      minerFile,
      '--node',base,
      '--address',address,
      '--once',
      '--nonce-start','0',
      '--chunk-size','4096',
      '--tip-poll-ms','1000',
      '--rate-interval-ms','1000',
      '--json'
    ],{stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';
    child.stdout.on('data',chunk=>stdout+=chunk);
    child.stderr.on('data',chunk=>stderr+=chunk);
    const timer=setTimeout(()=>{
      child.kill('SIGTERM');
      rejectRun(Error('standalone miner exceeded 90 second integration bound\n'+stdout+'\n'+stderr));
    },90_000);
    child.once('exit',code=>{
      clearTimeout(timer);
      if(code!==0)return rejectRun(Error(`standalone miner exited ${code}\n${stdout}\n${stderr}`));
      resolveRun({stdout,stderr});
    });
  });
}

test('standalone product mines to a public address against an isolated independent node',{timeout:100_000},async()=>{
  const temp=await mkdtemp(join(tmpdir(),'fae-standalone-node-'));
  const dataFile=join(temp,'state.json');
  const port=18819;
  const base=`http://127.0.0.1:${port}`;
  const node=spawn(process.execPath,[nodeFile],{
    env:{
      ...process.env,
      FAE_PORT:String(port),
      FAE_HOST:'127.0.0.1',
      FAE_DATA_FILE:dataFile,
      FAE_SYNC:'0',
      FAE_UPSTREAM_API:'',
      FAE_PEERS:'',
      FAE_BOOTSTRAP_FEEDS:''
    },
    stdio:['ignore','pipe','pipe']
  });
  let nodeStderr='';
  node.stderr.on('data',chunk=>nodeStderr+=chunk);
  try{
    const initial=await waitForNode(base);
    assert.equal(initial.height,0);

    const mined=await runMiner(base);
    const events=mined.stdout.trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
    assert.ok(events.some(event=>event.state==='TEMPLATE_READY'));
    assert.ok(events.some(event=>event.state==='MINING'));
    assert.ok(events.some(event=>event.state==='WORK_ACCEPTED'));
    assert.equal(events.at(-1)?.state,'STOPPED');

    const status=await (await fetch(base+'/status')).json();
    const balance=await (await fetch(base+'/balance?address='+encodeURIComponent(address))).json();
    assert.equal(status.height,1);
    assert.equal(status.issued_atoms,'1000000000');
    assert.equal(balance.balance_atoms,'1000000000');
    assert.equal(balance.balance_fae,'10');
  }finally{
    node.kill('SIGTERM');
    await new Promise(resolve=>{node.once('exit',resolve);setTimeout(resolve,1000)});
    await rm(temp,{recursive:true,force:true});
    if(nodeStderr)process.stderr.write(nodeStderr);
  }
});
