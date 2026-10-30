'use strict';
// V50 executable cross-owner candidate test. This mines REAL original FAE PoW
// from original miner PR #362 and delivers its original proof through the
// candidate parent -> disposable OS child IPC transport. The IPC child is NOT
// the original node. Its synthetic receipt cannot close Gate A.
const test=require('node:test');
const assert=require('node:assert/strict');
const {spawn,fork,execFileSync}=require('node:child_process');
const {createServer}=require('node:net');
const {createHash}=require('node:crypto');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {OwnedNodeIpc}=require('../src/owned-node-ipc.cjs');
const ROOT=path.resolve(__dirname,'..','..');
const ORIGINAL_MINER_HEAD='f85b483f88a5fb2b797a224596c23a7b505094d7';
const SOURCE_BLOBS=Object.freeze({
  'standalone/fae-miner.mjs':'0ab1643c1ff1bf2991a2e56512a3b1746c62122b',
  'standalone/mining-core.mjs':'42c392ad54a3e3c2f446ab79f67948d30b82a73e'
});
const ADDRESS='faet1z5g4r8qgv29jcy350mvxgr3hpk35vjhdk3s6fn';
async function freePort(){
  const server=createServer();
  return await new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(0,'127.0.0.1',()=>{
      const port=server.address()?.port;
      server.close(err=>err?reject(err):resolve(port));
    });
  });
}
function blobHash(bytes){
  return createHash('sha1').update('blob '+bytes.length+'\\0').update(bytes).digest('hex');
}
async function stageExactOriginalMiner(dir){
  for(const [relative,blob] of Object.entries(SOURCE_BLOBS)){
    const bytes=execFileSync('git',['show',ORIGINAL_MINER_HEAD+':'+relative],
      {cwd:ROOT,maxBuffer:150000});
    assert.equal(blobHash(bytes),blob,'original miner source changed: '+relative);
    const dest=path.join(dir,...relative.split('/'));
    await fs.mkdir(path.dirname(dest),{recursive:true,mode:0o700});
    await fs.writeFile(dest,bytes,{flag:'wx',mode:0o400});
  }
  const miner=await import(pathToFileURL(path.join(dir,'standalone','fae-miner.mjs')).href);
  const core=await import(pathToFileURL(path.join(dir,'standalone','mining-core.mjs')).href);
  assert.equal(typeof miner.runMiner,'function');
  assert.equal(typeof core.buildSubmission,'function');
  return {miner,core};
}
function safeNodeEnv(port,dataFile){
  const env={};
  for(const name of ['PATH','SystemRoot','WINDIR','HOME','USERPROFILE','TMP','TEMP','TMPDIR'])
    if(process.env[name])env[name]=process.env[name];
  return {...env,FAE_SYNC:'0',FAE_UPSTREAM_API:'',FAE_PEERS:'',
    FAE_BOOTSTRAP_FEEDS:'',FAE_HOST:'127.0.0.1',FAE_PORT:String(port),
    FAE_DATA_FILE:dataFile};
}
async function launchOriginalReadOnlyNode(dir,port){
  const script=path.join(ROOT,'sovereign-forge','node','fae-node.mjs');
  const child=spawn(process.execPath,[script],{
    cwd:ROOT,env:safeNodeEnv(port,path.join(dir,'node.json')),
    stdio:['ignore','pipe','pipe'],windowsHide:true
  });
  const expected=' listening on http://127.0.0.1:'+port+' height=';
  await new Promise((resolve,reject)=>{
    let settled=false,buffer='';
    const finish=error=>{
      if(settled)return;
      settled=true;clearTimeout(timer);
      child.stdout.off('data',onData);child.off('exit',onExit);
      error?reject(error):resolve();
    };
    const onData=data=>{
      buffer=(buffer+String(data)).slice(-8192);
      if(buffer.includes(expected))finish();
    };
    const onExit=()=>finish(Error('Original node exited before actual listen'));
    const timer=setTimeout(()=>finish(Error('Original node listen timed out')),18000);
    child.stdout.on('data',onData);child.once('exit',onExit);
  });
  return child;
}
async function terminate(child){
  if(!child)return;
  if(child.connected)child.disconnect();
  if(child.exitCode!==null||child.signalCode!==null)return;
  try{child.kill('SIGTERM')}catch{}
  await new Promise(resolve=>{
    if(child.exitCode!==null||child.signalCode!==null)return resolve();
    const timer=setTimeout(()=>{try{child.kill('SIGKILL')}catch{}resolve()},2000);
    child.once('exit',()=>{clearTimeout(timer);resolve()});
  });
}
test('V50 real original Miner #362 proof crosses inherited OS IPC; original node stays unmodified',
  {skip:process.env.TS_V50_REAL_ORIGINAL_MINER_BRIDGE!=='1',timeout:120000},
  async()=>{
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ts-v50-original-miner-'));
    let node=null,fixture=null,ipc=null;
    try{
      const {miner,core}=await stageExactOriginalMiner(dir);
      const port=await freePort();
      const endpoint='http://127.0.0.1:'+port;
      node=await launchOriginalReadOnlyNode(dir,port);
      const status=async()=>{
        const res=await fetch(endpoint+'/status',{signal:AbortSignal.timeout(5000)});
        assert.equal(res.status,200);return await res.json();
      };
      const before=await status();
      assert.equal(before.height,0);
      fixture=fork(path.join(__dirname,'fixtures','owned-ipc-child.cjs'),[],{
        env:safeNodeEnv(port,path.join(dir,'fixture-unused.json')),
        stdio:['ignore','ignore','ignore','ipc'],execArgv:[],windowsHide:true
      });
      ipc=new OwnedNodeIpc(fixture,{allowBlockMutation:true,timeoutMs:5000});
      const opts=miner.resolveOptions({node:endpoint,address:ADDRESS,once:true,json:true,
        'chunk-size':'4096','yield-ms':'0'},{});
      let actualOriginalProposal=null;
      const mined=await miner.runMiner(opts,{
        emit:()=>{},
        submitMinedBlock:async proposal=>{
          // Reuse unchanged ORIGINAL mining-core PoW and template proof checks.
          const sourceCheck=core.buildSubmission(
            {header:proposal.header,txids:proposal.txids},
            proposal.nonce,proposal.hash);
          assert.deepEqual(proposal,sourceCheck);
          assert.equal(core.hashHeaderNonce(proposal.header,proposal.nonce),proposal.hash);
          assert.equal(core.workMeetsTarget(proposal.hash,proposal.header.difficulty_bits),true);
          actualOriginalProposal=proposal;
          // The independent OS child is a SYNTHETIC node-side fixture ONLY.
          return await ipc.submitMinedBlock(proposal);
        }
      });
      assert.equal(mined.accepted,1,'the original miner accepted the fixture ACK');
      assert.ok(mined.totalHashes>0,'the original miner computed actual PoW');
      assert.ok(actualOriginalProposal);
      assert.equal(ipc.counter,1,'one original proof => one OS IPC submission');
      const after=await status();
      assert.equal(after.height,0,'original consensus was NOT mutated by fake receipt');
      assert.equal(after.tip_hash,before.tip_hash);
      console.log('TS_V50_ORIGINAL_MINER_OS_IPC_PROOF_PASS '+JSON.stringify({
        original_miner_source:ORIGINAL_MINER_HEAD,
        original_pow:true,original_source_validator:true,os_child_ipc:true,
        single_submission:true,original_node_height_unchanged:true,
        durable_original_node_mutation:'NOT_ADMITTED',gate_a:'OPEN'
      }));
    }finally{
      ipc?.revoke();
      await terminate(fixture);
      await terminate(node);
      await fs.rm(dir,{recursive:true,force:true});
    }
  });
