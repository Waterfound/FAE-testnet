#!/usr/bin/env node
import {cp,mkdir,stat} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {contract,parseArgs,readJson,writeJson,digestFile,manifestPayloadHash,stableEntries} from './lib.mjs';

const sourceFiles=contract.required_bundle_files.filter(x=>!['integrity.json','manifest.json'].includes(x));

export async function collectEvidence({inputDir,outDir}){
  const input=resolve(inputDir),out=resolve(outDir);
  if(input===out)throw new Error('input_and_output_must_differ');
  try{await stat(out);throw new Error('output_directory_already_exists')}catch(e){if(e.message==='output_directory_already_exists')throw e;if(e.code!=='ENOENT')throw e}
  await mkdir(out,{recursive:false}); await mkdir(join(out,'logs'),{recursive:true});
  for(const rel of sourceFiles){
    const src=join(input,rel),dst=join(out,rel);
    await mkdir(dirname(dst),{recursive:true});
    await cp(src,dst,{force:false,errorOnExist:true});
  }
  const run=await readJson(join(out,'run.json'));
  if(run.contract_id!==contract.contract_id)throw new Error('contract_id_mismatch');
  if(!Object.hasOwn(contract.evidence_classes,run.evidence_class))throw new Error('unsupported_evidence_class');
  if(run.evidence_class==='PHYSICAL_EVIDENCE'&&run.synthetic===true)throw new Error('simulation_labeled_physical');
  if(run.evidence_class==='REHEARSAL_ONLY'&&run.synthetic!==true)throw new Error('rehearsal_must_be_explicitly_synthetic');

  const integrity={
    schema:'FAE_RDE_INTEGRITY_V1',
    contract_id:contract.contract_id,
    run_id:run.run_id,
    evidence_class:run.evidence_class,
    collector:'collect-evidence.mjs',
    created_by_collector:true,
    collection_mode:run.evidence_class==='PHYSICAL_EVIDENCE'?'PHYSICAL_CAPTURE_IMPORT':run.evidence_class,
    created_at:new Date().toISOString()
  };
  await writeJson(join(out,'integrity.json'),integrity);

  const listed=[];
  for(const rel of contract.required_bundle_files.filter(x=>x!=='manifest.json')){
    const d=await digestFile(join(out,rel));listed.push({path:rel,...d});
  }
  const entries=stableEntries(listed);
  const manifest={
    schema:'FAE_RDE_EVIDENCE_MANIFEST_V1',
    contract_id:contract.contract_id,
    run_id:run.run_id,
    files:entries,
    manifest_payload_sha256:manifestPayloadHash(entries)
  };
  await writeJson(join(out,'manifest.json'),manifest);
  return{out_dir:out,run_id:run.run_id,evidence_class:run.evidence_class,manifest_payload_sha256:manifest.manifest_payload_sha256};
}

const invokedPath=process.argv[1] ? new URL('file://'+process.argv[1]).href : '';
if(import.meta.url===invokedPath){
  const a=parseArgs(process.argv.slice(2));
  if(!a.input||!a.out){console.error('usage: collect-evidence.mjs --input <staging-dir> --out <bundle-dir>');process.exit(2)}
  collectEvidence({inputDir:a.input,outDir:a.out}).then(x=>console.log(JSON.stringify(x,null,2))).catch(e=>{console.error(e.stack||e);process.exit(1)});
}
