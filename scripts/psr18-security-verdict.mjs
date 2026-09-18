import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';

const root=resolve(new URL('../',import.meta.url).pathname);
const args=process.argv.slice(2);
const outIndex=args.indexOf('--out');
const outPath=resolve(outIndex>=0&&args[outIndex+1]?args[outIndex+1]:'dist/psr18-security-verdict.json');
const readJson=async path=>JSON.parse(await readFile(resolve(root,path),'utf8'));
const git=a=>execFileSync('git',a,{cwd:root,encoding:'utf8'}).trim();

const contract=await readJson('docs/security/FAE_PSR18_SECURITY_VERDICT_CONTRACT_V1.json');
const plan=await readJson('docs/FAE_PUBLIC_CODE_SECURITY_READINESS_BUILD_COLONY_RUN.json');
const psr16=await readJson('docs/security/FAE_PSR16_FINDING_CLOSURE_V1.json');
const psr17=await readJson('docs/security/FAE_PSR17_INTEGRATED_RESULT_V1.json');
const expected=await readJson('docs/security/FAE_PSR18_PUBLIC_CODE_SECURITY_VERDICT_V1.json');

if(contract.schema!=='FAE_PSR18_PUBLIC_CODE_SECURITY_VERDICT_CONTRACT_V1')throw new Error('psr18_contract_schema_invalid');
const allowed=new Set(contract.allowed_verdicts||[]);
for(const verdict of['BASELINE_READY_FOR_RECURRING_ASSURANCE','BLOCKED_BY_SECURITY_FINDINGS','BLOCKED_BY_MISSING_EVIDENCE']){
  if(!allowed.has(verdict))throw new Error('psr18_allowed_verdict_missing:'+verdict);
}

const head=git(['rev-parse','HEAD']);
const tree=git(['rev-parse','HEAD^{tree}']);
const missing=[];
const findings=[];

const phases=new Map((plan.phases||[]).map(row=>[row.id,row]));
for(const id of contract.required_green_phases||[]){
  const phase=phases.get(id);
  if(!phase)missing.push('missing_phase:'+id);
  else if(phase.state!=='GREEN')missing.push('phase_not_green:'+id+':'+phase.state);
}

if(psr17.status!=='GREEN_INTEGRATED')missing.push('psr17_not_integrated_green');
if(!isAncestor(psr17.integration_commit,head))missing.push('psr17_merge_not_ancestor');
if(psr17.replay_report?.status!=='PASS_FULL_SECURITY_BASELINE_REPLAY')missing.push('psr17_replay_status_not_pass');
if(psr17.replay_report?.planned_steps!==17||psr17.replay_report?.passed_steps!==17||psr17.replay_report?.failed_steps!==0)missing.push('psr17_replay_count_mismatch');
if(psr17.replay_report?.target_unchanged!==true)missing.push('psr17_target_changed');
if(psr17.replay_report?.retry_violation!==false)missing.push('psr17_retry_violation');

for(const [name,row] of Object.entries(psr17.runs||{})){
  if(name==='codeql'){
    if(row.status!=='SUCCESS_SIGNAL_ONLY')missing.push('psr17_run_not_green:'+name+':'+row.status);
  }else if(row.status!=='SUCCESS')missing.push('psr17_run_not_green:'+name+':'+row.status);
}

const open=psr16.closure?.open_blockers||[];
for(const item of open)findings.push(item);
if((psr16.regression_promotion?.promoted_count??0)!==17)missing.push('psr16_regression_promotion_incomplete');
if((psr16.closure?.residual_risk_acceptances||[]).length>0)missing.push('unexpected_residual_risk_acceptance');
if((psr16.closure?.admitted_findings||[]).length>0&&open.length===0){
  missing.push('admitted_findings_present_without_current_closure_reconciliation');
}

let verdict;
if(findings.length>0)verdict='BLOCKED_BY_SECURITY_FINDINGS';
else if(missing.length>0)verdict='BLOCKED_BY_MISSING_EVIDENCE';
else verdict='BASELINE_READY_FOR_RECURRING_ASSURANCE';

if(expected.schema!=='FAE_PSR18_PUBLIC_CODE_SECURITY_VERDICT_V1')throw new Error('psr18_expected_verdict_schema_invalid');
if(expected.verdict!==verdict)missing.push('committed_verdict_mismatch:'+expected.verdict+':'+verdict);
if(missing.some(x=>x.startsWith('committed_verdict_mismatch:')))verdict='BLOCKED_BY_MISSING_EVIDENCE';

const report={
  schema:'FAE_PSR18_PUBLIC_CODE_SECURITY_VERDICT_REPORT_V1',
  verdict,
  target:{commit:head,tree},
  required_green_phases:contract.required_green_phases,
  missing_evidence:missing,
  open_security_findings:findings,
  integrated_psr17:{
    merge_commit:psr17.integration_commit,
    replay:psr17.replay_report,
    runs:psr17.runs
  },
  authority:{
    mainnet_authority:false,
    release_authority:false,
    consensus_activation:false,
    economic_activation:false
  },
  downstream:{
    psr19_ready:verdict==='BASELINE_READY_FOR_RECURRING_ASSURANCE'
  }
};

await mkdir(dirname(outPath),{recursive:true});
await writeFile(outPath,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
if(verdict!=='BASELINE_READY_FOR_RECURRING_ASSURANCE')process.exitCode=1;

function isAncestor(ancestor,descendant){
  try{
    execFileSync('git',['merge-base','--is-ancestor',ancestor,descendant],{cwd:root,stdio:['ignore','ignore','ignore']});
    return true;
  }catch{return false;}
}
