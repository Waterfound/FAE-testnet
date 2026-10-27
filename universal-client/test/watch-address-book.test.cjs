'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {WatchAddressBook}=require('../src/watch-address-book.cjs');
const A='faet1z5g4r8qgv29jcy350mvxgr3hpk35vjhdk3s6fn',B='faet1'+'q'.repeat(38);
test('native watch-only catalog cold restart and visibility round trip',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ts-watch-'));
 try{
  const one=new WatchAddressBook(dir);
  assert.deepEqual((await one.list()).entries,[]);
  await one.add(A,'Miner public address');await one.add(B,'Second public address');
  await one.update(A,{hidden:true,alias:'Hidden label'});
  const two=new WatchAddressBook(dir),rows=(await two.list()).entries;
  assert.deepEqual(rows,[{address:A,alias:'Hidden label',hidden:true},{address:B,alias:'Second public address',hidden:false}]);
  const stat=await fs.stat(path.join(dir,'watch-addresses.json'));
  if(process.platform!=='win32')assert.equal(stat.mode&0o077,0);
  await two.remove(A);
  assert.deepEqual((await(new WatchAddressBook(dir)).list()).entries,[{address:B,alias:'Second public address',hidden:false}]);
 }finally{await fs.rm(dir,{recursive:true,force:true})}
});
test('public-only catalog rejects ambiguous or corrupt records without erasing them',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ts-watch-deny-'));
 try{
  const a=new WatchAddressBook(dir);
  await assert.rejects(()=>a.add('24 secret words','unsafe'),/Invalid public/);
  await assert.rejects(()=>a.add(A,'<script>'),/Invalid watch-only alias/);
  await a.add(A,'ok');
  await assert.rejects(()=>a.add(A,'dupe'),/already saved/);
  await assert.rejects(()=>a.update(A,{password:'secret'}),/Invalid watch-only update/);
  await assert.rejects(()=>a.update(A,{hidden:'yes'}),/Invalid visibility/);
  await fs.writeFile(path.join(dir,'watch-addresses.json'),'{corrupt');
  const fresh=new WatchAddressBook(dir);
  await assert.rejects(()=>fresh.list(),/Corrupt watch-only catalog/);
  assert.equal(await fs.readFile(path.join(dir,'watch-addresses.json'),'utf8'),'{corrupt');
 }finally{await fs.rm(dir,{recursive:true,force:true})}
});
test('serializes concurrent writes and never overwrites a duplicated public entry',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ts-watch-concurrency-'));
 try{
  const a=new WatchAddressBook(dir),rs=await Promise.allSettled([a.add(A,'one'),a.add(A,'two'),a.add(B,'three')]);
  assert.equal(rs.filter(x=>x.status==='fulfilled').length,2);
  assert.equal((await(new WatchAddressBook(dir)).list()).entries.length,2);
 }finally{await fs.rm(dir,{recursive:true,force:true})}
});
