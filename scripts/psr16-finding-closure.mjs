import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';

const root=resolve(new URL('../',import.meta.url).pathname);
const args=process.argv.slice(2);
const arg=name=>{
  const i=args.indexOf(name);
  if(i<0||!args[i+1])throw new Error(name.slice(2)+'_missing');
  return args[i+1];
};
const reportPath=resolve(arg('--report'));
const outPath=resolve(arg('--out'));
const report=JSON.parse(await readFile(reportPath,'utf8'));
const ledger=JSON.parse(await readFile(resolve(root,'docs/security/FAE_PSR16_FINDING_CLOSURE_V1.json'),'utf8'));
const git=a=>execFileSync('git',a,{cwd:root,encoding:'utf8'}).trim();

if(report.schema!=='FAE_PSR15_PROJECT_ASSURANCE_REPORT_V1')throw new Error('psr15_report_schema_invalid');
if(report.status!=='PASS_NO_BASELINE_BLOCKING_FINDINGS')throw new Error('psr16_new_or_open_finding');
if(report.attacks?.planned!==17||report.attacks?.executed!==17||report.attacks?.passed!==17||report.attacks?.failed!==0)throw new Error('psr16_campaign_count_mismatch');
if(!Array.isArray(report.findings)||report.findings.length!==0)throw new Error('psr16_findings_not_zero');
if(report.target?.unchanged_after!==true)throw new Error('psr16_target_mutated');
if(report.authority?.authority!=='NONE'||report.authority?.target_writes!==false||report.authority?.production_actions!==false)throw new Error('psr16_authority_boundary_invalid');

const head=git(['rev-parse','HEAD']);
const tree=git(['rev-parse','HEAD^{tree}']);
if(report.target?.commit!==head||report.target?.tree!==tree)throw new Error('psr16_report_not_bound_to_current_head');
const ancestry=execFileSync('git',['merge-base','--is-ancestor',ledger.prerequisite.merge_commit,head],{cwd:root});
void ancestry;

if(ledger.closure.admitted_findings.length||ledger.closure.residual_risk_acceptances.length||ledger.closure.open_blockers.length)throw new Error('psr16_ledger_not_zero_finding');
if(ledger.regression_promotion.promoted_count!==17)throw new Error('psr16_regression_promotion_incomplete');

const closure={
  schema:'FAE_PSR16_FINDING_CLOSURE_REPORT_V1',
  status:'PASS_ZERO_FINDING_CLOSURE',
  target:{commit:head,tree},
  psr15_report:{
    status:report.status,
    attacks:report.attacks,
    findings:report.findings.length,
    target_unchanged:report.target.unchanged_after
  },
  closure:{
    admitted_findings:0,
    fixed_findings:0,
    residual_risk_acceptances:0,
    open_blockers:0,
    promoted_regressions:ledger.regression_promotion.promoted_count
  },
  authority:'NONE'
};
await mkdir(dirname(outPath),{recursive:true});
await writeFile(outPath,JSON.stringify(closure,null,2)+'\n');
console.log(JSON.stringify(closure,null,2));
