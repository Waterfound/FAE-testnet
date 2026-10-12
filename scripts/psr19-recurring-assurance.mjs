import {execFileSync,spawnSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(new URL('../',import.meta.url).pathname);

export function classifyChangedFiles(changedFiles,policy){
  const matched={};
  for(const name of policy.mandatory_deep_review_categories)matched[name]=[];
  for(const file of changedFiles){
    for(const name of policy.mandatory_deep_review_categories){
      const rule=policy.categories[name];
      const hit=(rule.exact||[]).includes(file)||(rule.prefixes||[]).some(prefix=>file.startsWith(prefix));
      if(hit)matched[name].push(file);
    }
  }
  const active=Object.entries(matched).filter(([,files])=>files.length).map(([name])=>name);
  return{deep_review_required:active.length>0,categories:active,matches:matched};
}

function git(args){return execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();}

function normalizeBase(base,head){
  if(base&&/^([0-9a-f]{40})$/.test(base)&&!/^[0]+$/.test(base))return base;
  try{return git(['rev-parse',head+'^']);}catch{return head;}
}

export async function runRecurringAssurance({base,head,outPath}={}){
  const policy=JSON.parse(await readFile(resolve(root,'docs/security/FAE_PSR19_RECURRING_ASSURANCE_POLICY_V1.json'),'utf8'));
  const verdict=JSON.parse(await readFile(resolve(root,policy.baseline_verdict.artifact),'utf8'));
  if(policy.schema!=='FAE_PSR19_RECURRING_ASSURANCE_POLICY_V1')throw new Error('psr19_policy_schema_invalid');
  if(verdict.verdict!==policy.baseline_verdict.expected)throw new Error('psr19_baseline_verdict_invalid');
  if(policy.project_shape?.create_new_security_system!==false)throw new Error('psr19_new_security_system_forbidden');
  if(policy.authority?.authority!=='NONE'||policy.authority?.target_writes!==false||policy.authority?.production_actions!==false)throw new Error('psr19_authority_boundary_invalid');

  const resolvedHead=head&&/^[0-9a-f]{40}$/.test(head)?head:git(['rev-parse','HEAD']);
  const resolvedBase=normalizeBase(base,resolvedHead);
  const baselineAncestor=spawnSync('git',['merge-base','--is-ancestor',policy.source_baseline,resolvedHead],{cwd:root}).status===0;
  if(!baselineAncestor)throw new Error('psr19_baseline_not_ancestor');

  const changedRaw=resolvedBase===resolvedHead?'':git(['diff','--name-only',resolvedBase,resolvedHead]);
  const changedFiles=changedRaw?changedRaw.split(/\r?\n/).filter(Boolean):[];
  const classification=classifyChangedFiles(changedFiles,policy);

  const headBefore=git(['rev-parse','HEAD']);
  const treeBefore=git(['rev-parse','HEAD^{tree}']);
  const dirtyBefore=git(['status','--porcelain=v1','--untracked-files=no']);
  if(dirtyBefore)throw new Error('psr19_target_not_clean_before_run');

  let campaign=null;
  if(classification.deep_review_required){
    const tempOut=resolve(process.env.RUNNER_TEMP||process.env.TMPDIR||'/tmp','fae-psr19-psr15-report.json');
    const run=spawnSync(process.execPath,[resolve(root,policy.deep_review.runner),'--out',tempOut],{
      cwd:root,encoding:'utf8',timeout:1800000,maxBuffer:64*1024*1024,stdio:['ignore','pipe','pipe']
    });
    let report=null;
    try{report=JSON.parse(await readFile(tempOut,'utf8'));}catch{}
    campaign={
      exit_code:run.status,
      execution_error:run.error?String(run.error.message||run.error):null,
      report
    };
    const valid=run.status===0 &&
      report?.schema===policy.deep_review.expected_report_schema &&
      report?.status===policy.deep_review.expected_status &&
      report?.attacks?.executed===policy.deep_review.expected_attack_count &&
      report?.attacks?.passed===policy.deep_review.expected_attack_count &&
      (report?.findings?.length??-1)===policy.deep_review.expected_findings;
    if(!valid){
      const final={
        schema:'FAE_PSR19_RECURRING_ASSURANCE_REPORT_V1',
        status:'BLOCKED_BY_RECURRING_ASSURANCE',
        baseline_verdict:verdict.verdict,
        diff:{base:resolvedBase,head:resolvedHead,changed_files:changedFiles},
        classification,
        campaign,
        authority:policy.authority
      };
      await mkdir(dirname(outPath),{recursive:true});
      await writeFile(outPath,JSON.stringify(final,null,2)+'\n');
      console.log(JSON.stringify(final,null,2));
      process.exitCode=1;
      return final;
    }
  }

  const headAfter=git(['rev-parse','HEAD']);
  const treeAfter=git(['rev-parse','HEAD^{tree}']);
  const dirtyAfter=git(['status','--porcelain=v1','--untracked-files=no']);
  const targetUnchanged=headBefore===headAfter&&treeBefore===treeAfter&&!dirtyAfter;
  if(!targetUnchanged)throw new Error('psr19_target_mutated');

  const report={
    schema:'FAE_PSR19_RECURRING_ASSURANCE_REPORT_V1',
    status:classification.deep_review_required?'PASS_DEEP_REVIEW':'PASS_NO_DEEP_REVIEW_REQUIRED',
    baseline_verdict:verdict.verdict,
    diff:{base:resolvedBase,head:resolvedHead,changed_files:changedFiles},
    classification,
    campaign:campaign?.report?{
      schema:campaign.report.schema,
      status:campaign.report.status,
      attacks:campaign.report.attacks,
      findings:campaign.report.findings.length,
      target:campaign.report.target
    }:null,
    target_unchanged:true,
    authority:policy.authority
  };
  await mkdir(dirname(outPath),{recursive:true});
  await writeFile(outPath,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
  return report;
}

async function main(){
  const args=process.argv.slice(2);
  const value=name=>{const i=args.indexOf(name);return i>=0?args[i+1]:undefined;};
  const outPath=resolve(value('--out')||'dist/psr19-recurring-assurance-report.json');
  await runRecurringAssurance({base:value('--base'),head:value('--head'),outPath});
}

const invoked=process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url));
if(invoked)await main();
