'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {registerSingleInstanceGuard}=require('../src/single-instance-guard.cjs');
test('second desktop instance never gains a second profile writer',()=>{
  const app=new EventEmitter();let queries=0;
  app.requestSingleInstanceLock=()=>{queries++;return false};
  assert.equal(registerSingleInstanceGuard(app,()=>{throw Error('Never access primary window')}),false);
  assert.equal(queries,1);
  assert.equal(app.listenerCount('second-instance'),0);
});
test('owner binds only trusted window focus and ignores second-process input',()=>{
  const app=new EventEmitter();app.requestSingleInstanceLock=()=>true;
  let focused=0,restored=0;
  const win={isDestroyed:()=>false,isMinimized:()=>true,restore:()=>restored++,focus:()=>focused++};
  assert.equal(registerSingleInstanceGuard(app,()=>win),true);
  app.emit('second-instance',{},['--run-arbitrary-code','--wallet-secret'],process.cwd());
  assert.equal(focused,1);assert.equal(restored,1);
});
