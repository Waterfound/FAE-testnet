import assert from 'node:assert/strict';
import test from 'node:test';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {generateKeyPairSync} from 'node:crypto';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {legacyBlocks} from './legacy-testnet-fixture.mjs';
import {emptyState,appendBlockFromFeed} from '../node/authoritative/fae-v4-core.mjs';
import {encodeAddress} from '../node/authoritative/address.mjs';
import {hashHex,leadingZeroBits,sha256} from '../node/authoritative/crypto.mjs';

const root=resolve(new URL('..',import.meta.url).pathname),entrypoint=join(root,'node','fae-node-v6-candidate.mjs');
function delay(ms){return new Promise(resolve=>setTimeout(resolve,ms))}
function legacyState(){let state=emptyState();for(const block of legacyBlocks)state=appendBlockFromFeed(state,block,new Map(),{activationHeight:null});return state}
function wallet(){const{publicKey}=generateKeyPairSync('ed25519'),spki=publicKey.export({type:'spki',format:'der'});return encodeAddress(sha256(spki).subarray(0,20),'faet')}
async function freePort(){const server=net.createServer();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port}
async function json(url,options={}){const response=await fetch(url,options),body=await response.json();if(!response.ok)throw new Error(`${response.status} ${url}: ${JSON.stringify(body)}`);return body}
async function waitStatus(base,height){let lastError=null;for(let i=0;i<200;i++){try{const status=await json(`${base}/status`);if(status.height===height)return status;lastError=new Error(`height=${status.height}`)}catch(error){lastError=error}await delay(50)}throw new Error(`node did not reach height ${height}: ${lastError?.message||'timeout'}`)}
async function waitDurableHeight(path,height){let last=null;for(let i=0;i<120;i++){try{const envelope=JSON.parse(await readFile(path,'utf8'));last=envelope?.state?.chain?.length;if(last===height)return envelope}catch{}await delay(50)}throw new Error(`durable snapshot did not reach height ${height}; last=${last}`)}
async function mine(base,address){const template=await json(`${base}/template?address=${encodeURIComponent(address)}`);let nonce=0,hash='';for(;nonce<12_000_000;nonce++){hash=hashHex({...template.header,nonce});if(leadingZeroBits(hash)>=template.header.difficulty_bits)break}if(nonce>=12_000_000)throw new Error('PoW search exhausted');await json(`${base}/submit-block`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({header:template.header,nonce,hash,txids:template.txids||[],coinbase_outputs:template.coinbase_outputs??null})});return hash}
function startProcess({port,dataFile,durableFile,identityFile,trustFile}){
  const child=spawn(process.execPath,[entrypoint],{env:{...process.env,FAE_HOST:'127.0.0.1',FAE_PORT:String(port),FAE_DATA_FILE:dataFile,FAE_DURABLE_STATE_FILE:durableFile,FAE_IDENTITY_FILE:identityFile,FAE_PEER_TRUST_FILE:trustFile,FAE_SYNC:'0',FAE_DURABLE_CHECKPOINT_MS:'1000'},stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);child.logs=()=>({stdout,stderr});return child;
}
async function hardStop(child){if(!child||child.exitCode!==null)return;child.kill('SIGKILL');await Promise.race([new Promise(resolve=>child.once('exit',resolve)),delay(2000)]);if(child.exitCode===null)throw new Error('child did not exit after SIGKILL')}

test('P2P v6 candidate survives hard crash and recovers corrupted raw state from durable snapshot',async context=>{
  const dir=await mkdtemp(join(tmpdir(),'fae-v11-process-'));context.after(()=>rm(dir,{recursive:true,force:true}));
  const dataFile=join(dir,'state.json'),durableFile=join(dir,'state.durable'),identityFile=join(dir,'identity.json'),trustFile=join(dir,'trust.json'),port=await freePort(),base=`http://127.0.0.1:${port}`,address=wallet();
  await writeFile(dataFile,`${JSON.stringify(legacyState(),null,2)}\n`);
  let child=null;context.after(()=>hardStop(child).catch(()=>{}));

  child=startProcess({port,dataFile,durableFile,identityFile,trustFile});
  await waitStatus(base,11);
  await mine(base,address);await waitStatus(base,12);await waitDurableHeight(durableFile,12);
  await hardStop(child);

  child=startProcess({port,dataFile,durableFile,identityFile,trustFile});
  const afterCrash=await waitStatus(base,12);assert.equal(afterCrash.height,12);
  await waitDurableHeight(durableFile,12);await hardStop(child);

  await writeFile(dataFile,'{"torn-write":');
  child=startProcess({port,dataFile,durableFile,identityFile,trustFile});
  const afterCorruption=await waitStatus(base,12);assert.equal(afterCorruption.height,12);
  const repaired=JSON.parse(await readFile(dataFile,'utf8'));assert.equal(repaired.chain.length,12,'raw state must be healed before node startup');

  const logs=child.logs();assert.match(logs.stdout,/fae-node-online/);assert.doesNotMatch(logs.stderr,/unrecoverable|uncaught/i);
});
