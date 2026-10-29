'use strict';
// Genuine two-process persistence test. The original FAE v4 node and miner
// run in an isolated temporary profile; there are no wallet keys or submits.
// Separate Node OS processes are required for both halves of this test.
const test=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {ProcessController,NETWORK}=require('../src/controller.cjs');

const ADDRESS='faet1z5g4r8qgv29jcy350mvxgr3hpk35vjhdk3s6fn';
const root=path.resolve(__dirname,'../..');
const scripts=[
  path.join(root,'sovereign-forge','node','fae-node.mjs'),
  path.join(root,'standalone','fae-miner.mjs')
];

const canonical=record=>({
  network:record.network,
  candidate_atoms:record.candidate_atoms,
  confirmed_candidate_atoms:record.confirmed_candidate_atoms,
  pending_candidate_atoms:record.pending_candidate_atoms,
  observed_tip_height:record.observed_tip_height,
  observed_tip_hash:record.observed_tip_hash,
  outputs:record.outputs
});

async function isolatedProcess(mode,dir){
  const node=new ProcessController({repoRoot:root,dataDir:dir,nodeExecutable:process.execPath});
  try{
    const started=await node.startNode();
    assert.equal(started.node,'running');
    assert.equal(node.snapshot().miner,'stopped');
    let observed=await node.readFundingCandidates(ADDRESS);
    if(mode==='mine'){
      assert.equal(observed.candidate_atoms,'0');
      await node.startMiner(ADDRESS);
      const deadline=Date.now()+40000;
      try{
        while(Date.now()<deadline){
          try{observed=await node.readFundingCandidates(ADDRESS)}
          catch(error){
            if(error.message!=='FAE chain tip changed during observation')throw error;
            await new Promise(resolve=>setTimeout(resolve,100));
            continue;
          }
          if(BigInt(observed.confirmed_candidate_atoms)>0n)break;
          await new Promise(resolve=>setTimeout(resolve,100));
        }
      }finally{await node.stopMiner()}
      assert.ok(BigInt(observed.confirmed_candidate_atoms)>0n,'Original miner produced no UTXO');
      observed=await node.readFundingCandidates(ADDRESS);
      fs.writeFileSync(path.join(dir,'public-mined-evidence.json'),
        JSON.stringify(canonical(observed)),{flag:'wx',mode:0o600});
    }else if(mode==='recover'){
      const saved=JSON.parse(fs.readFileSync(path.join(dir,'public-mined-evidence.json'),'utf8'));
      assert.deepEqual(canonical(observed),saved,'New OS process lost or changed mined chain');
      assert.ok(BigInt(observed.confirmed_candidate_atoms)>0n);
    }else throw Error('Unknown process phase');

    assert.equal(observed.network,NETWORK);
    assert.ok(observed.observed_tip_height>=1);
    assert.equal(observed.funding_authorization,'DENIED_UNVERIFIED');
    assert.equal(observed.eligible_candidate_atoms,'0');
    assert.equal(observed.eligible_candidate_count,0);
    assert.equal(observed.signer,'UNAVAILABLE');
    assert.equal(observed.submission,'NOT_PERFORMED');
    assert.ok(observed.outputs.every(o=>o.spend_eligibility==='UNVERIFIED'));
    assert.equal(node.snapshot().miner,'stopped');
  }finally{await node.dispose()}
}

function runSeparateProcess(mode,dir){
  return new Promise((resolve,reject)=>{
    let stderr='';
    const child=spawn(process.execPath,[__filename,'isolated-probe',mode,dir],{
      cwd:root,stdio:['ignore','ignore','pipe'],windowsHide:true
    });
    const timeout=setTimeout(()=>child.kill(),60000);
    child.stderr.on('data',bytes=>{if(stderr.length<2500)stderr+=bytes.toString()});
    child.once('error',e=>{clearTimeout(timeout);reject(e)});
    child.once('close',(code,signal)=>{
      clearTimeout(timeout);
      if(code===0&&signal===null)return resolve();
      reject(Error('Real cold-process '+mode+' failed: '+String(code)+' '+String(signal)+
        ' '+stderr.slice(0,450)));
    });
  });
}

if(process.argv[2]==='isolated-probe'){
  isolatedProcess(process.argv[3],process.argv[4]).catch(error=>{
    console.error('FAE_COLD_PROCESS_FAIL '+String(error.message));process.exitCode=1;
  });
}else{
  test('real original FAE mined UTXOs survive a second independent client process without remine or signing',
    {timeout:140000},async t=>{
      if(!scripts.every(p=>fs.existsSync(p)))
        return t.skip('Original FAE node/miner absent from checkout');
      const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ts-full-process-recovery-'));
      try{
        await runSeparateProcess('mine',dir);
        await runSeparateProcess('recover',dir);
      }finally{fs.rmSync(dir,{recursive:true,force:true})}
    });
}
