import {createHash} from 'node:crypto';
import {spawnSync,execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';

const root=resolve(new URL('../',import.meta.url).pathname);
const args=process.argv.slice(2);
const outIndex=args.indexOf('--out');
const outPath=resolve(outIndex>=0&&args[outIndex+1]?args[outIndex+1]:'dist/psr15-project-assurance-report.json');
const campaign=JSON.parse(await readFile(resolve(root,'docs/security/FAE_PSR15_WHITE_BOX_CAMPAIGN_V1.json'),'utf8'));
const sha256=value=>createHash('sha256').update(value).digest('hex');
const git=a=>execFileSync('git',a,{cwd:root,encoding:'utf8'}).trim();

if(campaign.schema!=='FAE_PSR15_WHITE_BOX_CAMPAIGN_V1')throw new Error('psr15_campaign_schema_invalid');
if(campaign.authority?.authority!=='NONE'||campaign.authority?.target_writes!==false||campaign.authority?.production_actions!==false)throw new Error('psr15_authority_boundary_invalid');

const headBefore=git(['rev-parse','HEAD']);
const treeBefore=git(['rev-parse','HEAD^{tree}']);
const dirtyBefore=git(['status','--porcelain=v1','--untracked-files=no']);
if(dirtyBefore)throw new Error('psr15_target_not_clean_before_run');
const ancestry=spawnSync('git',['merge-base','--is-ancestor',campaign.source_baseline,headBefore],{cwd:root});
if(ancestry.status!==0)throw new Error('psr15_source_baseline_not_ancestor');

const allowedEnv=['PATH','HOME','RUNNER_TEMP','TMPDIR','TEMP','TMP','CI','GITHUB_ACTIONS','LANG','LC_ALL','NODE_OPTIONS'];
const childEnv={};
for(const key of allowedEnv)if(process.env[key]!==undefined)childEnv[key]=process.env[key];
childEnv.PSR15_PROJECT_ASSURANCE='1';

const results=[];
for(const attack of campaign.attacks){
  const [bin,...cmdArgs]=attack.command;
  const started=Date.now();
  const run=spawnSync(bin,cmdArgs,{
    cwd:root,
    env:childEnv,
    encoding:'utf8',
    timeout:attack.timeout_ms,
    maxBuffer:16*1024*1024,
    stdio:['ignore','pipe','pipe']
  });
  const stdout=run.stdout||'',stderr=run.stderr||'';
  const timedOut=Boolean(run.error&&run.error.code==='ETIMEDOUT');
  const passed=run.status===0&&!timedOut&&!run.error;
  results.push({
    id:attack.id,
    title:attack.title,
    surfaces:attack.surfaces,
    invariants:attack.invariants,
    severity_on_failure:attack.severity_on_failure,
    passed,
    exit_code:run.status,
    signal:run.signal??null,
    timed_out:timedOut,
    duration_ms:Date.now()-started,
    stdout_sha256:sha256(stdout),
    stderr_sha256:sha256(stderr),
    stdout_bytes:Buffer.byteLength(stdout),
    stderr_bytes:Buffer.byteLength(stderr),
    execution_error:run.error?String(run.error.message||run.error):null
  });
}

const headAfter=git(['rev-parse','HEAD']);
const treeAfter=git(['rev-parse','HEAD^{tree}']);
const dirtyAfter=git(['status','--porcelain=v1','--untracked-files=no']);
const targetUnchanged=headBefore===headAfter&&treeBefore===treeAfter&&!dirtyAfter;
const findings=results.filter(row=>!row.passed).map(row=>({
  id:'PSR15-F-'+row.id,
  source_attack:row.id,
  surfaces:row.surfaces,
  invariants:row.invariants,
  severity:row.severity_on_failure,
  status:'OPEN_BLOCKER',
  evidence:{
    exit_code:row.exit_code,
    timed_out:row.timed_out,
    stdout_sha256:row.stdout_sha256,
    stderr_sha256:row.stderr_sha256
  },
  waived:false
}));
if(!targetUnchanged)findings.push({
  id:'PSR15-F-TARGET-MUTATION',
  source_attack:'campaign-runner',
  surfaces:['AS-09','AS-11'],
  invariants:['I-SUPPLYCHAIN-01','I-AUTHORITY-01'],
  severity:'baseline_blocking',
  status:'OPEN_BLOCKER',
  evidence:{head_before:headBefore,head_after:headAfter,tree_before:treeBefore,tree_after:treeAfter,dirty_after:dirtyAfter},
  waived:false
});

const report={
  schema:'FAE_PSR15_PROJECT_ASSURANCE_REPORT_V1',
  status:findings.length?'BLOCKED_BY_SECURITY_FINDINGS':'PASS_NO_BASELINE_BLOCKING_FINDINGS',
  method:{system:campaign.method.system,revision:campaign.method.revision,mode:campaign.method.mode},
  target:{commit:headBefore,tree:treeBefore,clean_before:true,unchanged_after:targetUnchanged},
  authority:campaign.authority,
  attacks:{planned:campaign.attacks.length,executed:results.length,passed:results.filter(x=>x.passed).length,failed:results.filter(x=>!x.passed).length},
  results,
  findings,
  finding_policy:campaign.finding_policy
};
await mkdir(dirname(outPath),{recursive:true});
await writeFile(outPath,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({
  status:report.status,
  target_commit:headBefore,
  attacks:report.attacks,
  findings:findings.map(x=>({id:x.id,severity:x.severity,surfaces:x.surfaces,invariants:x.invariants})),
  target_unchanged:targetUnchanged,
  authority:'NONE',
  report:outPath
},null,2));
if(findings.length)process.exitCode=1;
