import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

const root=resolve(new URL('..',import.meta.url).pathname),entry=join(root,'node','fae-node-v6-eclipse-candidate.mjs');
function delay(ms){return new Promise(resolve=>setTimeout(resolve,ms))}
async function freePort(){const server=http.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port}
async function request(url,options={}){const response=await fetch(url,options);let body=null;try{body=await response.json()}catch{}return{status:response.status,body}}
async function waitJson(url,{accepted=[200],attempts=160}={}){for(let i=0;i<attempts;i++){try{const result=await request(url);if(accepted.includes(result.status))return result}catch{}await delay(50)}throw new Error(`endpoint did not become ready: ${url}`)}
async function stop(child){if(child.exitCode!==null)return;child.kill('SIGTERM');await Promise.race([new Promise(resolve=>child.once('exit',resolve)),delay(2500)]);if(child.exitCode===null)child.kill('SIGKILL')}
function start({port,operatorPort,dir,extraEnv={}}){let stdout='',stderr='';const child=spawn(process.execPath,[entry],{env:{...process.env,FAE_HOST:'127.0.0.1',FAE_PORT:String(port),FAE_DATA_FILE:join(dir,'state.json'),FAE_IDENTITY_FILE:join(dir,'identity.json'),FAE_PEER_TRUST_FILE:join(dir,'trust.json'),FAE_SYNC:'0',FAE_PEERS:'',FAE_PUBLIC_URL:'',FAE_PPLNS_COINBASE_ACTIVATION_HEIGHT:'',FAE_ECLIPSE_OPERATOR_HOST:'127.0.0.1',FAE_ECLIPSE_OPERATOR_PORT:String(operatorPort),FAE_ECLIPSE_KNOWN_PEERS_JSON:'[]',FAE_ECLIPSE_PINNED_PEERS_JSON:'[]',...extraEnv},stdio:['ignore','pipe','pipe']});child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);child.output=()=>({stdout,stderr});return child}
async function runToExit({port,operatorPort,dir,extraEnv}){const child=start({port,operatorPort,dir,extraEnv});const code=await new Promise(resolve=>child.once('exit',(value,signal)=>resolve(value??(signal?128:1))));return{code,...child.output()}}

test('executable eclipse candidate exposes read-only loopback readiness and preserves identity across restart',async context=>{
  const dir=await mkdtemp(join(tmpdir(),'fae-eclipse-entry-'));context.after(()=>rm(dir,{recursive:true,force:true}));
  const port=await freePort(),operatorPort=await freePort(),peerBase=`http://127.0.0.1:${port}`,operatorBase=`http://127.0.0.1:${operatorPort}`;

  let first=start({port,operatorPort,dir});context.after(()=>stop(first));
  const operator1=(await waitJson(`${operatorBase}/status`)).body;
  assert.equal(operator1.candidate,'peer-isolation-eclipse-v1');assert.equal(operator1.authority,'operator-observation-only');assert.equal(operator1.protocol_version,6);assert.equal(operator1.height,0);assert.equal(operator1.peer_view_authority,'eclipse-resistant-candidate-v1');assert.equal(operator1.peer_diversity.ready,false);assert.equal(operator1.peer_diversity.state,'HOLD');assert.ok(operator1.peer_diversity.violations.some(row=>row.code==='insufficient_out_of_band_anchors'));
  const identity=operator1.node_identity;

  const health=await request(`${operatorBase}/healthz`);assert.equal(health.status,200);assert.equal(health.body.ok,true);
  const ready=await request(`${operatorBase}/readyz`);assert.equal(ready.status,503);assert.equal(ready.body.ok,false);assert.equal(ready.body.state,'HOLD');
  const method=await request(`${operatorBase}/status`,{method:'POST'});assert.equal(method.status,405);assert.equal(method.body.error,'method_not_allowed');

  const publicStatus=(await waitJson(`${peerBase}/status`)).body;
  assert.equal(publicStatus.protocol_version,6);assert.equal(publicStatus.node_identity,identity);assert.equal(publicStatus.peer_view_authority,undefined,'candidate operator authority is not injected into the public protocol-6 status surface');

  await stop(first);assert.equal(first.exitCode,0,first.output().stderr);
  const second=start({port,operatorPort,dir});context.after(()=>stop(second));const operator2=(await waitJson(`${operatorBase}/status`)).body;
  assert.equal(operator2.node_identity,identity);assert.equal(operator2.peer_view_authority,'eclipse-resistant-candidate-v1');assert.equal(operator2.peer_diversity.state,'HOLD');
  await stop(second);assert.equal(second.exitCode,0,second.output().stderr);
});

test('executable eclipse candidate rejects endpoint-only peer configuration and remote operator bind',async context=>{
  const dir=await mkdtemp(join(tmpdir(),'fae-eclipse-entry-reject-'));context.after(()=>rm(dir,{recursive:true,force:true}));
  const endpointOnly=await runToExit({port:await freePort(),operatorPort:await freePort(),dir,extraEnv:{FAE_PEERS:'http://127.0.0.1:9999'}});
  assert.notEqual(endpointOnly.code,0);assert.match(endpointOnly.stderr,/FAE_PEERS is endpoint-only/);

  const remoteOperator=await runToExit({port:await freePort(),operatorPort:await freePort(),dir,extraEnv:{FAE_ECLIPSE_OPERATOR_HOST:'0.0.0.0'}});
  assert.notEqual(remoteOperator.code,0);assert.match(remoteOperator.stderr,/must remain loopback-only/);
});
