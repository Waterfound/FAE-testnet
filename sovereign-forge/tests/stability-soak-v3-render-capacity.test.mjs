import assert from 'node:assert/strict';
import test from 'node:test';
import {proveRenderFreeCapacity} from '../lab/stability-soak-v3/render-free-capacity-proof.mjs';

test('explicit dashboard evidence is preferred when available',()=>{
  const r=proveRenderFreeCapacity({requiredHours:540,dashboardRemainingHours:700});
  assert.equal(r.ok,true);assert.equal(r.method,'dashboard');assert.equal(r.remainingLowerBoundHours,700);
});
test('first-day worst-case bound proves Plan A with five Free services even using a full 24h uncertainty window',()=>{
  const r=proveRenderFreeCapacity({requiredHours:540,freeWebServiceCount:5,worstCaseElapsedHoursSinceReset:24,inventoryCompleteSinceReset:true});
  assert.equal(r.ok,true);assert.equal(r.remainingLowerBoundHours,630);
});
test('same conservative proof proves Plan B 324h with large margin',()=>{
  const r=proveRenderFreeCapacity({requiredHours:324,freeWebServiceCount:5,worstCaseElapsedHoursSinceReset:24,inventoryCompleteSinceReset:true});
  assert.equal(r.ok,true);assert.equal(r.remainingLowerBoundHours,630);
});
test('missing inventory completeness cannot be treated as quota proof',()=>{
  const r=proveRenderFreeCapacity({requiredHours:540,freeWebServiceCount:5,worstCaseElapsedHoursSinceReset:1,inventoryCompleteSinceReset:false});
  assert.equal(r.ok,false);assert.equal(r.error,'inventory_since_reset_not_proven');
});
test('bound fails closed when other Free services could consume too much',()=>{
  const r=proveRenderFreeCapacity({requiredHours:540,freeWebServiceCount:9,worstCaseElapsedHoursSinceReset:24,inventoryCompleteSinceReset:true});
  assert.equal(r.ok,false);assert.equal(r.remainingLowerBoundHours,534);
});
