#!/usr/bin/env node
'use strict';

import {spawn} from 'node:child_process';
import {mkdtemp, readFile, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const here=resolve(fileURLToPath(new URL('.',import.meta.url)));
const repoRoot=resolve(here,'../..');
const nodeSource=join(repoRoot,'sovereign-forge/node/fae-node.mjs');
const gatewaySource=join(here,'be05-readonly-gateway.mjs');
const explorerOrigin='https://fae-block-explorer-e2z4q3.v2.appdeploy.ai';

const NODE_HEAP_MIB=384;
const GATEWAY_HEAP_MIB=128;
const APPLICATION_RSS_CEILING_MIB=512;
const HOST_TOTAL_MIB=1024;
const RESERVED_HOST_MIB=HOST_TOTAL_MIB-APPLICATION_RSS_CEILING_MIB;

const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function spawnLogged(command,args,{env}){
  const child=spawn(command,args,{env,stdio:['ignore','pipe','pipe']});
  let output='';
  const collect=chunk=>{
    output+=chunk.toString();
    if(output.length>20000) output=output.slice(-20000);
  };
  child.stdout.on('data',collect);
  child.stderr.on('data',collect);
  return {child,getOutput:()=>output};
}

async function waitJson(url,{headers={},timeoutMs=120000}={}){
  const start=Date.now();
  let last='';
  while(Date.now()-start<timeoutMs){
    try{
      const response=await fetch(url,{headers});
      const payload=await response.json();
      if(response.ok) return {response,payload};
      last=String(response.status);
    }catch(error){last=String(error?.message||error)}
    await sleep(500);
  }
  throw new Error('timeout waiting for '+url+' last='+last);
}

async function rssMib(pid){
  const raw=await readFile('/proc/'+pid+'/status','utf8');
  const match=/^VmRSS:\s+(\d+)\s+kB$/m.exec(raw);
  if(!match) throw new Error('VmRSS unavailable for pid '+pid);
  return Number(match[1])/1024;
}

async function sampleRss(pid,samples=5){
  const values=[];
  for(let i=0;i<samples;i++){
    values.push(await rssMib(pid));
    await sleep(400);
  }
  return Math.max(...values);
}

async function terminate(proc){
  if(!proc||proc.exitCode!==null) return;
  proc.kill('SIGTERM');
  await Promise.race([
    new Promise(resolve=>proc.once('exit',resolve)),
    sleep(3000)
  ]);
  if(proc.exitCode===null) proc.kill('SIGKILL');
}

async function main(){
  if(process.platform!=='linux') throw new Error('BE-06 capacity probe requires Linux /proc');
  const work=await mkdtemp(join(tmpdir(),'fae-be06-capacity-'));
  const dataFile=join(work,'fae-state.json');
  const basePort=19000+(process.pid%1000);
  const nodePort=basePort;
  const gatewayPort=basePort+1;

  let nodeRun,gatewayRun;
  try{
    nodeRun=spawnLogged(process.execPath,[nodeSource],{
      env:{
        ...process.env,
        NODE_OPTIONS:'--max-old-space-size='+NODE_HEAP_MIB,
        FAE_HOST:'127.0.0.1',
        FAE_PORT:String(nodePort),
        FAE_DATA_FILE:dataFile,
        FAE_SYNC:'1',
        FAE_SYNC_MS:'15000',
        FAE_UPSTREAM_API:''
      }
    });

    const direct=await waitJson('http://127.0.0.1:'+nodePort+'/status',{timeoutMs:120000});
    if(direct.payload?.network!=='fairyelf-public-testnet-v4') throw new Error('wrong node network');
    if(!Number.isSafeInteger(Number(direct.payload?.height))||Number(direct.payload.height)<=0){
      throw new Error('node did not obtain a nonzero independently validated testnet tip');
    }

    gatewayRun=spawnLogged(process.execPath,[gatewaySource],{
      env:{
        ...process.env,
        NODE_OPTIONS:'--max-old-space-size='+GATEWAY_HEAP_MIB,
        FAE_BE05_GATEWAY_HOST:'127.0.0.1',
        FAE_BE05_GATEWAY_PORT:String(gatewayPort),
        FAE_BE05_NODE_ORIGIN:'http://127.0.0.1:'+nodePort,
        FAE_BE05_EXPLORER_ORIGIN:explorerOrigin
      }
    });

    const throughGateway=await waitJson('http://127.0.0.1:'+gatewayPort+'/explorer/status',{
      headers:{Origin:explorerOrigin},
      timeoutMs:30000
    });
    if(throughGateway.payload?.network!=='fairyelf-public-testnet-v4') throw new Error('gateway returned wrong network');
    if(Number(throughGateway.payload?.height)!==Number(direct.payload.height)) throw new Error('gateway/node height mismatch');

    await sleep(1000);
    const [nodeRss,gatewayRss,stateStat]=await Promise.all([
      sampleRss(nodeRun.child.pid),
      sampleRss(gatewayRun.child.pid),
      stat(dataFile)
    ]);
    const combined=nodeRss+gatewayRss;
    const result={
      schema:'FAE_BLOCK_EXPLORER_BE06_RUNTIME_CAPACITY_PROBE_V1',
      network:'fairyelf-public-testnet-v4',
      observed_height:Number(direct.payload.height),
      state_file_bytes:stateStat.size,
      limits:{
        host_total_mib:HOST_TOTAL_MIB,
        node_heap_limit_mib:NODE_HEAP_MIB,
        gateway_heap_limit_mib:GATEWAY_HEAP_MIB,
        application_rss_ceiling_mib:APPLICATION_RSS_CEILING_MIB,
        reserved_for_os_tls_and_burst_mib:RESERVED_HOST_MIB
      },
      observed:{
        node_rss_mib:Number(nodeRss.toFixed(2)),
        gateway_rss_mib:Number(gatewayRss.toFixed(2)),
        combined_rss_mib:Number(combined.toFixed(2))
      },
      checks:{
        synchronized_nonzero_tip:Number(direct.payload.height)>0,
        gateway_read_path:true,
        durable_state_file_written:stateStat.size>0,
        node_rss_within_envelope:nodeRss<=NODE_HEAP_MIB,
        gateway_rss_within_envelope:gatewayRss<=GATEWAY_HEAP_MIB,
        combined_rss_within_envelope:combined<=APPLICATION_RSS_CEILING_MIB
      }
    };
    result.eligible=Object.values(result.checks).every(Boolean);
    console.log(JSON.stringify(result,null,2));
    if(!result.eligible) process.exitCode=3;
  }catch(error){
    console.error(JSON.stringify({
      eligible:false,
      error:String(error?.message||error),
      node_log:nodeRun?.getOutput()||'',
      gateway_log:gatewayRun?.getOutput()||''
    },null,2));
    process.exitCode=2;
  }finally{
    await terminate(gatewayRun?.child);
    await terminate(nodeRun?.child);
    await rm(work,{recursive:true,force:true});
  }
}

await main();
