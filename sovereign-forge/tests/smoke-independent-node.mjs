import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root=resolve(new URL('..',import.meta.url).pathname);
const nodeFile=join(root,'node','fae-node.mjs');
const temp=await mkdtemp(join(tmpdir(),'fae-smoke-'));
const dataFile=join(temp,'state.json');
const port=18799;
const base=`http://127.0.0.1:${port}`;
const address='faet1z5g4r8qgv29jcy350mvxgr3hpk35vjhdk3s6fn';

function canonical(value){
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
  return value;
}
function doubleHash(value){
  const first=createHash('sha256').update(JSON.stringify(canonical(value))).digest();
  return createHash('sha256').update(first).digest('hex');
}
function leadingZeroBits(hash){
  let n=0;
  for(const c of hash){const v=parseInt(c,16);if(v===0){n+=4;continue}if(v<2)n+=3;else if(v<4)n+=2;else if(v<8)n++;break}
  return n;
}
async function waitForNode(){
  for(let i=0;i<80;i++){
    try{const r=await fetch(base+'/status');if(r.ok)return await r.json()}catch{}
    await new Promise(r=>setTimeout(r,50));
  }
  throw Error('node did not start');
}

const child=spawn(process.execPath,[nodeFile],{
  env:{...process.env,FAE_PORT:String(port),FAE_HOST:'127.0.0.1',FAE_DATA_FILE:dataFile,FAE_SYNC:'0',FAE_UPSTREAM_API:'',FAE_PEERS:'',FAE_BOOTSTRAP_FEEDS:''},
  stdio:['ignore','pipe','pipe']
});
let stderr='';child.stderr.on('data',d=>stderr+=d);
try{
  const initial=await waitForNode();
  if(initial.height!==0||initial.difficulty_bits!==18)throw Error('unexpected genesis state');
  const template=await (await fetch(`${base}/template?address=${encodeURIComponent(address)}`)).json();
  let nonce=0,hash='';
  while(true){
    hash=doubleHash({...template.header,nonce});
    if(leadingZeroBits(hash)>=template.header.difficulty_bits)break;
    nonce++;
    if(nonce>5_000_000)throw Error('smoke PoW search exceeded bound');
  }
  const submission=await fetch(base+'/submit-block',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({header:template.header,nonce,hash,txids:template.txids})});
  const accepted=await submission.json();
  if(!submission.ok||accepted.height!==1)throw Error('block rejected: '+JSON.stringify(accepted));
  const status=await (await fetch(base+'/status')).json();
  const balance=await (await fetch(`${base}/balance?address=${encodeURIComponent(address)}`)).json();
  if(status.height!==1||status.issued_atoms!=='1000000000'||balance.balance_atoms!=='1000000000')throw Error('post-block state mismatch');
  console.log(JSON.stringify({ok:true,height:status.height,difficulty_bits:status.difficulty_bits,nonce,hash,balance_fae:balance.balance_fae}));
} finally {
  child.kill('SIGTERM');
  await new Promise(resolve=>{child.once('exit',resolve);setTimeout(resolve,500)});
  await rm(temp,{recursive:true,force:true});
  if(stderr)process.stderr.write(stderr);
}
