'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {makeUtilitySpawn}=require('../src/utility-process-adapter.cjs');
test('utility spawn avoids runAsNode and preserves owned mining lifecycle',()=>{
  let invocation;const u=new EventEmitter();u.stdout=new EventEmitter();u.kill=()=>true;
  const spawn=makeUtilitySpawn((script,args,options)=>{invocation={script,args,options};return u});
  const c=spawn('/unused',['/trusted/standalone/fae-miner.mjs','--json'],{
    cwd:'/trusted',env:{FAE_SYNC:'0'},stdio:['ignore','pipe','ignore']});
  assert.equal(invocation.options.stdio,'pipe');
  assert.equal(invocation.options.serviceName,'Triumph FAE Miner');
  assert.deepEqual(invocation.options.env,{FAE_SYNC:'0'});
  assert.equal(invocation.options.env.ELECTRON_RUN_AS_NODE,undefined);
  assert.equal(c.stdout,u.stdout);
  u.emit('exit',0);assert.equal(c.exitCode,0);
});
test('utility process abnormal exit and stop fail closed',()=>{
  const u=new EventEmitter();u.kill=()=>true;u.stdout=null;
  const c=makeUtilitySpawn(()=>u)('/unused',['/trusted/node/fae-node.mjs'],{
    cwd:'/trusted',env:{},stdio:['ignore','ignore','ignore']});
  assert.equal(c.killed,false);assert.equal(c.stdout,null);
  let errors=0;c.on('error',()=>errors++);
  u.emit('error',{type:'FatalError',report:'never log sensitive data'});
  assert.equal(errors,1);assert.equal(c._tsFailed,true);
  assert.equal(c.kill('SIGTERM'),true);assert.equal(c.killed,true);
});
