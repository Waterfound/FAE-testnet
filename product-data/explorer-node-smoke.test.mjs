import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createExplorerReadAdapter,ExplorerDataError} from './explorer-read-adapter.mjs';

async function openPort(){
 const server=createServer();
 await new Promise((ok,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',ok);});
 const port=server.address().port;
 await new Promise(ok=>server.close(ok));
 return port;
}
async function pause(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
test('actual independently validating node: isolated empty-chain GET surface matches adapter', {timeout:18000},async t=>{
 const dir=await mkdtemp(join(tmpdir(),'fae-explorer-candidate-'));
 const port=await openPort();
 const origin='http://127.0.0.1:'+port+'/';
 const worker=spawn(process.execPath,[resolve('sovereign-forge/node/fae-node.mjs')],{
   cwd:dir,stdio:'ignore',
   env:{...process.env,FAE_PORT:String(port),FAE_HOST:'127.0.0.1',FAE_DATA_FILE:join(dir,'fae-state.json'),
     FAE_SYNC:'0',FAE_UPSTREAM_API:'',FAE_BOOTSTRAP_FEEDS:'',FAE_PEERS:''}
 });
 t.after(async()=>{
   if(worker.exitCode===null){worker.kill('SIGTERM');await Promise.race([new Promise(ok=>worker.once('exit',ok)),pause(2000)]);}
   await rm(dir,{recursive:true,force:true});
 });
 let live=false;
 for(let i=0;i<70;i++){
   if(worker.exitCode!==null)throw Error('FAE node stopped before readiness');
   try{const r=await fetch(origin+'explorer/status');if(r.ok){live=true;break;}}catch{}
   await pause(100);
 }
 assert.ok(live,'FAE node must serve its own read-only explorer API');
 const adapter=createExplorerReadAdapter({baseUrl:origin,timeoutMs:3000});
 const {tip,data}=await adapter.status();
 assert.equal(tip.network,'fairyelf-public-testnet-v4');
 assert.equal(tip.height,0);
 assert.equal(tip.hash,'0'.repeat(64));
 assert.equal(data.mempool_size,0);
 assert.equal(data.issued_atoms,'0');
 const blocks=await adapter.blocks({limit:5,expectedTip:tip});
 assert.equal(blocks.blocks.length,0);
 assert.equal(blocks.nextBeforeHeight,null);
 await assert.rejects(adapter.search({query:'1',expectedTip:tip}),
   e=>e instanceof ExplorerDataError&&e.code==='NODE_HTTP_ERROR'&&e.status===404);
 await assert.rejects(adapter.transaction({txid:'b'.repeat(64),expectedTip:tip}),
   e=>e instanceof ExplorerDataError&&e.code==='NODE_HTTP_ERROR'&&e.status===404);
 const wrong=createExplorerReadAdapter({baseUrl:origin,expectedNetwork:'not-fae'});
 await assert.rejects(wrong.status(),e=>e instanceof ExplorerDataError&&e.code==='NETWORK_MISMATCH');
});
