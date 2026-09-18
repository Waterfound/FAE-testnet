#!/usr/bin/env node
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {createAuthoritativeV4PeerNode} from '../node/authoritative/fae-v4-peer-node.mjs';
import {prepareIndependentNodeStorage} from '../node/authoritative/node-state-recovery.mjs';
import {loadNodeIdentity} from '../node/authoritative/node-identity.mjs';

const role=(process.env.FAE_V3_ROLE||'').trim();
const runId=(process.env.FAE_V3_RUN_ID||'PREPARED_NOT_STARTED').trim();
if(!/^node-[abc]$/.test(role))throw new Error('FAE_V3_ROLE must be node-a, node-b, or node-c');

function list(value){return [...new Set(String(value||'').split(',').map(x=>x.trim()).filter(Boolean))]}
function int(value,fallback,{min=0,max=Number.MAX_SAFE_INTEGER}={}){if(value===undefined||value===null||String(value).trim()==='')return fallback;const n=Number(value);if(!Number.isSafeInteger(n)||n<min||n>max)throw new Error(`invalid_integer:${value}`);return n}
function json(res,status,payload){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(payload))}
function sleep(ms){return new Promise(r=>setTimeout(r,ms))}

const externalPort=int(process.env.PORT,10000,{min:1,max:65535});
const internalPort=int(process.env.FAE_V3_INTERNAL_PORT,8787,{min:1,max:65535});
if(externalPort===internalPort)throw new Error('external and internal ports must differ');

const peers=list(process.env.FAE_PEERS);
if(peers.length<2)throw new Error('FAE_PEERS must contain at least two stable peer bootstrap URLs');
const monitorUrls=list(process.env.FAE_V3_MONITOR_URLS);

const baseDir=resolve(process.env.FAE_V3_STATE_DIR||`/tmp/fae-v3-${role}`);
const dataFile=resolve(process.env.FAE_DATA_FILE||`${baseDir}/state.json`);
const durableFile=resolve(process.env.FAE_DURABLE_STATE_FILE||`${baseDir}/state.durable`);
const trustFile=resolve(process.env.FAE_PEER_TRUST_FILE||`${baseDir}/peer-trust.json`);

async function materializeIdentity(){
  const explicit=(process.env.FAE_IDENTITY_FILE||'').trim();
  if(explicit){
    const id=loadNodeIdentity(resolve(explicit));
    return {path:resolve(explicit),identity:id,source:'configured_file'};
  }
  const encoded=(process.env.FAE_NODE_IDENTITY_JSON_B64||'').trim();
  if(!encoded)throw new Error('stable_node_identity_required: set FAE_IDENTITY_FILE or FAE_NODE_IDENTITY_JSON_B64');
  let text;
  try{text=Buffer.from(encoded,'base64').toString('utf8')}catch{throw new Error('invalid_identity_base64')}
  const path=resolve(`${baseDir}/identity.json`);
  await mkdir(dirname(path),{recursive:true});
  await writeFile(path,text.endsWith('\n')?text:`${text}\n`,{encoding:'utf8',mode:0o600});
  const identity=loadNodeIdentity(path);
  return {path,identity,source:'environment_rematerialized'};
}

const identityRecord=await materializeIdentity();
const bootId=randomUUID();
const processStartedAt=new Date().toISOString();
const recovery=await prepareIndependentNodeStorage({dataFile,durableFile,activationHeight:null});
const node=createAuthoritativeV4PeerNode({
  host:'127.0.0.1',
  port:internalPort,
  dataFile,
  identityFile:identityRecord.path,
  peerTrustFile:trustFile,
  peers,
  publicUrl:(process.env.RENDER_EXTERNAL_URL||'').trim()||null,
  activationHeight:null,
  syncIntervalMs:5000
});

let checkpointBusy=false,checkpointTimer=null,keepaliveTimer=null,stopping=false;
async function checkpoint(reason){
  if(checkpointBusy)return;
  checkpointBusy=true;
  try{
    const result=await recovery.checkpoint(node.getState());
    if(result.saved)console.log(JSON.stringify({event:'FAE_V3_NODE_CHECKPOINT',run_id:runId,role,boot_id:bootId,reason,generation:result.generation,state_hash:result.state_hash,at:new Date().toISOString()}));
  }finally{checkpointBusy=false}
}
await node.start();
await checkpoint('startup');
const initialSync=await node.syncPeers();
await checkpoint('post_initial_sync');

console.log(JSON.stringify({
  event:'FAE_V3_NODE_BOOT',run_id:runId,role,boot_id:bootId,process_started_at:processStartedAt,
  render_instance_id:process.env.RENDER_INSTANCE_ID||null,render_service_id:process.env.RENDER_SERVICE_ID||null,
  render_git_commit:process.env.RENDER_GIT_COMMIT||null,node_identity:identityRecord.identity.id,
  identity_source:identityRecord.source,configured_peers:peers.length,recovery:recovery.status(),
  initial_sync:initialSync.map(x=>({peer:x.peer,adopted:x.adopted??false,reason:x.reason??null,error:x.error??null}))
}));

checkpointTimer=setInterval(()=>checkpoint('interval').catch(error=>console.error(JSON.stringify({event:'FAE_V3_NODE_CHECKPOINT_ERROR',run_id:runId,role,boot_id:bootId,error:error.message,at:new Date().toISOString()}))),5000);
checkpointTimer.unref?.();

async function keepMonitorsAwake(){
  await Promise.allSettled(monitorUrls.map(async base=>{
    const response=await fetch(`${base.replace(/\/$/,'')}/v3/health`,{signal:AbortSignal.timeout(4000)});
    if(!response.ok)throw new Error(`monitor_http_${response.status}`);
  }));
}
if(monitorUrls.length){
  setTimeout(()=>void keepMonitorsAwake(),5000).unref?.();
  keepaliveTimer=setInterval(()=>void keepMonitorsAwake(),5*60_000);
  keepaliveTimer.unref?.();
}

function meta(anchorHeight=null){
  const state=node.getState(),status=node.status(),height=status.height;
  let anchor=null;
  if(Number.isSafeInteger(anchorHeight)&&anchorHeight>0&&anchorHeight<=state.chain.length){
    const b=state.chain[anchorHeight-1];
    anchor={height:anchorHeight,hash:b.hash};
  }
  return {
    ok:true,run_id:runId,role,boot_id:bootId,process_started_at:processStartedAt,
    render_instance_id:process.env.RENDER_INSTANCE_ID||null,render_service_id:process.env.RENDER_SERVICE_ID||null,
    render_git_commit:process.env.RENDER_GIT_COMMIT||null,node_identity:identityRecord.identity.id,
    identity_source:identityRecord.source,status,recovery:recovery.status(),anchor,
    tail:state.chain.slice(-4).map(b=>({height:b.height,hash:b.hash,previous_hash:b.previous_hash,timestamp_ms:b.timestamp_ms}))
  };
}

const proxy=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url||'/','http://v3.invalid');
    if(url.pathname==='/v3/health')return json(res,200,{ok:true,run_id:runId,role,boot_id:bootId,at:new Date().toISOString()});
    if(url.pathname==='/v3/meta'){
      const raw=url.searchParams.get('anchor_height'),anchor=raw===null?null:Number(raw);
      return json(res,200,meta(Number.isSafeInteger(anchor)?anchor:null));
    }
    if(url.pathname==='/v3/chain-summary'){
      const state=node.getState();
      return json(res,200,{ok:true,run_id:runId,role,boot_id:bootId,node_identity:identityRecord.identity.id,blocks:state.chain.map(b=>({height:b.height,hash:b.hash,previous_hash:b.previous_hash,timestamp_ms:b.timestamp_ms}))});
    }

    const upstream=http.request({
      hostname:'127.0.0.1',port:internalPort,path:req.url,method:req.method,headers:req.headers
    },up=>{
      res.writeHead(up.statusCode||502,up.headers);
      up.pipe(res);
    });
    upstream.on('error',error=>json(res,502,{ok:false,error:'upstream_error',detail:error.message}));
    req.pipe(upstream);
  }catch(error){json(res,500,{ok:false,error:error.message})}
});
await new Promise((resolve,reject)=>{proxy.once('error',reject);proxy.listen(externalPort,'0.0.0.0',()=>{proxy.off('error',reject);resolve()})});
console.log(JSON.stringify({event:'FAE_V3_NODE_PROXY_ONLINE',run_id:runId,role,boot_id:bootId,external_port:externalPort,internal_port:internalPort,at:new Date().toISOString()}));

async function stop(signal){
  if(stopping)return;stopping=true;
  clearInterval(checkpointTimer);if(keepaliveTimer)clearInterval(keepaliveTimer);
  console.log(JSON.stringify({event:'FAE_V3_NODE_STOP',run_id:runId,role,boot_id:bootId,signal,at:new Date().toISOString()}));
  try{await checkpoint('shutdown')}catch{}
  await new Promise(resolve=>proxy.close(()=>resolve())).catch(()=>{});
  await node.close().catch(()=>{});
}
process.on('SIGTERM',()=>void stop('SIGTERM'));
process.on('SIGINT',()=>void stop('SIGINT'));
