#!/usr/bin/env node
import http from 'node:http';
import {readFile,writeFile,mkdir,stat,rm} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {dirname,join,resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import os from 'node:os';
import {prepareStaging} from '../representative-device-evidence-readiness/prepare-staging.mjs';
import {collectEvidence} from '../representative-device-evidence-readiness/collect-evidence.mjs';
import {verifyEvidenceBundle} from '../representative-device-evidence-readiness/verify-evidence.mjs';
import {TESTED_SOURCE_REVISION} from './autopilot-core.mjs';

const execFileP=promisify(execFile);
const here=dirname(fileURLToPath(import.meta.url));
const args=Object.fromEntries(process.argv.slice(2).map((v,i,a)=>v.startsWith('--')?[v.slice(2),a[i+1]&&!a[i+1].startsWith('--')?a[i+1]:true]:null).filter(Boolean));
const port=Number(args.port||43113);
const outRoot=resolve(args.out||'.rde-physical-evidence');
const requestedClass=String(args['device-class']||'');
const validClasses=new Set(['mobile_tablet_arm','thin_light_integrated','consumer_discrete_gpu','compact_handheld_consumer']);

async function command(cmd,argv=[]){
  try{return (await execFileP(cmd,argv,{timeout:5000,maxBuffer:1024*1024})).stdout.trim()}catch{return''}
}
async function detectProfile(){
  const platform=process.platform,arch=process.arch;
  let manufacturer='',model='',soc_cpu=os.cpus()?.[0]?.model||'',gpu='',osVersion=os.release(),deviceClass=requestedClass;
  if(platform==='darwin'){
    const hw=await command('system_profiler',['SPHardwareDataType','-json']);
    try{
      const j=JSON.parse(hw),row=j.SPHardwareDataType?.[0]||{};
      manufacturer='Apple';model=row.machine_name||row.machine_model||'Mac';
      soc_cpu=row.chip_type||row.cpu_type||soc_cpu;
      if(!deviceClass)deviceClass=/MacBook Air/i.test(model)?'thin_light_integrated':'thin_light_integrated';
    }catch{manufacturer='Apple';model='Mac'}
  }else if(platform==='linux'){
    manufacturer=(await command('cat',['/sys/devices/virtual/dmi/id/sys_vendor']))||'Linux device';
    model=(await command('cat',['/sys/devices/virtual/dmi/id/product_name']))||'Linux computer';
    const osRelease=await command('cat',['/etc/os-release']);
    if(/steamdeck|steam deck|steamos/i.test(model+' '+osRelease)){manufacturer='Valve';model=/steam/i.test(model)?model:'Steam Deck';deviceClass=deviceClass||'compact_handheld_consumer'}
    const nvidia=await command('nvidia-smi',['--query-gpu=name','--format=csv,noheader']);
    if(nvidia){gpu=nvidia.split('\n')[0].trim();deviceClass=deviceClass||'consumer_discrete_gpu'}
    deviceClass=deviceClass||'thin_light_integrated';
  }else if(platform==='win32'){
    const ps=await command('powershell.exe',['-NoProfile','-Command','Get-CimInstance Win32_ComputerSystem | Select-Object Manufacturer,Model | ConvertTo-Json -Compress']);
    try{const j=JSON.parse(ps);manufacturer=j.Manufacturer||'Windows PC';model=j.Model||'Windows PC'}catch{manufacturer='Windows PC';model='Windows PC'}
    const nvidia=await command('nvidia-smi',['--query-gpu=name','--format=csv,noheader']);
    if(nvidia){gpu=nvidia.split('\n')[0].trim();deviceClass=deviceClass||'consumer_discrete_gpu'}
    deviceClass=deviceClass||'thin_light_integrated';
  }
  if(requestedClass&&!validClasses.has(requestedClass))throw new Error('unsupported --device-class');
  const ram_gb=Math.round(os.totalmem()/1024/1024/1024);
  return{
    schema:'FAE_RDE_LOCAL_AGENT_PROFILE_V1',manufacturer:manufacturer||'Unknown',model:model||os.hostname(),
    device_class:deviceClass||requestedClass,os:platform,os_version:osVersion,isa_family:arch,
    soc_cpu,gpu:gpu||'not_detected',ram_gb,power_mode:'normal',charging_state:'unknown_declared',
    external_power:platform!=='linux'||!deviceClass?.includes('mobile'),cooling_configuration:'stock',
    background_task_policy:'ordinary_background_state',display_state:'on',
    reward_address:typeof args['reward-address']==='string'?args['reward-address']:null
  };
}
async function telemetry(){
  const nvidia=await command('nvidia-smi',['--query-gpu=name,temperature.gpu,power.draw,clocks_throttle_reasons.active','--format=csv,noheader,nounits']);
  if(nvidia){
    const [name,temp,power,throttle]=nvidia.split('\n')[0].split(',').map(x=>x.trim());
    return{schema:'FAE_RDE_LOCAL_TELEMETRY_V1',source:'nvidia-smi',gpu:name,gpu_temperature_c:Number(temp),gpu_power_w:Number(power),throttling_observed:throttle&&!/^0x0+$/.test(throttle)};
  }
  const sensors=await command('sensors',['-j']);
  if(sensors){
    try{
      const j=JSON.parse(sensors),temps=[];
      for(const chip of Object.values(j))for(const group of Object.values(chip||{}))for(const [k,v] of Object.entries(group||{}))if(/_input$/.test(k)&&Number.isFinite(Number(v)))temps.push(Number(v));
      if(temps.length)return{schema:'FAE_RDE_LOCAL_TELEMETRY_V1',source:'lm-sensors',max_temperature_c:Math.max(...temps)};
    }catch{}
  }
  return{schema:'FAE_RDE_LOCAL_TELEMETRY_V1',source:'UNAVAILABLE'};
}
function safeRunId(value){return String(value||'').replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,140)}
async function packageCapture(capture){
  const id=safeRunId(capture?.run?.run_id);if(!id)throw new Error('run_id_required');
  const root=join(outRoot,id),capturePath=join(root,'capture.json'),staging=join(root,'staging'),bundle=join(root,'bundle');
  await mkdir(root,{recursive:true});await writeFile(capturePath,JSON.stringify(capture,null,2));
  await rm(staging,{recursive:true,force:true});await rm(bundle,{recursive:true,force:true});
  await prepareStaging({capturePath,outDir:staging});
  await collectEvidence({inputDir:staging,outDir:bundle});
  const result=await verifyEvidenceBundle(bundle,{
    expectedSourceRevision:TESTED_SOURCE_REVISION,
    expectedEvidenceClass:capture.run.evidence_class
  });
  await writeFile(join(root,'verification.json'),JSON.stringify(result,null,2));
  return{run_id:id,verdict:result.verdict,bundle_dir:bundle,errors:result.errors};
}
function mime(path){return({'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8'})[extname(path)]||'application/octet-stream'}
function sendJson(res,status,value){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(value))}
async function readBody(req,limit=6*1024*1024){
  const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>limit)throw new Error('request_too_large');chunks.push(chunk)}
  return Buffer.concat(chunks).toString('utf8');
}
const profile=await detectProfile();await mkdir(outRoot,{recursive:true});
const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://127.0.0.1:'+port);
    if(url.pathname==='/_rde/profile')return sendJson(res,200,profile);
    if(url.pathname==='/_rde/telemetry')return sendJson(res,200,await telemetry());
    if(url.pathname==='/_rde/capture'&&req.method==='POST'){
      const capture=JSON.parse(await readBody(req));return sendJson(res,200,await packageCapture(capture));
    }
    let rel=url.pathname==='/'?'index.html':url.pathname.replace(/^\/+/,'');
    if(rel.includes('..')||rel.startsWith('_rde/'))return sendJson(res,404,{error:'not_found'});
    const path=resolve(here,rel);if(!path.startsWith(here))return sendJson(res,403,{error:'forbidden'});
    try{await stat(path)}catch{return sendJson(res,404,{error:'not_found'})}
    res.writeHead(200,{'content-type':mime(path),'cache-control':'no-store'});createReadStream(path).pipe(res);
  }catch(error){sendJson(res,500,{error:String(error.message||error)})}
});
server.listen(port,'127.0.0.1',()=>{
  const url='http://127.0.0.1:'+port+'/';
  console.log(JSON.stringify({state:'READY',url,profile,evidence_out:outRoot},null,2));
  if(args.open!==false&&args.open!=='false'){
    try{
      if(process.platform==='darwin')spawn('open',[url],{detached:true,stdio:'ignore'}).unref();
      else if(process.platform==='win32')spawn('cmd',['/c','start','',url],{detached:true,stdio:'ignore'}).unref();
      else spawn('xdg-open',[url],{detached:true,stdio:'ignore'}).unref();
    }catch{}
  }
});
