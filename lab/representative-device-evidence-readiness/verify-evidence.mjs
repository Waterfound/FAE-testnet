#!/usr/bin/env node
import {readFile,lstat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {contract,parseArgs,readJson,digestFile,manifestPayloadHash,stableEntries,isoMs,HEX40} from './lib.mjs';

function verdictFor(errors){
  if(!errors.length)return 'PASS';
  if(errors.some(x=>x.startsWith('unsupported_device_class')))return 'UNSUPPORTED_DEVICE_CLASS';
  if(errors.some(x=>x.startsWith('contaminated_run')))return 'CONTAMINATED_RUN';
  if(errors.some(x=>x.startsWith('missing_required_file')||x.startsWith('malformed_json')))return 'INCOMPLETE';
  if(errors.some(x=>/checksum|manifest|source_revision|miner_revision|wrong_network|wrong_genesis|selection_lock|evidence_class|historical_labeled|simulation_labeled|contract_id|run_id_mismatch|integrity_/.test(x)))return 'INVALID_PROVENANCE';
  return 'FAIL';
}
function finitePositive(v){return Number.isFinite(Number(v))&&Number(v)>0}
function pushSchema(errors,obj,expected,label){if(obj?.schema!==expected)errors.push('unsupported_schema:'+label)}
function classKnown(id){return Object.hasOwn(contract.device_classes.required,id)||Object.hasOwn(contract.device_classes.expansion,id)}
function workloadSpec(id){return contract.workload_protocol[id]||null}

export async function verifyEvidenceBundle(bundleDir,expectations={}){
  const root=resolve(bundleDir),errors=[];
  for(const rel of contract.required_bundle_files){
    try{const st=await lstat(join(root,rel));if(st.isSymbolicLink()||!st.isFile())errors.push('missing_required_file:'+rel)}
    catch{errors.push('missing_required_file:'+rel)}
  }
  if(errors.length)return{verdict:'INCOMPLETE',errors,physical_evidence_admitted:false};

  const docs={};
  for(const rel of contract.required_bundle_files.filter(x=>x.endsWith('.json'))){
    try{docs[rel]=await readJson(join(root,rel))}
    catch{errors.push('malformed_json:'+rel)}
  }
  if(errors.length)return{verdict:'INCOMPLETE',errors,physical_evidence_admitted:false};

  const run=docs['run.json'],lock=docs['selection-lock.json'],device=docs['device.json'],env=docs['environment.json'];
  const source=docs['source-provenance.json'],workload=docs['workload.json'],m=docs['measurements.json'];
  const energy=docs['energy.json'],thermals=docs['thermals.json'],system=docs['system-events.json'];
  const miner=docs['miner-events.json'],att=docs['operator-attestation.json'],integrity=docs['integrity.json'],manifest=docs['manifest.json'];

  pushSchema(errors,run,'FAE_RDE_RUN_V1','run');
  pushSchema(errors,lock,'FAE_RDE_SELECTION_LOCK_V1','selection-lock');
  pushSchema(errors,device,'FAE_RDE_DEVICE_V1','device');
  pushSchema(errors,env,'FAE_RDE_ENVIRONMENT_V1','environment');
  pushSchema(errors,source,'FAE_RDE_SOURCE_PROVENANCE_V1','source-provenance');
  pushSchema(errors,workload,'FAE_RDE_WORKLOAD_V1','workload');
  pushSchema(errors,m,'FAE_RDE_MEASUREMENTS_V1','measurements');
  pushSchema(errors,energy,'FAE_RDE_ENERGY_V1','energy');
  pushSchema(errors,thermals,'FAE_RDE_THERMALS_V1','thermals');
  pushSchema(errors,system,'FAE_RDE_SYSTEM_EVENTS_V1','system-events');
  pushSchema(errors,miner,'FAE_RDE_MINER_EVENTS_V1','miner-events');
  pushSchema(errors,att,'FAE_RDE_OPERATOR_ATTESTATION_V1','operator-attestation');
  pushSchema(errors,integrity,'FAE_RDE_INTEGRITY_V1','integrity');
  pushSchema(errors,manifest,'FAE_RDE_EVIDENCE_MANIFEST_V1','manifest');

  if(run?.contract_id!==contract.contract_id)errors.push('contract_id_mismatch');
  if(run?.completed!==true)errors.push('partial_execution');
  if(!run?.run_id||typeof run.run_id!=='string')errors.push('run_id_missing');
  if(!Object.hasOwn(contract.evidence_classes,run?.evidence_class))errors.push('evidence_class_unsupported');
  if(run?.evidence_class==='PHYSICAL_EVIDENCE'&&run?.synthetic===true)errors.push('simulation_labeled_physical');
  if(run?.evidence_class==='REHEARSAL_ONLY'&&run?.synthetic!==true)errors.push('evidence_class_rehearsal_not_synthetic');
  if(run?.evidence_class==='HISTORICAL_REFERENCE'&&run?.claimed_as_new_physical===true)errors.push('historical_labeled_new_physical');
  if(expectations.expectedEvidenceClass&&run?.evidence_class!==expectations.expectedEvidenceClass)errors.push('evidence_class_mismatch');

  if(!classKnown(device?.device_class))errors.push('unsupported_device_class:'+String(device?.device_class));
  if(device?.device_class!==lock?.device_class)errors.push('selection_lock_device_class_mismatch');
  if(device?.manufacturer!==lock?.selected_device?.manufacturer||device?.model!==lock?.selected_device?.model)errors.push('selection_lock_device_identity_mismatch');
  if(!Array.isArray(lock?.available_candidates)||lock.available_candidates.length<1)errors.push('selection_lock_candidate_inventory_missing');
  if(!lock?.selection_rationale)errors.push('selection_lock_rationale_missing');
  for(const forbidden of ['throughput','hashrate','result','measurements','work_per_watt']){
    if(Object.hasOwn(lock||{},forbidden))errors.push('selection_lock_contains_post_result_field:'+forbidden);
  }

  const started=isoMs(run?.started_at),ended=isoMs(run?.ended_at),locked=isoMs(lock?.locked_at);
  if(!Number.isFinite(started)||!Number.isFinite(ended)||ended<=started)errors.push('impossible_timestamp:run');
  if(!Number.isFinite(locked)||!Number.isFinite(started)||locked>=started)errors.push('selection_lock_after_measurement');
  if(run?.evidence_class==='PHYSICAL_EVIDENCE'&&ended-started>24*60*60*1000)errors.push('impossible_timestamp:duration');

  if(!HEX40.test(String(source?.source_revision||'')))errors.push('source_revision_invalid');
  if(source?.source_revision!==contract.source_binding.baseline_source_revision)errors.push('source_revision_mismatch_contract');
  if(expectations.expectedSourceRevision&&source?.source_revision!==expectations.expectedSourceRevision)errors.push('source_revision_mismatch_expectation');
  if(source?.miner_path!==contract.source_binding.miner_path||source?.miner_blob_sha!==contract.source_binding.miner_blob_sha)errors.push('miner_revision_mismatch');
  if(source?.network!==contract.source_binding.network)errors.push('wrong_network');
  if(source?.genesis_hash!==contract.source_binding.genesis_hash)errors.push('wrong_genesis');

  if(env?.device_class!==device?.device_class)errors.push('environment_device_class_mismatch');
  for(const field of contract.environment_control.required_fields){
    if(env?.[field]===undefined||env?.[field]===null||env?.[field]==='')errors.push('environment_missing:'+field);
  }
  if(env?.ambient_temperature_status==='UNAVAILABLE'&&!env?.ambient_temperature_missing_reason)errors.push('environment_missing:ambient_temperature_missing_reason');

  const spec=workloadSpec(workload?.workload_id);
  if(!spec||typeof spec!=='object'||Array.isArray(spec))errors.push('workload_unsupported');
  if(workload?.device_class!==device?.device_class)errors.push('workload_device_class_mismatch');
  if(!Number.isInteger(Number(workload?.repetition))||Number(workload.repetition)<1)errors.push('workload_repetition_invalid');

  const rehearsal=run?.evidence_class==='REHEARSAL_ONLY';
  if(spec&&run?.evidence_class==='PHYSICAL_EVIDENCE'){
    if(Number(m?.warmup_observed_seconds)<Number(spec.warmup_seconds||0))errors.push('insufficient_warmup');
    if(Number(m?.measurement_observed_seconds)<Number(spec.measurement_seconds||0))errors.push('insufficient_measurement_interval');
  }else if(rehearsal){
    if(run?.rehearsal_scaled!==true)errors.push('rehearsal_scale_marker_missing');
    if(!finitePositive(m?.warmup_observed_seconds)||!finitePositive(m?.measurement_observed_seconds))errors.push('rehearsal_interval_missing');
  }

  const a0=Number(m?.attempts_start),a1=Number(m?.attempts_end),elapsed=Number(m?.measurement_observed_seconds);
  if(!Number.isSafeInteger(a0)||!Number.isSafeInteger(a1)||a1<=a0)errors.push('attempt_counter_invalid');
  if(!finitePositive(elapsed))errors.push('measurement_elapsed_invalid');
  const derived=(a1-a0)/elapsed,claimed=Number(m?.derived_work_rate);
  if(!finitePositive(claimed)||!finitePositive(derived)||Math.abs(claimed-derived)/derived>0.02)errors.push('derived_rate_mismatch');
  if(!finitePositive(m?.first_window_rate)||!finitePositive(m?.last_window_rate))errors.push('sustained_window_rate_missing');
  else if(Number(m.last_window_rate)/Number(m.first_window_rate)<contract.run_acceptance.sustained_throughput_retention_minimum)errors.push('sustained_throughput_retention_below_minimum');
  for(const field of ['validated_work_events','accepted_work_events','invalid_work_events','stale_work_events']){
    if(!Number.isSafeInteger(Number(m?.[field]))||Number(m[field])<0)errors.push('measurement_counter_invalid:'+field);
  }

  if(workload?.workload_id==='normal_use_coexistence'){
    const base=Number(m?.interactive_p95_ms_baseline),withMining=Number(m?.interactive_p95_ms_with_mining);
    if(!finitePositive(base)||!finitePositive(withMining))errors.push('normal_use_latency_missing');
    else if(withMining/base>contract.metrics.normal_use.maximum_p95_ratio_for_supported_class)errors.push('normal_use_latency_ratio_exceeded');
    if(Number(m?.failed_scripted_interactions)!==0)errors.push('failed_normal_use_script');
    if(!Number.isFinite(Number(m?.recovery_seconds))||Number(m.recovery_seconds)>contract.metrics.normal_use.maximum_recovery_seconds_after_foreground_load)errors.push('normal_use_recovery_exceeded');
  }
  if(workload?.workload_id==='lifecycle_recovery'){
    if(Number(m?.lifecycle_transitions)<Number(spec?.minimum_transitions||0))errors.push('lifecycle_transitions_insufficient');
  }

  const allowedEnergy=contract.metrics.energy.allowed_sources;
  if(!allowedEnergy.includes(energy?.measurement_source))errors.push('unknown_measurement_source');
  if(energy?.measurement_source==='UNAVAILABLE'){
    if(!energy?.missing_reason)errors.push('energy_missing_reason_required');
    if(energy?.efficiency_claimed===true)errors.push('energy_efficiency_claim_without_measurement');
  }else{
    if(!finitePositive(energy?.energy_wh)||!finitePositive(energy?.measured_seconds))errors.push('energy_measurement_invalid');
    if(['WALL_POWER','COMPONENT_TELEMETRY'].includes(energy?.measurement_source)){
      const p=Number(energy?.average_power_w);
      const range=energy.measurement_source==='WALL_POWER'?contract.metrics.energy.wall_power_w_plausible_range:contract.metrics.energy.component_telemetry_w_plausible_range;
      if(!finitePositive(p)||p<range[0]||p>range[1])errors.push('physically_implausible_energy');
      const expectedWh=p*Number(energy.measured_seconds)/3600;
      if(finitePositive(expectedWh)&&Math.abs(Number(energy.energy_wh)-expectedWh)/expectedWh>contract.metrics.energy.energy_consistency_relative_tolerance)errors.push('energy_duration_inconsistency');
    }
  }

  if(thermals?.telemetry_available===false&&!thermals?.missing_reason)errors.push('thermal_missing_reason_required');
  if(thermals?.critical_thermal_event===true||thermals?.device_shutdown===true)errors.push('critical_thermal_event');

  if(system?.contamination_detected===true)errors.push('contaminated_run');
  if(!Array.isArray(system?.events))errors.push('system_events_missing');
  if(!Array.isArray(miner?.events)||miner.events.length<2)errors.push('miner_events_incomplete');
  else{
    const seen=new Set();
    for(const ev of miner.events){
      if(!ev?.event_id||seen.has(ev.event_id))errors.push('duplicate_event');
      seen.add(ev?.event_id);
      const at=isoMs(ev?.at);if(!Number.isFinite(at)||at<started||at>ended)errors.push('miner_event_outside_run');
    }
  }

  const log=await readFile(join(root,'logs/miner.log'));
  if(log.length<20)errors.push('truncated_log');

  if(att?.run_id!==run?.run_id)errors.push('run_id_mismatch:attestation');
  if(att?.device_id!==device?.device_id)errors.push('device_attestation_mismatch');
  if(run?.evidence_class==='PHYSICAL_EVIDENCE'){
    if(att?.physical_run_performed!==true||att?.synthetic_data_used!==false||att?.test_fixture===true)errors.push('simulation_labeled_physical');
  }else if(run?.evidence_class==='REHEARSAL_ONLY'){
    if(att?.physical_run_performed!==false||att?.synthetic_data_used!==true)errors.push('rehearsal_attestation_invalid');
  }

  if(integrity?.contract_id!==contract.contract_id||integrity?.run_id!==run?.run_id||integrity?.evidence_class!==run?.evidence_class||integrity?.created_by_collector!==true)errors.push('integrity_binding_mismatch');
  if(run?.evidence_class==='PHYSICAL_EVIDENCE'&&integrity?.collection_mode!=='PHYSICAL_CAPTURE_IMPORT')errors.push('integrity_collection_mode_invalid');

  if(manifest?.contract_id!==contract.contract_id||manifest?.run_id!==run?.run_id)errors.push('manifest_binding_mismatch');
  if(!Array.isArray(manifest?.files))errors.push('manifest_files_missing');
  else{
    const expected=contract.required_bundle_files.filter(x=>x!=='manifest.json').sort();
    const listed=manifest.files.map(x=>x.path).sort();
    if(JSON.stringify(expected)!==JSON.stringify(listed))errors.push('manifest_file_set_mismatch');
    for(const entry of manifest.files){
      if(typeof entry.path!=='string'||entry.path.startsWith('/')||entry.path.includes('..')){errors.push('manifest_path_invalid');continue}
      try{
        const actual=await digestFile(join(root,entry.path));
        if(actual.sha256!==entry.sha256||actual.size_bytes!==Number(entry.size_bytes))errors.push('checksum_mismatch:'+entry.path);
      }catch{errors.push('checksum_missing:'+entry.path)}
    }
    if(manifest?.manifest_payload_sha256!==manifestPayloadHash(manifest.files))errors.push('manifest_payload_hash_mismatch');
  }

  const verdict=verdictFor(errors);
  return{
    verdict,errors,
    physical_evidence_admitted:verdict==='PASS'&&run?.evidence_class==='PHYSICAL_EVIDENCE',
    summary:{
      run_id:run?.run_id,evidence_class:run?.evidence_class,device_id:device?.device_id,device_class:device?.device_class,
      manufacturer:device?.manufacturer,model:device?.model,isa_family:device?.isa_family,form_factor:device?.form_factor,
      workload_id:workload?.workload_id,repetition:Number(workload?.repetition),derived_work_rate:claimed,
      sustained_retention:finitePositive(m?.first_window_rate)?Number(m?.last_window_rate)/Number(m?.first_window_rate):NaN,
      energy_source:energy?.measurement_source
    }
  };
}

const invokedPath=process.argv[1]?new URL('file://'+process.argv[1]).href:'';
if(import.meta.url===invokedPath){
  const a=parseArgs(process.argv.slice(2));
  if(!a.bundle){console.error('usage: verify-evidence.mjs --bundle <dir> [--expected-source-revision <sha>] [--expected-evidence-class <class>]');process.exit(2)}
  verifyEvidenceBundle(a.bundle,{expectedSourceRevision:a['expected-source-revision'],expectedEvidenceClass:a['expected-evidence-class']}).then(r=>{console.log(JSON.stringify(r,null,2));if(r.verdict!=='PASS')process.exitCode=1}).catch(e=>{console.error(e.stack||e);process.exit(1)});
}
