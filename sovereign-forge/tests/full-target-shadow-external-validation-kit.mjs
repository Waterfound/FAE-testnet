import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {stableStringify} from '../node/authoritative/canonical.mjs';
import {createShadowValidationFixture,SHADOW_VALIDATION_PROFILES} from '../node/lab/full-target-shadow-validation-fixtures.mjs';

function waitForLine(child,predicate,timeoutMs=30_000){
  return new Promise((resolvePromise,reject)=>{
    let buffer='';const timeout=setTimeout(()=>{cleanup();reject(new Error('child_output_timeout'))},timeoutMs);
    function cleanup(){clearTimeout(timeout);child.stdout.off('data',onData);child.off('exit',onExit)}
    function onExit(code,signal){cleanup();reject(new Error(`child_exited_before_ready:${code}:${signal}`))}
    function onData(chunk){buffer+=chunk.toString('utf8');for(;;){const index=buffer.indexOf('\n');if(index<0)break;const line=buffer.slice(0,index).trim();buffer=buffer.slice(index+1);if(!line)continue;let parsed;try{parsed=JSON.parse(line)}catch{continue}if(predicate(parsed)){cleanup();resolvePromise(parsed);return}}}
    child.stdout.on('data',onData);child.once('exit',onExit);
  });
}
function waitExit(child,timeoutMs=10_000){return new Promise((resolvePromise,reject)=>{if(child.exitCode!==null)return resolvePromise({code:child.exitCode,signal:child.signalCode});const t=setTimeout(()=>reject(new Error('child_exit_timeout')),timeoutMs);child.once('exit',(code,signal)=>{clearTimeout(t);resolvePromise({code,signal})})})}

const fixtures={};
for(const profile of SHADOW_VALIDATION_PROFILES){
  const first=createShadowValidationFixture(profile),second=createShadowValidationFixture(profile);
  assert.equal(stableStringify(first),stableStringify(second),`fixture ${profile} must be deterministic`);
  fixtures[profile]=first;
}
assert.equal(fixtures.trusted.expected_height,12);
assert.equal(fixtures['weak-a'].expected_height,15);assert.equal(fixtures['strong-b'].expected_height,15);
assert.ok(BigInt(fixtures['strong-b'].expected_work)>BigInt(fixtures['weak-a'].expected_work));
assert.equal(fixtures.trusted.policy.activation_height,14);
for(let i=0;i<12;i++){
  assert.equal(fixtures['weak-a'].initialChain[i].hash,fixtures.trusted.initialChain[i].hash);
  assert.equal(fixtures['strong-b'].initialChain[i].hash,fixtures.trusted.initialChain[i].hash);
}
assert.notEqual(fixtures['weak-a'].expected_tip_hash,fixtures['strong-b'].expected_tip_hash);

const dir=await mkdtemp(join(tmpdir(),'fae-shadow-external-kit-'));
let child=null;
try{
  const evidenceFile=join(dir,'evidence.jsonl');
  child=spawn(process.execPath,[resolve('sovereign-forge/node/lab/fae-full-target-shadow-validation-node.mjs')],{
    cwd:resolve('.'),stdio:['ignore','pipe','pipe'],env:{...process.env,FAE_SHADOW_HOST:'127.0.0.1',FAE_SHADOW_PORT:'0',FAE_SHADOW_PROFILE:'trusted',FAE_SHADOW_LABEL:'ci-smoke',FAE_SHADOW_DATA_FILE:join(dir,'state.json'),FAE_SHADOW_IDENTITY_FILE:join(dir,'identity.json'),FAE_SHADOW_EVIDENCE_FILE:evidenceFile,FAE_SHADOW_SYNC:'0'}
  });
  let stderr='';child.stderr.on('data',chunk=>{stderr+=chunk.toString('utf8')});
  const online=await waitForLine(child,row=>row.event==='shadow-validation-online');
  assert.equal(online.profile,'trusted');assert.match(online.base_url,/^http:\/\/127\.0\.0\.1:\d+$/);
  const response=await fetch(`${online.base_url}/status`,{signal:AbortSignal.timeout(5_000)});assert.equal(response.ok,true);const status=await response.json();
  assert.equal(status.height,12);assert.equal(status.policy_id,status.secure_context_binding);assert.equal(status.status,'lab-only-no-consensus-authority');
  child.kill('SIGTERM');const exit=await waitExit(child);assert.equal(exit.code===0||exit.code===null,true,`entrypoint exit failed: ${exit.code}; ${stderr}`);child=null;
  const evidence=(await readFile(evidenceFile,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
  assert.equal(evidence.some(row=>row.event==='online'),true);assert.equal(evidence.some(row=>row.event==='shutdown'),true);
  const onlineEvidence=evidence.find(row=>row.event==='online');assert.equal(onlineEvidence.fixture.expected_height,12);assert.ok(BigInt(onlineEvidence.fixture.expected_strong_work)>BigInt(onlineEvidence.fixture.expected_weak_work));
  console.log(JSON.stringify({status:'PASS',fixture_determinism:true,profiles:SHADOW_VALIDATION_PROFILES,stronger_work_order:true,entrypoint_http:true,policy_binding:true,evidence_online_shutdown:true}));
}finally{
  if(child){child.kill('SIGKILL');await waitExit(child).catch(()=>{})}
  await rm(dir,{recursive:true,force:true});
}
