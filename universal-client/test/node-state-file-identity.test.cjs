'use strict';
// Regression for native desktop recovery: verify the actual regular file
// remains read-only, and deterministically reproduce a same-sized file
// replacement between lstat and open without touching protected node code.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const fsSync=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const vm=require('node:vm');
const {NETWORK}=require('../src/bridge-contract.cjs');
const {assertRecoverableLocalNodeState}=require('../src/node-storage-preflight.cjs');

test('recovery preflight accepts an intact private persisted FAE state without rewriting bytes',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ts-node-identity-'));
  try{
    const file=path.join(dir,'state.json');
    const content=JSON.stringify({format:'FAE_NODE_STATE_V1',network:NETWORK,chain:[],transactions:{}});
    await fs.writeFile(file,content,{mode:0o600});
    const before=await fs.readFile(file);
    assert.deepEqual(await assertRecoverableLocalNodeState(file),{present:true,blocks:0});
    assert.deepEqual(await fs.readFile(file),before);
  }finally{await fs.rm(dir,{recursive:true,force:true})}
});

test('same-sized replacement during lstat/open cannot pass persistent recovery preflight',async()=>{
  const file=path.join(os.tmpdir(),'ts-recovery-identity-test.json');
  const original={size:128,dev:7,ino:71};
  const replaced={size:128,dev:7,ino:72};
  let readWasAttempted=false,handleClosed=false;
  const load=(id)=>{
    if(id==='node:fs/promises')return {
      lstat:async requested=>{
        if(requested===file+'.tmp')throw Object.assign(Error('absent'),{code:'ENOENT'});
        assert.equal(requested,file);
        return {...original,isFile:()=>true,isSymbolicLink:()=>false};
      },
      open:async requested=>{
        assert.equal(requested,file);
        return {
          stat:async()=>({...replaced,isFile:()=>true}),
          readFile:async()=>{readWasAttempted=true;return '{}'},
          close:async()=>{handleClosed=true}
        };
      }
    };
    if(id==='node:fs')return {constants:fsSync.constants};
    if(id==='./bridge-contract.cjs')return {NETWORK};
    throw Error('Unexpected dependency in isolated preflight regression');
  };
  const filename=path.resolve(__dirname,'../src/node-storage-preflight.cjs');
  const module={exports:{}};
  vm.runInNewContext(fsSync.readFileSync(filename,'utf8'),{module,require:load},{filename});
  await assert.rejects(
    ()=>module.exports.assertRecoverableLocalNodeState(file),
    /FAE node state changed during preflight/
  );
  assert.equal(readWasAttempted,false,'Must refuse different inode before parsing untrusted state');
  assert.equal(handleClosed,true,'Failed identity attestation must close the file handle');
});
