import assert from 'node:assert/strict';
import test from 'node:test';
import {evaluateV3Prestart} from '../lab/stability-soak-v3/prestart-gate.mjs';

const commit='1'.repeat(40);
function fixture(){
  const services=['node-a','node-b','node-c','controller','observer'].map(role=>({role,plan:'free',suspended:false,autoDeploy:false,commit,healthy:true}));
  const nodes=['node-a','node-b','node-c'].map((role,i)=>({role,identityId:`id-${i}`,configuredPeers:2,height:11,tipHash:'a'.repeat(64),runStarted:false}));
  return{services,nodes,controller:{healthy:true,runStarted:false},observer:{healthy:true,runStarted:false},expectedCommit:commit,remainingFreeHours:750};
}
test('healthy frozen five-service topology may arm but does not start V3',()=>assert.equal(evaluateV3Prestart(fixture()).ok,true));
test('billing suspension is fail-closed',()=>{const x=fixture();x.services[1].suspended='suspended';assert.ok(evaluateV3Prestart(x).errors.includes('node-b:suspended'))});
test('commit drift is fail-closed',()=>{const x=fixture();x.services[4].commit='2'.repeat(40);assert.ok(evaluateV3Prestart(x).errors.includes('observer:commit_mismatch'))});
test('identity reuse is fail-closed',()=>{const x=fixture();x.nodes[2].identityId=x.nodes[1].identityId;assert.ok(evaluateV3Prestart(x).errors.includes('node_identities_not_distinct'))});
test('peer bootstrap loss is fail-closed',()=>{const x=fixture();x.nodes[0].configuredPeers=0;assert.ok(evaluateV3Prestart(x).errors.includes('node-a:peer_bootstrap_incomplete'))});
test('T0 cannot already exist during prestart',()=>{const x=fixture();x.controller.runStarted=true;assert.ok(evaluateV3Prestart(x).errors.includes('monitor_started_before_t0'))});
test('quota below 540h is fail-closed',()=>{const x=fixture();x.remainingFreeHours=539;assert.ok(evaluateV3Prestart(x).errors.includes('remaining_free_hours_below_required'))});
