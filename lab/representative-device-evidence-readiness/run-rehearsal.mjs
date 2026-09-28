#!/usr/bin/env node
import {mkdir,writeFile,rm,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {contract,parseArgs,writeJson} from './lib.mjs';
import {collectEvidence} from './collect-evidence.mjs';
import {verifyPortfolio} from './verify-portfolio.mjs';

const devices={
  mobile_tablet_arm:{manufacturer:'RehearsalCo',model:'Mobile ARM Fixture',device_id:'RDE-REH-MOBILE',isa_family:'arm64',form_factor:'mobile_or_tablet',rate:150,power:10},
  thin_light_integrated:{manufacturer:'RehearsalCo',model:'Thin Light Fixture',device_id:'RDE-REH-THIN',isa_family:'arm64',form_factor:'thin_and_light_laptop',rate:220,power:15},
  consumer_discrete_gpu:{manufacturer:'RehearsalCo',model:'Consumer GPU Fixture',device_id:'RDE-REH-GPU',isa_family:'x86_64',form_factor:'consumer_desktop_or_laptop_with_dGPU',rate:3000,power:220},
  compact_handheld_consumer:{manufacturer:'RehearsalCo',model:'Handheld Fixture',device_id:'RDE-REH-HANDHELD',isa_family:'x86_64',form_factor:'handheld_or_compact_gaming_device',rate:600,power:25}
};
function at(baseMs,seconds){return new Date(baseMs+seconds*1000).toISOString()}
async function makeStaging(root,{classId,workloadId,repetition,index}){
  const d=devices[classId],dir=join(root,'staging-'+index);await mkdir(join(dir,'logs'),{recursive:true});
  const base=Date.parse('2026-09-28T12:00:00.000Z')+index*120000,started=at(base,0),ended=at(base,60);
  const runId='rde-rehearsal-'+classId+'-'+workloadId+'-'+repetition;
  await writeJson(join(dir,'run.json'),{schema:'FAE_RDE_RUN_V1',contract_id:contract.contract_id,run_id:runId,evidence_class:'REHEARSAL_ONLY',synthetic:true,rehearsal_scaled:true,completed:true,started_at:started,ended_at:ended});
  await writeJson(join(dir,'selection-lock.json'),{schema:'FAE_RDE_SELECTION_LOCK_V1',locked_at:'2026-09-27T00:00:00.000Z',device_class:classId,selected_device:{manufacturer:d.manufacturer,model:d.model},available_candidates:[{manufacturer:d.manufacturer,model:d.model,eligible:true}],selection_rationale:'Synthetic pre-result fixture selected solely to exercise the frozen class contract.'});
  await writeJson(join(dir,'device.json'),{schema:'FAE_RDE_DEVICE_V1',device_id:d.device_id,device_class:classId,manufacturer:d.manufacturer,model:d.model,soc_cpu:classId==='consumer_discrete_gpu'?'fixture x86 CPU':'fixture integrated SoC',gpu:classId==='consumer_discrete_gpu'?'fixture consumer dGPU':'integrated',ram_gb:16,os:'FixtureOS',os_version:'1',isa_family:d.isa_family,form_factor:d.form_factor,power_mode:'normal',thermal_mode:'normal'});
  await writeJson(join(dir,'environment.json'),{schema:'FAE_RDE_ENVIRONMENT_V1',device_class:classId,power_mode:'normal',charging_state:'stable',external_power:true,cooling_configuration:'stock',background_task_policy:'fixture_quiet',display_state:'on',ambient_temperature_status:'UNAVAILABLE',ambient_temperature_missing_reason:'Synthetic readiness rehearsal does not claim physical ambient telemetry.'});
  await writeJson(join(dir,'source-provenance.json'),{schema:'FAE_RDE_SOURCE_PROVENANCE_V1',repository:'Waterfound/FAE-testnet',source_revision:contract.source_binding.baseline_source_revision,miner_path:contract.source_binding.miner_path,miner_blob_sha:contract.source_binding.miner_blob_sha,network:contract.source_binding.network,genesis_hash:contract.source_binding.genesis_hash,runtime_revision:contract.source_binding.baseline_source_revision,workload_revision:contract.contract_id});
  await writeJson(join(dir,'workload.json'),{schema:'FAE_RDE_WORKLOAD_V1',workload_id:workloadId,device_class:classId,repetition,protocol_contract_id:contract.contract_id});
  const measurement={schema:'FAE_RDE_MEASUREMENTS_V1',warmup_observed_seconds:5,measurement_observed_seconds:10,attempts_start:0,attempts_end:d.rate*10,derived_work_rate:d.rate,first_window_rate:d.rate,last_window_rate:d.rate*0.9,validated_work_events:5,accepted_work_events:2,invalid_work_events:0,stale_work_events:0};
  if(workloadId==='normal_use_coexistence')Object.assign(measurement,{interactive_p95_ms_baseline:100,interactive_p95_ms_with_mining:150,failed_scripted_interactions:0,recovery_seconds:30});
  if(workloadId==='lifecycle_recovery')measurement.lifecycle_transitions=5;
  await writeJson(join(dir,'measurements.json'),measurement);
  await writeJson(join(dir,'energy.json'),{schema:'FAE_RDE_ENERGY_V1',measurement_source:'COMPONENT_TELEMETRY',average_power_w:d.power,measured_seconds:10,energy_wh:d.power*10/3600,efficiency_claimed:false});
  await writeJson(join(dir,'thermals.json'),{schema:'FAE_RDE_THERMALS_V1',telemetry_available:true,max_temperature_c:70,throttling_observed:false,critical_thermal_event:false,device_shutdown:false});
  await writeJson(join(dir,'system-events.json'),{schema:'FAE_RDE_SYSTEM_EVENTS_V1',contamination_detected:false,events:[{at:at(base,15),type:'rehearsal_marker'}]});
  await writeJson(join(dir,'miner-events.json'),{schema:'FAE_RDE_MINER_EVENTS_V1',events:[{event_id:runId+'-1',at:at(base,10),type:'work_progress',attempts:d.rate*5},{event_id:runId+'-2',at:at(base,20),type:'work_progress',attempts:d.rate*10}]});
  await writeJson(join(dir,'operator-attestation.json'),{schema:'FAE_RDE_OPERATOR_ATTESTATION_V1',run_id:runId,device_id:d.device_id,physical_run_performed:false,synthetic_data_used:true,test_fixture:true,operator_id:'READINESS_REHEARSAL'});
  await writeFile(join(dir,'logs/miner.log'),'Synthetic readiness rehearsal only; no physical device measurement occurred.\n');
  return dir;
}
export async function createRehearsalPortfolio(outRoot){
  const root=resolve(outRoot);try{await stat(root);throw new Error('output_directory_already_exists')}catch(e){if(e.message==='output_directory_already_exists')throw e;if(e.code!=='ENOENT')throw e}
  await mkdir(root,{recursive:false});const stagingRoot=join(root,'_staging');await mkdir(stagingRoot);
  let index=0;
  for(const classId of contract.coverage_contract.required_class_ids){
    for(const workloadId of ['pure_mining_sustained','normal_use_coexistence']){
      for(let repetition=1;repetition<=3;repetition++){
        const staging=await makeStaging(stagingRoot,{classId,workloadId,repetition,index});
        await collectEvidence({inputDir:staging,outDir:join(root,'run-'+String(index).padStart(2,'0'))});index++;
      }
    }
    if(contract.workload_protocol.lifecycle_recovery.required_for_classes.includes(classId)){
      const staging=await makeStaging(stagingRoot,{classId,workloadId:'lifecycle_recovery',repetition:1,index});
      await collectEvidence({inputDir:staging,outDir:join(root,'run-'+String(index).padStart(2,'0'))});index++;
    }
  }
  await rm(stagingRoot,{recursive:true,force:true});
  return verifyPortfolio(root,{expectedSourceRevision:contract.source_binding.baseline_source_revision,expectedEvidenceClass:'REHEARSAL_ONLY'});
}
const invokedPath=process.argv[1]?new URL('file://'+process.argv[1]).href:'';
if(import.meta.url===invokedPath){
  const a=parseArgs(process.argv.slice(2));if(!a.out){console.error('usage: run-rehearsal.mjs --out <dir>');process.exit(2)}
  createRehearsalPortfolio(a.out).then(r=>{console.log(JSON.stringify(r,null,2));if(r.verdict!=='READINESS_REHEARSAL_ONLY')process.exitCode=1}).catch(e=>{console.error(e.stack||e);process.exit(1)});
}
