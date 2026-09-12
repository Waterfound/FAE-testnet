#!/usr/bin/env node
import http from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';

const PORT = Number(process.env.PORT || 3184);
const NODE_ID = process.env.FAE_NODE_ID || `node-${PORT}`;
const REGION = process.env.FAE_REGION || 'local';
const TOKEN = process.env.FAE_LAB_TOKEN || 'local-test-token';
const TARGET_SECONDS = Number(process.env.FAE_TARGET_SECONDS || 300);
let PEERS = parsePeers(process.env.FAE_PEERS || '');
const GENESIS = '0'.repeat(64);

function parsePeers(value) { return String(value||'').split(',').map(x=>x.trim().replace(/\/$/,'')).filter(Boolean); }
function canonical(v){if(Array.isArray(v))return v.map(canonical);if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])]));return v;}
function hashBlockPayload(v){const a=createHash('sha256').update(JSON.stringify(canonical(v))).digest();return createHash('sha256').update(a).digest('hex');}
function auth(req){const got=String(req.headers['x-fae-lab-token']||'');const a=Buffer.from(got),b=Buffer.from(TOKEN);return a.length===b.length&&timingSafeEqual(a,b);}
function send(res,status,payload){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','access-control-allow-origin':'*','access-control-allow-headers':'content-type,x-fae-lab-token','access-control-allow-methods':'GET,POST,OPTIONS'});res.end(JSON.stringify(payload));}
async function body(req){let s='';for await(const c of req){s+=c;if(s.length>2_000_000)throw Error('body_too_large');}return s?JSON.parse(s):{};}
async function fetchJson(url,options={},timeout=8000){const c=new AbortController();const t=setTimeout(()=>c.abort(),timeout);try{const r=await fetch(url,{...options,signal:c.signal});const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(`${r.status}:${j.error||r.statusText}`);return j;}finally{clearTimeout(t);}}

let blocks = new Map();
let children = new Map();
let events = new Map();
let blockedPeers = new Set();
let tipHash = GENESIS;
let reorgCount = 0;
let seq = 0;
let autoProduce = { enabled:false, meanMs:null, produced:0, timer:null, generation:0, nextAtMs:null };

function stopAuto(){
  autoProduce.generation++;
  if(autoProduce.timer) clearTimeout(autoProduce.timer);
  autoProduce.timer=null; autoProduce.enabled=false; autoProduce.meanMs=null; autoProduce.nextAtMs=null;
}
function reset(){stopAuto();blocks=new Map([[GENESIS,{hash:GENESIS,height:0,parent:null,origin:'genesis',createdAtMs:0,seq:0}]]);children=new Map();events=new Map();tipHash=GENESIS;reorgCount=0;seq=0;autoProduce.produced=0;}
reset();
function pathToGenesis(h){const out=[];let cur=blocks.get(h);const seen=new Set();while(cur&&cur.hash!==GENESIS&&!seen.has(cur.hash)){seen.add(cur.hash);out.push(cur.hash);cur=blocks.get(cur.parent);}out.push(GENESIS);return out;}
function isAncestor(a,b){if(a===b)return true;let cur=blocks.get(b);const seen=new Set();while(cur&&cur.hash!==GENESIS&&!seen.has(cur.hash)){if(cur.parent===a)return true;seen.add(cur.hash);cur=blocks.get(cur.parent);}return a===GENESIS;}
function chooseTip(){let best=blocks.get(GENESIS);for(const b of blocks.values()){if(b.height>best.height||(b.height===best.height&&b.hash<best.hash))best=b;}return best.hash;}
function updateTip(){const old=tipHash;const next=chooseTip();if(next!==old){if(!isAncestor(old,next)&&old!==GENESIS)reorgCount++;tipHash=next;}return old!==tipHash;}
function canonicalSet(){return new Set(pathToGenesis(tipHash));}
function staleCount(){const c=canonicalSet();let n=0;for(const h of blocks.keys())if(h!==GENESIS&&!c.has(h))n++;return n;}
function branchTips(){const parents=new Set([...blocks.values()].filter(b=>b.parent).map(b=>b.parent));return [...blocks.values()].filter(b=>b.hash!==GENESIS&&!parents.has(b.hash)).map(b=>b.hash);}
function verifyBlock(b){if(!b||b.lab!=='FAE_WAN_LAB_V1'||typeof b.hash!=='string'||typeof b.parent!=='string'||!Number.isInteger(b.height)||b.height<1)return false;const payload={lab:b.lab,height:b.height,parent:b.parent,createdAtMs:b.createdAtMs,origin:b.origin,seq:b.seq,nonce:b.nonce};return hashBlockPayload(payload)===b.hash;}
function ingest(b,via='unknown',seenAt=Date.now()){
  if(blocks.has(b.hash)){if(!events.has(b.hash))events.set(b.hash,{hash:b.hash,firstSeenMs:seenAt,via});return {added:false,tipChanged:false};}
  if(!verifyBlock(b))throw Error('invalid_block_hash');
  const p=blocks.get(b.parent);if(!p)throw Error('missing_parent');if(b.height!==p.height+1)throw Error('bad_height');
  blocks.set(b.hash,structuredClone(b));if(!children.has(b.parent))children.set(b.parent,new Set());children.get(b.parent).add(b.hash);
  events.set(b.hash,{hash:b.hash,firstSeenMs:seenAt,via,origin:b.origin,height:b.height});
  const tipChanged=updateTip();
  if(tipChanged&&autoProduce.enabled)scheduleAuto();
  return {added:true,tipChanged};
}
function snapshot(){const hashes=pathToGenesis(tipHash).reverse();return hashes.map(h=>blocks.get(h));}
function baseUrl(){return process.env.FAE_PUBLIC_URL?.replace(/\/$/,'')||`http://127.0.0.1:${PORT}`;}
async function relay(b,except=''){const peers=PEERS.filter(p=>p!==except&&!blockedPeers.has(p));await Promise.allSettled(peers.map(p=>fetchJson(`${p}/ingest`,{method:'POST',headers:{'content-type':'application/json','x-fae-lab-token':TOKEN},body:JSON.stringify({block:b,from:baseUrl()})},5000)));}
async function syncPeer(peer){if(blockedPeers.has(peer))return;const s=await fetchJson(`${peer}/snapshot`,{},5000);if(!Array.isArray(s.chain))return;for(const b of s.chain.slice(1)){try{const r=ingest(b,peer,Date.now());if(r.added)await relay(b,peer);}catch{}}}
async function syncAll(){await Promise.allSettled(PEERS.map(syncPeer));}
setInterval(()=>syncAll().catch(()=>{}),1200).unref();

function mineLocal(nonce,parent=tipHash){
  const p=blocks.get(parent);if(!p)throw Error('unknown_parent');
  const payload={lab:'FAE_WAN_LAB_V1',height:p.height+1,parent,createdAtMs:Date.now(),origin:NODE_ID,seq:++seq,nonce:String(nonce??Math.floor(Math.random()*1e9))};
  const b={...payload,hash:hashBlockPayload(payload)};ingest(b,'local',Date.now());relay(b).catch(()=>{});return b;
}
function exponentialDelay(meanMs){return Math.max(1,Math.round(-Math.log(Math.max(1e-12,Math.random()))*meanMs));}
function scheduleAuto(){
  if(autoProduce.timer) clearTimeout(autoProduce.timer);
  autoProduce.timer=null;
  if(!autoProduce.enabled||!Number.isFinite(autoProduce.meanMs)||autoProduce.meanMs<=0)return;
  const generation=autoProduce.generation;
  const delay=exponentialDelay(autoProduce.meanMs);
  autoProduce.nextAtMs=Date.now()+delay;
  autoProduce.timer=setTimeout(()=>{
    autoProduce.timer=null;
    if(!autoProduce.enabled||generation!==autoProduce.generation)return;
    try{mineLocal(`auto-${NODE_ID}-${Date.now()}-${autoProduce.produced+1}`);autoProduce.produced++;}
    catch(e){console.warn('[FAE-WAN] auto-produce:',e.message);}
    finally{if(autoProduce.enabled&&generation===autoProduce.generation&&!autoProduce.timer)scheduleAuto();}
  },delay);
  autoProduce.timer.unref?.();
}
function setAuto(enabled,meanMs){
  if(!enabled){stopAuto();return;}
  const mean=Number(meanMs);if(!Number.isFinite(mean)||mean<100)throw Error('meanMs_must_be_at_least_100');
  autoProduce.generation++;autoProduce.enabled=true;autoProduce.meanMs=mean;scheduleAuto();
}
function autoStatus(){return {enabled:autoProduce.enabled,meanMs:autoProduce.meanMs,produced:autoProduce.produced,nextAtMs:autoProduce.nextAtMs};}

const server=http.createServer(async(req,res)=>{try{
  if(req.method==='OPTIONS'){res.writeHead(204,{'access-control-allow-origin':'*','access-control-allow-headers':'content-type,x-fae-lab-token','access-control-allow-methods':'GET,POST,OPTIONS'});return res.end();}
  const u=new URL(req.url,'http://localhost');
  if(u.pathname==='/'||u.pathname==='/status')return send(res,200,{ok:true,lab:'FAE_WAN_LAB_V1',nodeId:NODE_ID,region:REGION,targetSeconds:TARGET_SECONDS,height:blocks.get(tipHash).height,tipHash,knownBlocks:blocks.size-1,staleBlocks:staleCount(),branchTips:branchTips().length,reorgCount,peerCount:PEERS.length,blockedPeers:[...blockedPeers],autoProduce:autoStatus()});
  if(u.pathname==='/snapshot')return send(res,200,{ok:true,nodeId:NODE_ID,chain:snapshot()});
  if(u.pathname==='/events'){const limit=Math.max(1,Math.min(2000,Number(u.searchParams.get('limit')||500)));return send(res,200,{ok:true,nodeId:NODE_ID,events:[...events.values()].sort((a,b)=>a.firstSeenMs-b.firstSeenMs).slice(-limit)});}
  if(u.pathname==='/ingest'&&req.method==='POST'){if(!auth(req))return send(res,403,{ok:false,error:'forbidden'});const x=await body(req);const at=Date.now();let r;try{r=ingest(x.block,x.from||'peer',at);}catch(e){if(e.message==='missing_parent'){await syncAll();try{r=ingest(x.block,x.from||'peer',at);}catch(e2){return send(res,409,{ok:false,error:e2.message});}}else return send(res,400,{ok:false,error:e.message});}if(r.added)relay(x.block,x.from||'').catch(()=>{});return send(res,200,{ok:true,added:r.added,firstSeenMs:events.get(x.block.hash)?.firstSeenMs});}
  if(u.pathname==='/control/mine'&&req.method==='POST'){if(!auth(req))return send(res,403,{ok:false,error:'forbidden'});const x=await body(req);try{return send(res,200,{ok:true,block:mineLocal(x.nonce,x.parent||tipHash)});}catch(e){return send(res,409,{ok:false,error:e.message});}}
  if(u.pathname==='/control/auto-produce'&&req.method==='POST'){if(!auth(req))return send(res,403,{ok:false,error:'forbidden'});const x=await body(req);try{setAuto(x.enabled!==false,x.meanMs);return send(res,200,{ok:true,autoProduce:autoStatus()});}catch(e){return send(res,400,{ok:false,error:e.message});}}
  if(u.pathname==='/control/reset'&&req.method==='POST'){if(!auth(req))return send(res,403,{ok:false,error:'forbidden'});reset();return send(res,200,{ok:true});}
  if(u.pathname==='/control/peer-block'&&req.method==='POST'){if(!auth(req))return send(res,403,{ok:false,error:'forbidden'});const x=await body(req);const peer=String(x.peer||'').replace(/\/$/,'');if(!peer)return send(res,400,{ok:false,error:'peer_required'});if(x.blocked===false)blockedPeers.delete(peer);else blockedPeers.add(peer);return send(res,200,{ok:true,blockedPeers:[...blockedPeers]});}
  if(u.pathname==='/control/peers'&&req.method==='POST'){if(!auth(req))return send(res,403,{ok:false,error:'forbidden'});const x=await body(req);PEERS=parsePeers(Array.isArray(x.peers)?x.peers.join(','):x.peers||'');return send(res,200,{ok:true,peers:PEERS});}
  if(u.pathname==='/control/sync'&&req.method==='POST'){if(!auth(req))return send(res,403,{ok:false,error:'forbidden'});await syncAll();return send(res,200,{ok:true});}
  return send(res,404,{ok:false,error:'not_found'});
}catch(e){console.error(e);return send(res,500,{ok:false,error:e.message||String(e)});}});
server.listen(PORT,'0.0.0.0',()=>console.log(JSON.stringify({event:'listen',nodeId:NODE_ID,region:REGION,port:PORT,peers:PEERS,autoProduce:autoStatus()})));
