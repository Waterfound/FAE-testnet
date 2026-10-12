import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

const root=resolve(new URL('..',import.meta.url).pathname),entry=join(root,'node','fae-node-v6-candidate.mjs');
function delay(ms){return new Promise(resolve=>setTimeout(resolve,ms))}
async function freePort(){const server=http.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port}
async function waitStatus(base){for(let i=0;i<120;i++){try{const response=await fetch(`${base}/status`);if(response.ok)return response.json()}catch{}await delay(50)}throw new Error('candidate entrypoint did not become ready')}
async function stop(child){if(child.exitCode!==null)return;child.kill('SIGTERM');await Promise.race([new Promise(resolve=>child.once('exit',resolve)),delay(2000)]);if(child.exitCode===null)child.kill('SIGKILL')}
function start({port,dir}){let stderr='';const child=spawn(process.execPath,[entry],{env:{...process.env,FAE_HOST:'127.0.0.1',FAE_PORT:String(port),FAE_DATA_FILE:join(dir,'state.json'),FAE_IDENTITY_FILE:join(dir,'identity.json'),FAE_PEER_TRUST_FILE:join(dir,'trust.json'),FAE_SYNC:'0',FAE_PEERS:'',FAE_PUBLIC_URL:'',FAE_PPLNS_COINBASE_ACTIVATION_HEIGHT:''},stdio:['ignore','pipe','pipe']});child.stderr.on('data',chunk=>stderr+=chunk);child.getStderr=()=>stderr;return child}

test('executable P2P v6 candidate starts fail-closed and preserves node identity across restart',async context=>{
  const dir=await mkdtemp(join(tmpdir(),'fae-v6-entry-'));context.after(()=>rm(dir,{recursive:true,force:true}));const port=await freePort(),base=`http://127.0.0.1:${port}`;
  let first=start({port,dir});context.after(()=>stop(first));const status1=await waitStatus(base);
  assert.equal(status1.protocol_version,6);assert.equal(status1.height,0);assert.equal(status1.pplns_coinbase_activation_height,null);assert.equal(status1.peer_diversity.ready,false);assert.ok(status1.peer_diversity.violations.some(row=>row.code==='insufficient_out_of_band_anchors'));
  const identity=status1.node_identity;await stop(first);

  const second=start({port,dir});context.after(()=>stop(second));const status2=await waitStatus(base);
  assert.equal(status2.node_identity,identity);assert.equal(status2.protocol_version,6);assert.equal(status2.pplns_coinbase_activation_height,null);assert.equal(status2.height,0);
  await stop(second);
  assert.equal(second.exitCode,0,second.getStderr());
});
