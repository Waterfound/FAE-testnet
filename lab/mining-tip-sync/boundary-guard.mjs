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
  'current_stage_active_miner_write_authorized',
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
if(!Array.isArray(manifest.current_frontier)||manifest.current_frontier.join(',')!=='MTS-00,MTS-01')fail('unexpected current frontier');
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
      const protectedHit=manifest.current_stage_protected_paths.some(protectedPath=>
        protectedPath.endsWith('/')?file.startsWith(protectedPath):file===protectedPath
      );
      if(protectedHit)fail(`protected active path changed during MTS-00/01: ${file}`);
    }
  }
}

if(!process.exitCode)console.log('MTS-00 boundary guard PASS');
