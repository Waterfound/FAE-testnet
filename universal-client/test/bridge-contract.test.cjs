'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {NETWORK,validateRead}=require('../src/bridge-contract.cjs');
const ADDRESS='faet1'+'q'.repeat(40);
const HASH='0'.repeat(64);
test('exact FAE v4 status and tip required',()=>{
  const valid={ok:true,network:NETWORK,height:0,tip_hash:HASH};
  assert.equal(validateRead(valid).height,0);
  assert.throws(()=>validateRead({...valid,network:'another'}),/incompatible/);
  assert.throws(()=>validateRead({...valid,tip_hash:'bad'}),/tip binding/);
  assert.throws(()=>validateRead({...valid,height:-1}),/tip binding/);
});
test('Explorer cannot render without the exact current tip binding',()=>{
  const valid={ok:true,network:NETWORK,observed_tip_height:2,observed_tip_hash:HASH};
  assert.equal(validateRead(valid,{kind:'explorer'}).observed_tip_height,2);
  assert.throws(()=>validateRead({...valid,observed_tip_hash:undefined},{kind:'explorer'}),/tip binding/);
  assert.throws(()=>validateRead({...valid,network:'other'},{kind:'explorer'}),/incompatible/);
});
test('balance accepts canonical no-network payload, rejects substitution',()=>{
  const valid={ok:true,address:ADDRESS,balance_atoms:'123456789'};
  assert.equal(validateRead(valid,{kind:'balance',address:ADDRESS}).balance_atoms,'123456789');
  assert.throws(()=>validateRead({...valid,address:'another'},{kind:'balance',address:ADDRESS}),/balance/);
  assert.throws(()=>validateRead({...valid,network:'wrong'},{kind:'balance',address:ADDRESS}),/balance/);
  assert.throws(()=>validateRead({...valid,balance_atoms:'-100'},{kind:'balance',address:ADDRESS}),/balance/);
});
test('unknown observation modes fail closed',()=>{
  assert.throws(()=>validateRead({ok:true,network:NETWORK},{kind:'submit-block'}),/not authorized/);
  assert.throws(()=>validateRead({ok:false,network:NETWORK}),/incompatible/);
});
