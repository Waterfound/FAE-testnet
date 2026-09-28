#!/usr/bin/env node
import {mkdir,stat,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {contract,parseArgs,readJson,writeJson} from './lib.mjs';

const sections={
  run:'run.json',
  selection_lock:'selection-lock.json',
  device:'device.json',
  environment:'environment.json',
  source_provenance:'source-provenance.json',
  workload:'workload.json',
  measurements:'measurements.json',
  energy:'energy.json',
  thermals:'thermals.json',
  system_events:'system-events.json',
  miner_events:'miner-events.json',
  operator_attestation:'operator-attestation.json'
};

export async function prepareStaging({capturePath,outDir}){
  const capture=await readJson(resolve(capturePath)),out=resolve(outDir);
  try{await stat(out);throw new Error('output_directory_already_exists')}catch(e){if(e.message==='output_directory_already_exists')throw e;if(e.code!=='ENOENT')throw e}
  if(capture?.schema!=='FAE_RDE_OPERATOR_CAPTURE_V1')throw new Error('unsupported_capture_schema');
  if(capture?.template_only===true)throw new Error('template_capture_cannot_be_staged');
  if(capture?.contract_id!==contract.contract_id)throw new Error('contract_id_mismatch');
  if(!capture?.miner_log||typeof capture.miner_log!=='string'||capture.miner_log.length<20)throw new Error('miner_log_missing_or_truncated');
  await mkdir(join(out,'logs'),{recursive:true});
  for(const [key,file] of Object.entries(sections)){
    if(!capture[key]||typeof capture[key]!=='object')throw new Error('capture_section_missing:'+key);
    await writeJson(join(out,file),capture[key]);
  }
  await writeFile(join(out,'logs/miner.log'),capture.miner_log);
  return{
    schema:'FAE_RDE_STAGING_PREP_RESULT_V1',
    out_dir:out,
    contract_id:contract.contract_id,
    run_id:capture.run?.run_id,
    evidence_class:capture.run?.evidence_class,
    note:'Staging is not evidence until collect-evidence.mjs creates integrity+manifest and verify-evidence.mjs passes.'
  };
}

const invokedPath=process.argv[1]?new URL('file://'+process.argv[1]).href:'';
if(import.meta.url===invokedPath){
  const a=parseArgs(process.argv.slice(2));
  if(!a.capture||!a.out){console.error('usage: prepare-staging.mjs --capture <capture.json> --out <staging-dir>');process.exit(2)}
  prepareStaging({capturePath:a.capture,outDir:a.out}).then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>{console.error(e.stack||e);process.exit(1)});
}
