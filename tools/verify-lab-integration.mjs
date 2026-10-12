#!/usr/bin/env node
import {readFile,access} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';

const root=process.cwd();
const registryPath=path.join(root,'lab/integration/registry.json');
const registry=JSON.parse(await readFile(registryPath,'utf8'));
const args=new Set(process.argv.slice(2));
const runChecks=args.has('--run');
const requireLatest=args.has('--require-latest-main');

function fail(message){
  console.error('CROSS-LAB INTEGRATION FAIL:',message);
  process.exitCode=1;
}

function git(args,{allowFailure=false}={}){
  const result=spawnSync('git',args,{cwd:root,encoding:'utf8'});
  if(result.status!==0&&!allowFailure){
    fail('git '+args.join(' ')+' failed: '+(result.stderr||result.stdout||'unknown error').trim());
  }
  return result;
}

const headResult=git(['rev-parse','HEAD']);
const head=(headResult.stdout||'').trim();

if(registry.schema!=='FAE_CROSS_LAB_INTEGRATION_REGISTRY_V1')fail('unexpected registry schema');
if(registry.canonical_branch!=='main')fail('canonical branch must remain main');
if(registry.require_latest_main_ancestry_before_merge!==true)fail('latest-main ancestry gate must remain enabled');

if(requireLatest){
  git(['fetch','origin','main','--quiet']);
  const ancestry=git(['merge-base','--is-ancestor','origin/main','HEAD'],{allowFailure:true});
  if(ancestry.status!==0){
    fail('candidate does not contain the latest origin/main; reconcile/rebase before claiming integration readiness');
  }
}

const reports=[];
for(const lab of registry.labs){
  const missing=[];
  for(const relative of lab.required_paths){
    try{await access(path.join(root,relative));}
    catch{missing.push(relative);}
  }
  if(missing.length){
    fail(lab.id+' missing required paths: '+missing.join(', '));
    reports.push({id:lab.id,status:'MISSING_PATHS',missing});
    continue;
  }

  const checkResults=[];
  if(runChecks){
    for(const command of lab.combined_checks){
      const [bin,...cmdArgs]=command;
      const result=spawnSync(bin,cmdArgs,{cwd:root,encoding:'utf8',stdio:'pipe'});
      const ok=result.status===0;
      checkResults.push({
        command:command.join(' '),
        ok,
        stdout:(result.stdout||'').trim().slice(-2000),
        stderr:(result.stderr||'').trim().slice(-2000)
      });
      if(!ok)fail(lab.id+' combined check failed: '+command.join(' '));
    }
  }
  reports.push({id:lab.id,status:runChecks?'CHECKED':'STRUCTURE_OK',checks:checkResults});
}

const pq=JSON.parse(await readFile(path.join(root,'lab/post-quantum-signatures/authority.json'),'utf8'));
for(const key of ['activation_authorized','consensus_change_authorized','public_testnet_change_authorized','candidate_to_authoritative','mainnet_launch_authorized']){
  if(pq[key]!==false)fail('PQ authority boundary changed unexpectedly: '+key);
}

const output={
  schema:'FAE_CROSS_LAB_INTEGRATION_VERIFICATION_V1',
  status:process.exitCode?'FAIL':'PASS',
  head,
  latest_main_ancestry_required:requireLatest,
  combined_checks_executed:runChecks,
  semantics:{
    lab_verified_is_not_integrated:true,
    integrated_is_not_combined_verified:true,
    combined_verified_is_not_live:true
  },
  labs:reports,
  authority_transition_allowed:false
};

console.log(JSON.stringify(output,null,2));
if(process.exitCode)process.exit(process.exitCode);
