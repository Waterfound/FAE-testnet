#!/usr/bin/env node
'use strict';

import {cp,mkdir,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const repoRoot=path.resolve(here,'..');
const output=path.resolve(repoRoot,process.env.FAE_EXPLORER_OUTPUT_DIR||'explorer-dist');

const NETWORK='fairyelf-public-testnet-v4';
const deploymentState=process.env.FAE_EXPLORER_DEPLOYMENT_STATE||'PUBLIC_PREBIND';
const bindingState=process.env.FAE_EXPLORER_BINDING_STATE||'UNBOUND';
const apiBase=(process.env.FAE_EXPLORER_API_BASE||'').trim()||null;
const sourceRevision=(process.env.RENDER_GIT_COMMIT||process.env.FAE_EXPLORER_SOURCE_REVISION||'').trim()||null;

function fail(message){
  console.error('FAE Explorer build refused: '+message);
  process.exit(2);
}

if(deploymentState==='LIVE')fail('LIVE cannot be synthesized by the BE-04 build artifact.');
if(!['NOT_LIVE','PUBLIC_PREBIND','PUBLIC_BOUND_CANDIDATE'].includes(deploymentState)){
  fail('unsupported deployment state '+deploymentState);
}
if(!['UNBOUND','BOUND_CANDIDATE'].includes(bindingState)){
  fail('unsupported binding state '+bindingState);
}

let apiOrigin=null;
if(bindingState==='UNBOUND'){
  if(apiBase!==null)fail('UNBOUND build must not contain an API base.');
  if(deploymentState==='PUBLIC_BOUND_CANDIDATE')fail('BOUND deployment state requires a bound candidate.');
}else{
  if(!apiBase)fail('BOUND_CANDIDATE requires FAE_EXPLORER_API_BASE.');
  let url;
  try{url=new URL(apiBase)}catch{fail('API base must be an absolute URL.')}
  if(url.protocol!=='https:')fail('public node binding requires HTTPS.');
  if(url.username||url.password||url.search||url.hash)fail('API base must not contain credentials, query, or fragment.');
  apiOrigin=url.origin;
  if(deploymentState==='PUBLIC_PREBIND')fail('PUBLIC_PREBIND cannot contain a bound candidate.');
}

if(sourceRevision!==null&&!/^[0-9a-f]{40}$/.test(sourceRevision)){
  fail('source revision must be a 40-character lowercase git SHA.');
}

await rm(output,{recursive:true,force:true});
await mkdir(output,{recursive:true});

for(const filename of ['index.html','styles.css','api-client.mjs','app.mjs']){
  await cp(path.join(here,filename),path.join(output,filename));
}

const config={
  schema:'FAE_EXPLORER_APP_CONFIG_V2',
  network:NETWORK,
  api_base:apiBase,
  binding_state:bindingState,
  deployment_state:deploymentState,
  read_only:true,
  source_revision:sourceRevision
};

const deployment={
  schema:'FAE_EXPLORER_DEPLOYMENT_ATTESTATION_V1',
  network:NETWORK,
  deployment_state:deploymentState,
  binding_state:bindingState,
  api_origin:apiOrigin,
  source_revision:sourceRevision,
  read_only:true,
  authority:'NON_AUTHORITATIVE_OBSERVATION_ONLY'
};

await writeFile(path.join(output,'config.json'),JSON.stringify(config,null,2)+'\n');
await writeFile(path.join(output,'deployment.json'),JSON.stringify(deployment,null,2)+'\n');

console.log(JSON.stringify({
  ok:true,
  output:path.relative(repoRoot,output),
  network:NETWORK,
  deployment_state:deploymentState,
  binding_state:bindingState,
  api_origin:apiOrigin,
  source_revision:sourceRevision
}));
