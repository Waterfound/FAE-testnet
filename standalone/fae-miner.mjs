#!/usr/bin/env node
'use strict';

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  NETWORK, buildSubmission, mineChunk, tipState, validAddress, validateTemplate
} from './mining-core.mjs';

const DEFAULTS=Object.freeze({
  chunkSize:2048,
  tipPollMs:2000,
  reconnectMinMs:1000,
  reconnectMaxMs:30000,
  rateIntervalMs:1000,
  yieldMs:0
});
const PERSISTED_KEYS=Object.freeze(['node','address','chunk_size','tip_poll_ms','reconnect_min_ms','reconnect_max_ms','rate_interval_ms','yield_ms']);

class NodeUnavailableError extends Error{
  constructor(message,cause=null){super(message);this.name='NodeUnavailableError';this.cause=cause}
}
class ProtocolError extends Error{
  constructor(message,details=null){super(message);this.name='ProtocolError';this.details=details}
}
class HttpError extends Error{
  constructor(status,payload){super(payload?.error||payload?.reason||`HTTP ${status}`);this.name='HttpError';this.status=status;this.payload=payload}
}

function help(){
  return `FAE Sovereign Standalone Miner

Usage:
  node standalone/fae-miner.mjs --node <endpoint> --address <faet1...> [options]

Required (directly or through --config):
  --node <url>               Selected FAE node endpoint
  --address <faet1...>       Public reward address only

Options:
  --config <file>            Read secret-free miner configuration
  --save-config <file>       Persist only public endpoint/address + performance settings
  --chunk-size <n>           Hashes per cooperative CPU chunk (default 2048)
  --tip-poll-ms <n>          Authoritative tip recheck cadence (default 2000)
  --rate-interval-ms <n>     Hashrate output cadence (default 1000)
  --reconnect-min-ms <n>     Initial node reconnect delay (default 1000)
  --reconnect-max-ms <n>     Maximum node reconnect delay (default 30000)
  --yield-ms <n>             Optional sleep after each hash chunk (default 0)
  --nonce-start <n>          Explicit initial nonce for reproducible runs
  --once                     Stop after the first accepted block
  --json                     Emit line-delimited JSON state events
  --help                     Show this help

Security:
  Mining never accepts or stores seed phrases, private keys, wallet passphrases,
  vault material, or signing authority. Remote endpoints require HTTPS by default;
  plain HTTP is accepted only for localhost/loopback nodes.
`;
}

function parseInteger(value,name,{min=0,max=Number.MAX_SAFE_INTEGER}={}){
  if(!/^\d+$/.test(String(value??'')))throw Error(`${name} must be an integer`);
  const parsed=Number(value);
  if(!Number.isSafeInteger(parsed)||parsed<min||parsed>max)throw Error(`${name} out of range`);
  return parsed;
}

export function parseArgs(argv){
  const args={};
  for(let index=0;index<argv.length;index++){
    const token=argv[index];
    if(token==='--help'){args.help=true;continue}
    if(token==='--once'){args.once=true;continue}
    if(token==='--json'){args.json=true;continue}
    if(!token.startsWith('--'))throw Error(`Unexpected argument: ${token}`);
    const key=token.slice(2);
    const value=argv[++index];
    if(value===undefined||value.startsWith('--'))throw Error(`Missing value for --${key}`);
    args[key]=value;
  }
  return args;
}

function isLoopback(hostname){
  return hostname==='localhost'||hostname==='127.0.0.1'||hostname==='[::1]'||hostname==='::1';
}

export function normalizeNodeEndpoint(value){
  let url;
  try{url=new URL(String(value))}catch{throw Error('Invalid node endpoint')}
  if(url.username||url.password)throw Error('Node endpoint credentials are not allowed');
  if(url.search||url.hash)throw Error('Node endpoint query/hash is not allowed');
  if(url.protocol!=='https:'&&!(url.protocol==='http:'&&isLoopback(url.hostname)))throw Error('Remote node endpoint must use HTTPS');
  url.pathname=url.pathname.replace(/\/+$/,'');
  return url.toString().replace(/\/$/,'');
}

async function readConfig(path){
  if(!path)return{};
  const parsed=JSON.parse(await readFile(resolve(path),'utf8'));
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error('Miner config must be a JSON object');
  const forbidden=['seed','mnemonic','private','passphrase','secret','signing','vault','recovery'];
  for(const key of Object.keys(parsed)){
    if(forbidden.some(word=>key.toLowerCase().includes(word)))throw Error(`Forbidden secret-bearing config field: ${key}`);
    if(!PERSISTED_KEYS.includes(key))throw Error(`Unknown miner config field: ${key}`);
  }
  return parsed;
}

function resolveOptions(args,config){
  const node=normalizeNodeEndpoint(args.node??config.node??'');
  const address=String(args.address??config.address??'');
  if(!validAddress(address))throw Error('Invalid FAE reward address');
  return Object.freeze({
    node,address,
    chunkSize:parseInteger(args['chunk-size']??config.chunk_size??DEFAULTS.chunkSize,'chunk-size',{min:1,max:1_000_000}),
    tipPollMs:parseInteger(args['tip-poll-ms']??config.tip_poll_ms??DEFAULTS.tipPollMs,'tip-poll-ms',{min:100,max:300_000}),
    reconnectMinMs:parseInteger(args['reconnect-min-ms']??config.reconnect_min_ms??DEFAULTS.reconnectMinMs,'reconnect-min-ms',{min:100,max:300_000}),
    reconnectMaxMs:parseInteger(args['reconnect-max-ms']??config.reconnect_max_ms??DEFAULTS.reconnectMaxMs,'reconnect-max-ms',{min:100,max:900_000}),
    rateIntervalMs:parseInteger(args['rate-interval-ms']??config.rate_interval_ms??DEFAULTS.rateIntervalMs,'rate-interval-ms',{min:100,max:300_000}),
    yieldMs:parseInteger(args['yield-ms']??config.yield_ms??DEFAULTS.yieldMs,'yield-ms',{min:0,max:60_000}),
    nonceStart:args['nonce-start']===undefined?null:parseInteger(args['nonce-start'],'nonce-start'),
    once:Boolean(args.once),
    json:Boolean(args.json)
  });
}

async function saveConfig(path,options){
  if(!path)return;
  const persisted={
    node:options.node,
    address:options.address,
    chunk_size:options.chunkSize,
    tip_poll_ms:options.tipPollMs,
    reconnect_min_ms:options.reconnectMinMs,
    reconnect_max_ms:options.reconnectMaxMs,
    rate_interval_ms:options.rateIntervalMs,
    yield_ms:options.yieldMs
  };
  const target=resolve(path);
  await mkdir(dirname(target),{recursive:true});
  await writeFile(target,JSON.stringify(persisted,null,2)+'\n',{mode:0o600});
}

function sleep(ms){
  return new Promise(resolve=>setTimeout(resolve,ms));
}

async function fetchJson(base,path,{method='GET',body,timeoutMs=7000}={}){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    let response;
    try{
      response=await fetch(base+path,{
        method,
        signal:controller.signal,
        headers:body===undefined?undefined:{'content-type':'application/json'},
        body:body===undefined?undefined:JSON.stringify(body)
      });
    }catch(error){
      throw new NodeUnavailableError(error.name==='AbortError'?'Node request timed out':'Node request failed',error);
    }
    const payload=await response.json().catch(()=>({}));
    if(!response.ok)throw new HttpError(response.status,payload);
    return payload;
  }finally{
    clearTimeout(timer);
  }
}

function isStaleError(error){
  return error instanceof HttpError&&(error.status===409)&&(error.payload?.error==='stale_tip'||error.payload?.reason==='stale_tip'||error.payload?.reason==='race_lost');
}

export function createEmitter({json=false,write=line=>process.stdout.write(line+'\n')}={}){
  let sequence=0;
  return (state,message,details={})=>{
    sequence++;
    if(json){
      write(JSON.stringify({seq:sequence,state,message,...details}));
    }else{
      const suffix=Object.keys(details).length?' · '+Object.entries(details).map(([key,value])=>`${key}=${value}`).join(' · '):'';
      write(`[${state}] ${message}${suffix}`);
    }
  };
}

function randomNonceStart(){
  return Math.floor(Math.random()*1_000_000_000);
}

export async function runMiner(options,{emit=createEmitter({json:options.json}),signal}={}){
  let stopping=false;
  const onAbort=()=>{stopping=true};
  signal?.addEventListener?.('abort',onAbort,{once:false});
  let accepted=0,rejected=0,totalHashes=0,workReplacements=0;
  let reconnectDelay=options.reconnectMinMs;

  const result=()=>({accepted,rejected,totalHashes,workReplacements});
  try{
    while(!stopping){
      try{
        emit('CONNECTING','Connecting to selected node',{node:options.node});
        const initialStatus=await fetchJson(options.node,'/status');
        if(initialStatus.network!==undefined&&initialStatus.network!==NETWORK)throw new ProtocolError('Node network mismatch',initialStatus);
        reconnectDelay=options.reconnectMinMs;

        const rawTemplate=await fetchJson(options.node,'/template?address='+encodeURIComponent(options.address));
        const template=validateTemplate(rawTemplate,{address:options.address});
        emit('TEMPLATE_READY','Validated mining template',{height:template.header.height,node:options.node});
        emit('MINING','Local Proof of Work started',{height:template.header.height,target_bits:template.header.difficulty_bits});

        let nonce=options.nonceStart??randomNonceStart();
        let lastTipCheck=Date.now(),lastRate=Date.now(),rateHashes=0;
        let replaceWork=false;

        while(!stopping&&!replaceWork){
          const cycle=mineChunk(template.header,{startNonce:nonce,maxHashes:options.chunkSize});
          nonce=cycle.nextNonce;
          totalHashes+=cycle.attempts;
          rateHashes+=cycle.attempts;
          const now=Date.now();

          if(now-lastRate>=options.rateIntervalMs){
            const rate=Math.round(rateHashes/Math.max(0.001,(now-lastRate)/1000));
            emit('MINING','Proof of Work active',{height:template.header.height,hashrate_hs:rate,total_hashes:totalHashes});
            lastRate=now;rateHashes=0;
          }

          if(cycle.found){
            let status;
            try{status=await fetchJson(options.node,'/status')}
            catch(error){if(error instanceof NodeUnavailableError)throw error;throw new ProtocolError('Could not validate pre-submit tip',error)}
            const freshness=tipState(template.header,status);
            if(freshness!=='current'){
              rejected++;workReplacements++;
              emit('WORK_REJECTED',freshness==='stale'?'Template became stale before submission':'Template freshness could not be proven',{height:template.header.height,reason:freshness});
              replaceWork=true;
              break;
            }
            const submission=buildSubmission(rawTemplate,cycle.nonce,cycle.hash);
            try{
              const response=await fetchJson(options.node,'/submit-block',{method:'POST',body:submission});
              accepted++;
              emit('WORK_ACCEPTED','Block accepted by selected node',{height:response.height??template.header.height,hash:response.hash??cycle.hash,accepted,rejected});
              if(options.once)return result();
              replaceWork=true;
              break;
            }catch(error){
              rejected++;
              if(isStaleError(error)){
                workReplacements++;
                emit('WORK_REJECTED','Node rejected stale work; requesting a fresh template',{height:template.header.height,reason:'stale_tip',accepted,rejected});
                replaceWork=true;
                break;
              }
              if(error instanceof NodeUnavailableError)throw error;
              emit('WORK_REJECTED','Node rejected submitted work',{height:template.header.height,reason:error.message,accepted,rejected});
              throw new ProtocolError('Non-stale block rejection',error);
            }
          }

          if(now-lastTipCheck>=options.tipPollMs){
            const status=await fetchJson(options.node,'/status');
            const freshness=tipState(template.header,status);
            lastTipCheck=Date.now();
            if(freshness==='stale'){
              rejected++;workReplacements++;
              emit('WORK_REJECTED','Authoritative node tip advanced; replacing stale work',{height:template.header.height,reason:'stale_tip',accepted,rejected});
              replaceWork=true;
              break;
            }
            if(freshness==='unknown')throw new ProtocolError('Tip freshness unknown',status);
          }

          if(options.yieldMs>0)await sleep(options.yieldMs);
          else await new Promise(resolve=>setImmediate(resolve));
        }
      }catch(error){
        if(stopping)break;
        if(error instanceof NodeUnavailableError){
          emit('NODE_UNAVAILABLE',error.message,{node:options.node});
          emit('RECONNECTING','Retrying selected node after bounded backoff',{delay_ms:reconnectDelay});
          await sleep(reconnectDelay);
          reconnectDelay=Math.min(options.reconnectMaxMs,Math.max(options.reconnectMinMs,reconnectDelay*2));
          continue;
        }
        throw error;
      }
    }
    return result();
  }finally{
    signal?.removeEventListener?.('abort',onAbort);
    emit('STOPPED','Mining stopped locally',{accepted,rejected,total_hashes:totalHashes,work_replacements:workReplacements});
  }
}

export async function main(argv=process.argv.slice(2)){
  let args;
  try{args=parseArgs(argv)}catch(error){process.stderr.write(error.message+'\n\n'+help());return 2}
  if(args.help){process.stdout.write(help());return 0}
  try{
    const config=await readConfig(args.config);
    const options=resolveOptions(args,config);
    if(options.reconnectMaxMs<options.reconnectMinMs)throw Error('reconnect-max-ms must be >= reconnect-min-ms');
    await saveConfig(args['save-config'],options);
    const controller=new AbortController();
    const stop=()=>controller.abort();
    process.once('SIGINT',stop);
    process.once('SIGTERM',stop);
    try{
      await runMiner(options,{emit:createEmitter({json:options.json}),signal:controller.signal});
      return 0;
    }finally{
      process.removeListener('SIGINT',stop);
      process.removeListener('SIGTERM',stop);
    }
  }catch(error){
    process.stderr.write(`FAE miner error: ${error.message}\n`);
    return error instanceof ProtocolError?3:2;
  }
}

const isEntrypoint=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(isEntrypoint){
  process.exitCode=await main();
}
