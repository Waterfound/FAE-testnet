#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';

const root=process.cwd();
const manifestPath=path.join(root,'lab/mining-tip-sync/authority.json');
const manifest=JSON.parse(await readFile(manifestPath,'utf8'));

function fail(message){
  console.error('MTS-00 BOUNDARY FAIL:',message);
  process.exitCode=1;
}

const falseFlags=[
  'consensus_change_authorized',
  'monetary_policy_change_authorized',
  'block_time_change_authorized',
  'difficulty_rule_change_authorized',
  'backend_consensus_semantics_change_authorized',
  'wallet_or_key_material_change_authorized',
  'public_testnet_promotion_authorized',
  'mainnet_launch_authorized'
];
for(const key of falseFlags){
  if(manifest[key]!==false)fail(`${key} must remain false during MTS-00/01`);
}
if(manifest.future_candidate_miner_write_requires_gate!==true)fail('future miner write must require an explicit later gate');
if(manifest.authority_ceiling!=='LAB_TEST_AND_CANDIDATE_BROWSER_MINER_WRITE')fail('unexpected authority ceiling');
const frontier=Array.isArray(manifest.current_frontier)?manifest.current_frontier.join(','):'';
if(manifest.status==='BOUNDARY_FROZEN_MTS_00_01'&&frontier!=='MTS-00,MTS-01')fail('unexpected pre-verification frontier');
if(manifest.status==='MTS_00_01_GREEN'&&frontier!=='MTS-02,MTS-03')fail('unexpected post-baseline frontier');
if(manifest.status==='MTS_02_03_GREEN'&&frontier!=='MTS-04,MTS-06')fail('unexpected post-contract frontier');
if(manifest.status==='MTS_04_06_GREEN'&&frontier!=='MTS-05')fail('unexpected post-direct-cancellation frontier');
if(manifest.status==='MTS_05_GREEN'&&frontier!=='MTS-07')fail('unexpected post-race-safety frontier');
if(manifest.status==='MTS_07_STRESS_ACTIVE'&&frontier!=='MTS-07')fail('unexpected stress frontier');
if(manifest.status==='MTS_07_GREEN'&&frontier!=='MTS-08')fail('unexpected post-stress frontier');
if(manifest.status==='MTS_08_STRESS_ACTIVE'&&frontier!=='MTS-08')fail('unexpected lifecycle stress frontier');
if(manifest.status==='MTS_08_PATCH_AUTHORIZED'&&frontier!=='MTS-08')fail('unexpected lifecycle patch frontier');
if(!['BOUNDARY_FROZEN_MTS_00_01','MTS_00_01_GREEN','MTS_02_03_GREEN','MTS_04_06_GREEN','MTS_05_GREEN','MTS_07_STRESS_ACTIVE','MTS_07_GREEN','MTS_08_STRESS_ACTIVE','MTS_08_PATCH_AUTHORIZED'].includes(manifest.status))fail('unexpected authority status');
if(['MTS_02_03_GREEN','MTS_04_06_GREEN','MTS_05_GREEN'].includes(manifest.status)){
  if(manifest.current_stage_active_miner_write_authorized!==true)fail('runtime-write frontier requires explicit miner write authorization');
  if(!manifest.current_stage_allowed_write_prefixes.includes('mining.js'))fail('mining.js must be explicitly scoped during runtime-write frontier');
  if(manifest.current_stage_protected_paths.includes('mining.js'))fail('mining.js cannot remain protected during runtime-write frontier');
}else if(['MTS_07_STRESS_ACTIVE','MTS_07_GREEN','MTS_08_STRESS_ACTIVE'].includes(manifest.status)){
  if(manifest.current_stage_active_miner_write_authorized!==false)fail('stress-first phase must not authorize miner writes');
  if(!manifest.current_stage_protected_paths.includes('mining.js'))fail('stress-first phase must protect mining.js');
  if(manifest.current_stage_allowed_write_prefixes.includes('mining.js'))fail('stress-first phase must not allow mining.js writes');
}else if(manifest.status==='MTS_08_PATCH_AUTHORIZED'){
  if(manifest.current_stage_active_miner_write_authorized!==true)fail('MTS-08 patch phase requires explicit miner write authorization');
  if(!manifest.current_stage_allowed_write_prefixes.includes('mining.js'))fail('MTS-08 patch phase must scope mining.js explicitly');
  if(manifest.current_stage_protected_paths.includes('mining.js'))fail('MTS-08 patch phase cannot keep mining.js protected');
  if(!manifest.current_stage_protected_path_exceptions?.includes('sovereign-forge/browser/mining.js'))fail('MTS-08 patch phase requires exact Forge mirror exception');
}else if(manifest.current_stage_active_miner_write_authorized!==false){
  fail('active miner write must remain false before an explicit runtime-write gate');
}
if(manifest.cross_tab_policy?.is_chain_authority!==false)fail('cross-tab signaling must never be chain authority');
if(manifest.snapshot_semantics?.mempool_only_change_invalidates_work!==false)fail('snapshot semantics must preserve mempool-only validity');
if(manifest.snapshot_semantics?.chain_tip_change_invalidates_work!==true)fail('chain tip change must invalidate work');

const activeFiles=['mining.js','core.js','wallet.js','wallet-crypto.js','network-status.js'];
for(const relative of activeFiles){
  const text=await readFile(path.join(root,relative),'utf8');
  for(const marker of manifest.active_runtime_must_not_reference){
    if(text.includes(marker))fail(`active runtime ${relative} references forbidden Lab marker ${marker}`);
  }
}

const baseIndex=process.argv.indexOf('--base');
if(baseIndex!==-1){
  const base=process.argv[baseIndex+1];
  if(!base)fail('--base requires a git revision');
  else{
    let changed=[];
    try{
      const output=execFileSync('git',['diff','--name-only',`${base}...HEAD`],{cwd:root,encoding:'utf8'});
      changed=output.split(/\r?\n/).filter(Boolean);
    }catch(error){
      fail(`unable to inspect git diff from ${base}: ${error.message}`);
    }
    for(const file of changed){
      const allowed=manifest.current_stage_allowed_write_prefixes.some(prefix=>file.startsWith(prefix));
      if(!allowed)fail(`changed path outside MTS-00/01 authority: ${file}`);
      const exception=Array.isArray(manifest.current_stage_protected_path_exceptions)&&manifest.current_stage_protected_path_exceptions.includes(file);
      const protectedHit=!exception&&manifest.current_stage_protected_paths.some(protectedPath=>
        protectedPath.endsWith('/')?file.startsWith(protectedPath):file===protectedPath
      );
      if(protectedHit)fail(`protected active path changed during current MTS frontier: ${file}`);
    }
  }
}

if(!process.exitCode)console.log('MTS-00 boundary guard PASS');
