import http from 'node:http';
import { spawn } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { legacyBlocks } from './legacy-testnet-fixture.mjs';

const root=resolve(new URL('..',import.meta.url).pathname);
const nodeFile=join(root,'node','fae-node.mjs');
const temp=await mkdtemp(join(tmpdir(),'fae-partition-'));
const ports={a:18811,b:18812,c:18813,feed:18810};
const bases=Object.fromEntries(Object.entries(ports).filter(([k])=>k!=='feed').map(([k,p])=>[k,`http://127.0.0.1:${p}`]));
const data=Object.fromEntries(['a','b','c'].map(k=>[k,join(temp,`${k}.json`)]));
const children=new Map();
const NETWORK='fairyelf-public-testnet-v4';
const HRP='faet',CHARSET='qpzry9x8gf2tvdw0s3jn54khce6mua7l',BECH32M_CONST=0x2bc830a3;

function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));return value}
function stable(value){return JSON.stringify(canonical(value))}
function sha256(bytes){return createHash('sha256').update(bytes).digest()}
function doubleHash(value){return sha256(sha256(Buffer.from(stable(value)))).toString('hex')}
function leadingZeroBits(hash){let n=0;for(const c of hash){const v=parseInt(c,16);if(v===0){n+=4;continue}if(v<2)n+=3;else if(v<4)n+=2;else if(v<8)n++;break}return n}
function polymod(values){const g=[0x3b6a57b2,0x26508e6d,0x1ea119fa,0x3d4233dd,0x2a1462b3];let chk=1;for(const value of values){const top=chk>>>25;chk=((chk&0x1ffffff)<<5)^value;for(let i=0;i<5;i++)if((top>>>i)&1)chk^=g[i]}return chk>>>0}
function hrpExpand(hrp){return [...hrp].map(c=>c.charCodeAt(0)>>>5).concat([0],[...hrp].map(c=>c.charCodeAt(0)&31))}
function convertBits(data,fromBits,toBits,pad=true){let acc=0,bits=0;const out=[],mask=(1<<toBits)-1,maxAcc=(1<<(fromBits+toBits-1))-1;for(const value of data){acc=((acc<<fromBits)|value)&maxAcc;bits+=fromBits;while(bits>=toBits){bits-=toBits;out.push((acc>>>bits)&mask)}}if(pad&&bits)out.push((acc<<(toBits-bits))&mask);return out}
function addressFromSpki(spki){const payload=sha256(spki).subarray(0,20),data5=convertBits(payload,8,5,true),mod=(polymod([...hrpExpand(HRP),...data5,0,0,0,0,0,0])^BECH32M_CONST)>>>0,checksum=Array.from({length:6},(_,i)=>(mod>>>(5*(5-i)))&31);return HRP+'1'+[...data5,...checksum].map(v=>CHARSET[v]).join('')}
function delay(ms){return new Promise(r=>setTimeout(r,ms))}
async function json(url,options){const r=await fetch(url,options);const body=await r.json();if(!r.ok)throw Error(`${r.status} ${url}: ${JSON.stringify(body)}`);return body}
async function waitFor(name,height,mempool){for(let i=0;i<160;i++){try{const s=await json(bases[name]+'/status');if((height===undefined||s.height===height)&&(mempool===undefined||s.mempool_size===mempool))return s}catch{}await delay(50)}throw Error(`node ${name} did not reach expected state height=${height} mempool=${mempool}`)}
async function start(name,{sync='0',peers='',feeds=''}={}){const child=spawn(process.execPath,[nodeFile],{env:{...process.env,FAE_PORT:String(ports[name]),FAE_HOST:'127.0.0.1',FAE_DATA_FILE:data[name],FAE_SYNC:sync,FAE_SYNC_MS:'5000',FAE_UPSTREAM_API:'',FAE_PEERS:peers,FAE_BOOTSTRAP_FEEDS:feeds},stdio:['ignore','pipe','pipe']});let stderr='';child.stderr.on('data',d=>stderr+=d);child._stderr=()=>stderr;children.set(name,child);return child}
async function stop(name){const child=children.get(name);if(!child)return;child.kill('SIGTERM');await Promise.race([new Promise(r=>child.once('exit',r)),delay(500)]);children.delete(name)}
async function mine(name,address){const t=await json(`${bases[name]}/template?address=${encodeURIComponent(address)}`);let nonce=0,hash='';for(;nonce<=8_000_000;nonce++){hash=doubleHash({...t.header,nonce});if(leadingZeroBits(hash)>=t.header.difficulty_bits)break}if(nonce>8_000_000)throw Error('PoW bound exceeded');const payload={header:t.header,nonce,hash,txids:t.txids};const accepted=await json(bases[name]+'/submit-block',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});return{...payload,accepted}}
async function submitBlock(name,block){return json(bases[name]+'/submit-block',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({header:block.header,nonce:block.nonce,hash:block.hash,txids:block.txids})})}

const feed=http.createServer((req,res)=>{const u=new URL(req.url,'http://localhost'),from=Math.max(1,Number(u.searchParams.get('from')||1)),limit=Math.max(1,Number(u.searchParams.get('limit')||250)),blocks=legacyBlocks.filter(b=>b.height>=from&&b.height<from+limit);res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({ok:true,feed_version:1,network:NETWORK,from,limit,tip_height:11,tip_hash:legacyBlocks.at(-1).hash,blocks,transactions:[]}));});
await new Promise(r=>feed.listen(ports.feed,'127.0.0.1',r));

const signer=generateKeyPairSync('ed25519'),recipient=generateKeyPairSync('ed25519');
const spki=signer.publicKey.export({format:'der',type:'spki'}),minerAddress=addressFromSpki(spki),recipientAddress=addressFromSpki(recipient.publicKey.export({format:'der',type:'spki'}));

try{
  const feedBase=`http://127.0.0.1:${ports.feed}`;
  for(const name of ['a','b','c']){await start(name,{sync:'1',feeds:feedBase});await waitFor(name,11);await stop(name);await start(name);await waitFor(name,11)}
  feed.close();

  const common=await mine('a',minerAddress);
  await submitBlock('b',common);await submitBlock('c',common);
  for(const name of ['a','b','c'])await waitFor(name,12);

  const txBase={version:2,network:NETWORK,inputs:[`${common.hash}:0`],outputs:[{address:recipientAddress,amount_atoms:'1000000000'}],public_key_spki:spki.toString('base64')};
  const payload={domain:'FAIRYELF_TX_V2',network:NETWORK,inputs:txBase.inputs,outputs:txBase.outputs,public_key_spki:txBase.public_key_spki};
  const tx={...txBase,signature:sign(null,Buffer.from(stable(payload)),signer.privateKey).toString('base64')};
  const txid=doubleHash(tx);
  const acceptedTx=await json(bases.a+'/submit-tx',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({tx})});
  if(acceptedTx.txid!==txid)throw Error('txid mismatch');
  const orphan=await mine('a',minerAddress);
  if(!orphan.txids.includes(txid))throw Error('orphan branch did not confirm test transaction');
  await waitFor('a',13,0);

  await mine('b',minerAddress);await mine('b',minerAddress);await waitFor('b',14,0);
  if((await json(bases.a+'/status')).tip_hash===(await json(bases.b+'/status')).tip_hash)throw Error('partition did not create divergent tips');

  await stop('a');await start('a',{sync:'1',peers:bases.b});
  const recovered=await waitFor('a',14,1);
  if(recovered.tip_hash!==(await json(bases.b+'/status')).tip_hash)throw Error('node A did not adopt higher-work branch');
  await waitFor('b',14,1);

  await stop('c');await start('c',{sync:'1',peers:bases.b});await waitFor('c',14);
  const finalBlock=await mine('a',minerAddress);
  if(!finalBlock.txids.includes(txid))throw Error('recovered transaction not selected for mining');
  await waitFor('b',15,0);
  await stop('c');await start('c',{sync:'1',peers:`${bases.a},${bases.b}`});await waitFor('c',15);

  const statuses=await Promise.all(['a','b','c'].map(n=>json(bases[n]+'/status')));
  const tips=new Set(statuses.map(s=>s.tip_hash));if(tips.size!==1)throw Error('three nodes did not converge');
  const histories=await Promise.all(['a','b','c'].map(n=>json(`${bases[n]}/transactions?address=${encodeURIComponent(recipientAddress)}`)));
  for(const h of histories){const record=h.transactions.find(t=>t.txid===txid);if(!record||record.status!=='confirmed'||record.confirmed_height!==15)throw Error('transaction recovery confirmation mismatch')}
  console.log(JSON.stringify({ok:true,nodes:3,height:15,tip_hash:statuses[0].tip_hash,recovered_txid:txid,reconfirmed_height:15}));
} finally {
  for(const name of [...children.keys()])await stop(name);
  try{feed.close()}catch{}
  for(const [name,child] of children)if(child._stderr?.())process.stderr.write(`[${name}] ${child._stderr()}`);
  await rm(temp,{recursive:true,force:true});
}
