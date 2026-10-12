#!/usr/bin/env node
import {readdir,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {contract,parseArgs,median} from './lib.mjs';
import {verifyEvidenceBundle} from './verify-evidence.mjs';

export async function verifyPortfolio(portfolioDir,expectations={}){
  const root=resolve(portfolioDir),entries=await readdir(root,{withFileTypes:true});
  const dirs=entries.filter(x=>x.isDirectory()).map(x=>join(root,x.name)).sort();
  const runs=[];
  for(const dir of dirs)runs.push(await verifyEvidenceBundle(dir,{expectedSourceRevision:expectations.expectedSourceRevision,expectedEvidenceClass:expectations.expectedEvidenceClass}));
  const errors=[],valid=runs.filter(x=>x.verdict==='PASS');
  if(valid.length!==runs.length)errors.push('one_or_more_run_bundles_failed');
  const seenIds=new Set();
  for(const r of valid){const id=r.summary.run_id;if(seenIds.has(id))errors.push('duplicate_run_id:'+id);seenIds.add(id)}
  const required=contract.coverage_contract.required_class_ids;
  const byClass=new Map();
  for(const r of valid){
    const c=r.summary.device_class;if(!byClass.has(c))byClass.set(c,[]);byClass.get(c).push(r.summary);
  }
  for(const c of required){
    const rows=byClass.get(c)||[];
    if(!rows.length){errors.push('missing_required_class:'+c);continue}
    const deviceIds=new Set(rows.map(x=>x.device_id));
    if(deviceIds.size!==1)errors.push('multiple_selected_devices_within_class:'+c);
    for(const workloadId of ['pure_mining_sustained','normal_use_coexistence']){
      const wr=rows.filter(x=>x.workload_id===workloadId);
      if(wr.length<contract.run_acceptance.minimum_valid_repetitions_per_required_workload)errors.push('missing_required_repetition:'+c+':'+workloadId);
      const reps=new Set(wr.map(x=>x.repetition));
      for(let n=1;n<=contract.run_acceptance.minimum_valid_repetitions_per_required_workload;n++)if(!reps.has(n))errors.push('missing_repetition_number:'+c+':'+workloadId+':'+n);
    }
    if(contract.workload_protocol.lifecycle_recovery.required_for_classes.includes(c)){
      const life=rows.filter(x=>x.workload_id==='lifecycle_recovery');
      if(life.length<1)errors.push('missing_lifecycle_recovery:'+c);
    }
  }
  const selected=required.map(c=>(byClass.get(c)||[])[0]).filter(Boolean);
  const isa=new Set(selected.map(x=>x.isa_family)),forms=new Set(selected.map(x=>x.form_factor));
  if(isa.size<contract.coverage_contract.minimum_distinct_isa_families)errors.push('insufficient_isa_diversity');
  if(forms.size<contract.coverage_contract.minimum_distinct_form_factors)errors.push('insufficient_form_factor_diversity');

  const medians=[];
  for(const c of required){
    const rows=(byClass.get(c)||[]).filter(x=>x.workload_id==='pure_mining_sustained');
    const value=median(rows.map(x=>Number(x.derived_work_rate)));
    if(Number.isFinite(value)&&value>0)medians.push({device_class:c,median_work_rate:value});
  }
  let specializationRatio=null,materialRisk=false;
  if(medians.length===required.length){
    const rates=medians.map(x=>x.median_work_rate),min=Math.min(...rates),max=Math.max(...rates);
    specializationRatio=max/min;
    if(specializationRatio>contract.portfolio_acceptance.maximum_cross_class_median_throughput_ratio_before_material_specialization_flag)materialRisk=true;
  }else errors.push('insufficient_cross_class_rate_data');

  const classes=[...byClass.keys()];
  const allRehearsal=valid.length>0&&valid.every(x=>x.summary.evidence_class==='REHEARSAL_ONLY');
  const allPhysical=valid.length>0&&valid.every(x=>x.summary.evidence_class==='PHYSICAL_EVIDENCE');
  let verdict;
  if(errors.length)verdict='INSUFFICIENT_REPRESENTATIVE_DEVICE_EVIDENCE';
  else if(allRehearsal)verdict='READINESS_REHEARSAL_ONLY';
  else if(materialRisk)verdict='MATERIAL_SPECIALIZATION_RISK_FOUND';
  else if(allPhysical)verdict='REPRESENTATIVE_DEVICE_SUPPORT_WITHIN_CURRENT_EVIDENCE';
  else verdict='INSUFFICIENT_REPRESENTATIVE_DEVICE_EVIDENCE';

  return{
    schema:'FAE_RDE_PORTFOLIO_VERIFICATION_V1',verdict,errors,
    run_count:runs.length,valid_run_count:valid.length,
    required_classes:required,observed_classes:classes,
    isa_family_count:isa.size,form_factor_count:forms.size,
    class_median_work_rates:medians,
    cross_class_median_throughput_ratio:specializationRatio,
    material_specialization_risk:materialRisk,
    physical_portfolio_structurally_admissible:!errors.length&&allPhysical,
    final_evidence_admission:false,
    note:'RDE-X3 final evidence admission remains external even when physical bundles are structurally admissible.',
    run_results:runs.map(x=>({verdict:x.verdict,summary:x.summary,errors:x.errors}))
  };
}
const invokedPath=process.argv[1]?new URL('file://'+process.argv[1]).href:'';
if(import.meta.url===invokedPath){
  const a=parseArgs(process.argv.slice(2));
  if(!a.portfolio){console.error('usage: verify-portfolio.mjs --portfolio <dir> [--expected-evidence-class <class>]');process.exit(2)}
  verifyPortfolio(a.portfolio,{expectedSourceRevision:a['expected-source-revision'],expectedEvidenceClass:a['expected-evidence-class']}).then(r=>{console.log(JSON.stringify(r,null,2));if(['INSUFFICIENT_REPRESENTATIVE_DEVICE_EVIDENCE'].includes(r.verdict))process.exitCode=1}).catch(e=>{console.error(e.stack||e);process.exit(1)});
}
