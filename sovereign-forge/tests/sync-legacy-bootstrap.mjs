import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root=resolve(new URL('..',import.meta.url).pathname);
const nodeFile=join(root,'node','fae-node.mjs');
const temp=await mkdtemp(join(tmpdir(),'fae-legacy-sync-'));
const port=18801, feedPort=18802;
const base=`http://127.0.0.1:${port}`;
const feedBase=`http://127.0.0.1:${feedPort}`;
const block={height:1,hash:'0000391ae913006a6c1ab07760675e71067dfc40f893416b4bcb81eac75989bc',previous_hash:'0000000000000000000000000000000000000000000000000000000000000000',timestamp_ms:1788294567651,difficulty_bits:18,nonce:854728004,miner_address:'faet13app6ej5jj6rle6ej4ck7qxh252jj0j6fd0xap',reward_atoms:'1000000000',header_json:{nonce:854728004,height:1,network:'fairyelf-public-testnet-v4',reward_atoms:'1000000000',timestamp_ms:1788294567651,miner_address:'faet13app6ej5jj6rle6ej4ck7qxh252jj0j6fd0xap',previous_hash:'0000000000000000000000000000000000000000000000000000000000000000',difficulty_bits:18},txids:[]};
const feed=http.createServer((req,res)=>{const u=new URL(req.url,'http://localhost');const from=Number(u.searchParams.get('from')||1);res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({ok:true,feed_version:1,network:'fairyelf-public-testnet-v4',from,limit:250,tip_height:1,tip_hash:block.hash,blocks:from<=1?[block]:[],transactions:[]}));});
await new Promise(r=>feed.listen(feedPort,'127.0.0.1',r));
const child=spawn(process.execPath,[nodeFile],{env:{...process.env,FAE_PORT:String(port),FAE_HOST:'127.0.0.1',FAE_DATA_FILE:join(temp,'state.json'),FAE_SYNC:'1',FAE_SYNC_MS:'60000',FAE_UPSTREAM_API:'',FAE_PEERS:'',FAE_BOOTSTRAP_FEEDS:feedBase},stdio:['ignore','pipe','pipe']});
let stderr='';child.stderr.on('data',d=>stderr+=d);
async function wait(){for(let i=0;i<120;i++){try{const r=await fetch(base+'/status');if(r.ok){const s=await r.json();if(s.height===1)return s}}catch{}await new Promise(r=>setTimeout(r,50))}throw Error('node did not sync historical bootstrap');}
try{const s=await wait();if(s.tip_hash!==block.hash||s.issued_atoms!=='1000000000')throw Error('historical sync state mismatch');console.log(JSON.stringify({ok:true,height:s.height,tip_hash:s.tip_hash,legacy_bootstrap:true}));}
finally{child.kill('SIGTERM');feed.close();await new Promise(r=>setTimeout(r,100));await rm(temp,{recursive:true,force:true});if(stderr)process.stderr.write(stderr);}
