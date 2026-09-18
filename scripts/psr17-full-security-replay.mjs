import {createHash} from 'node:crypto';
import {spawnSync,execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {tmpdir} from 'node:os';

const root=resolve(new URL('../',import.meta.url).pathname);
const args=process.argv.slice(2);
const outIndex=args.indexOf('--out');
const outPath=resolve(outIndex>=0&&args[outIndex+1]?args[outIndex+1]:'dist/psr17-full-security-baseline-replay.json');
const manifest=JSON.parse(await readFile(resolve(root,'docs/security/FAE_PSR17_FULL_SECURITY_BASELINE_REPLAY_V1.json'),'utf8'));
const sha256=value=>createHash('sha256').update(value).digest('hex');
const git=a=>execFileSync('git',a,{cwd:root,encoding:'utf8'}).trim();

if(manifest.schema!=='FAE_PSR17_FULL_SECURITY_BASELINE_REPLAY_V1')throw new Error('psr17_manifest_schema_invalid');
if(manifest.retry_policy?.selective_retry_forbidden!==true||manifest.retry_policy?.per_step_attempts!==1)throw new Error('psr17_retry_policy_invalid');
if(manifest.authority?.target_writes!==false||manifest.authority?.production_actions!==false||manifest.authority?.mainnet_authority!==false)throw new Error('psr17_authority_boundary_invalid');

const headBefore=git(['rev-parse','HEAD']);
const treeBefore=git(['rev-parse','HEAD^{tree}']);
const dirtyBefore=git(['status','--porcelain=v1','--untracked-files=no']);
if(dirtyBefore)throw new Error('psr17_target_not_clean_before_run');
if(spawnSync('git',['merge-base','--is-ancestor',manifest.source_baseline,headBefore],{cwd:root}).status!==0)throw new Error('psr17_source_baseline_not_ancestor');

const temp=await mkdtemp(join(tmpdir(),'fae-psr17-'));
const steps=[];
const outputs={};

function run(id,title,bin,cmdArgs,{cwd=root,timeout=600000,env=process.env}={}){
  const started=Date.now();
  const result=spawnSync(bin,cmdArgs,{
    cwd,env,encoding:'utf8',timeout,maxBuffer:64*1024*1024,stdio:['ignore','pipe','pipe']
  });
  const stdout=result.stdout||'',stderr=result.stderr||'';
  const row={
    id,title,attempts:1,
    passed:result.status===0&&!result.error,
    exit_code:result.status,
    signal:result.signal??null,
    timed_out:Boolean(result.error&&result.error.code==='ETIMEDOUT'),
    duration_ms:Date.now()-started,
    stdout_sha256:sha256(stdout),
    stderr_sha256:sha256(stderr),
    stdout_bytes:Buffer.byteLength(stdout),
    stderr_bytes:Buffer.byteLength(stderr),
    execution_error:result.error?String(result.error.message||result.error):null
  };
  steps.push(row);
  return{...row,stdout,stderr};
}

function parseJsonFile(path,expectedSchema){
  return readFile(path,'utf8').then(raw=>{
    const value=JSON.parse(raw);
    if(expectedSchema&&value.schema!==expectedSchema)throw new Error('schema_mismatch:'+expectedSchema);
    return value;
  });
}

let cleanupErrors=[];
try{
  const psr15Path=join(temp,'psr15.json');
  const psr16Path=join(temp,'psr16.json');

  const campaign=run('R17-01','PSR-15 white-box campaign full rerun',process.execPath,[
    resolve(root,'scripts/psr15-project-assurance.mjs'),'--out',psr15Path
  ],{timeout:1800000});
  if(campaign.passed){
    const report=await parseJsonFile(psr15Path,'FAE_PSR15_PROJECT_ASSURANCE_REPORT_V1');
    outputs.psr15={
      status:report.status,
      target:report.target,
      attacks:report.attacks,
      findings:report.findings?.length??null
    };
    if(report.status!=='PASS_NO_BASELINE_BLOCKING_FINDINGS'||report.attacks?.passed!==17||report.findings?.length!==0){
      steps.at(-1).passed=false;
      steps.at(-1).semantic_error='psr15_report_not_zero_finding_pass';
    }
  }

  const closure=run('R17-02','PSR-16 zero-finding closure on fresh PSR-15 report',process.execPath,[
    resolve(root,'scripts/psr16-finding-closure.mjs'),'--report',psr15Path,'--out',psr16Path
  ],{timeout:300000});
  if(closure.passed){
    const report=await parseJsonFile(psr16Path,'FAE_PSR16_FINDING_CLOSURE_REPORT_V1');
    outputs.psr16=report;
    if(report.status!=='PASS_ZERO_FINDING_CLOSURE'||report.closure?.open_blockers!==0||report.closure?.promoted_regressions!==17){
      steps.at(-1).passed=false;
      steps.at(-1).semantic_error='psr16_closure_not_green';
    }
  }

  run('R17-03','Independent release Git-oracle replay',process.execPath,[
    resolve(root,'sovereign-forge/tests/release-mainnet-independent-verifier-g2.mjs')
  ],{timeout:300000});

  const wtA=join(temp,'clean-a'),wtB=join(temp,'clean-b');
  const addA=run('R17-04A','Create clean-room worktree A','git',['worktree','add','--detach',wtA,headBefore],{timeout:120000});
  const addB=run('R17-04B','Create clean-room worktree B','git',['worktree','add','--detach',wtB,headBefore],{timeout:120000});
  const outA=join(temp,'release-a'),outB=join(temp,'release-b');

  if(addA.passed){
    run('R17-04C','Build clean-room source release A',process.execPath,[
      join(wtA,'sovereign-forge/scripts/build-reproducible-release.mjs'),'--out',outA
    ],{cwd:wtA,timeout:300000});
  }else steps.push({id:'R17-04C',title:'Build clean-room source release A',attempts:0,passed:false,blocked_by:'R17-04A'});
  if(addB.passed){
    run('R17-04D','Build clean-room source release B',process.execPath,[
      join(wtB,'sovereign-forge/scripts/build-reproducible-release.mjs'),'--out',outB
    ],{cwd:wtB,timeout:300000});
  }else steps.push({id:'R17-04D',title:'Build clean-room source release B',attempts:0,passed:false,blocked_by:'R17-04B'});

  let cleanRoomPass=false;
  try{
    const names=['fae-source-release-v2.json','manifest.json','fae-source-release-v2.json.sha256'];
    const hashes={};
    cleanRoomPass=true;
    for(const name of names){
      const a=await readFile(join(outA,name)),b=await readFile(join(outB,name));
      const equal=a.equals(b);
      hashes[name]={a_sha256:sha256(a),b_sha256:sha256(b),equal};
      if(!equal)cleanRoomPass=false;
    }
    outputs.clean_room={files:hashes,byte_identical:cleanRoomPass};
  }catch(error){
    outputs.clean_room={byte_identical:false,error:String(error.message||error)};
  }
  steps.push({
    id:'R17-04E',title:'Compare clean-room source release bytes',attempts:1,
    passed:cleanRoomPass,duration_ms:0,
    semantic_error:cleanRoomPass?null:'clean_room_release_mismatch_or_missing'
  });

  const lock=JSON.parse(await readFile(resolve(root,'release/provenance/container-inputs-v1.json'),'utf8'));
  const pinned=lock.policy?.pinned_from;
  if(!pinned||!pinned.includes('@sha256:'))throw new Error('psr17_container_lock_invalid');
  const pull=run('R17-05A','Pull immutable container base input','docker',['pull',pinned],{timeout:600000});
  outputs.container={pinned_from:pinned,pull_passed:pull.passed,builds:[]};

  const dockerfiles=lock.protected_dockerfiles||[];
  for(let i=0;i<dockerfiles.length;i++){
    const source=dockerfiles[i],derived=join(temp,'Dockerfile.'+(i+1));
    const pin=run('R17-05P'+(i+1),'Generate pinned Dockerfile '+source,process.execPath,[
      resolve(root,'scripts/psr13-pinned-dockerfile.mjs'),'--dockerfile',source,'--out',derived
    ],{timeout:60000});
    let build={passed:false};
    if(pin.passed&&pull.passed){
      build=run('R17-05B'+(i+1),'Build pinned container '+source,'docker',[
        'build','--pull=false','-f',derived,resolve(root,'sovereign-forge/node')
      ],{timeout:900000});
    }else{
      steps.push({
        id:'R17-05B'+(i+1),title:'Build pinned container '+source,attempts:0,passed:false,
        blocked_by:!pull.passed?'R17-05A':'R17-05P'+(i+1)
      });
    }
    outputs.container.builds.push({dockerfile:source,pin_passed:pin.passed,build_passed:Boolean(build.passed)});
  }
}finally{
  for(const dir of[join(temp,'clean-a'),join(temp,'clean-b')]){
    try{
      const res=spawnSync('git',['worktree','remove','--force',dir],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']});
      if(res.status!==0)cleanupErrors.push({dir,exit_code:res.status,stderr_sha256:sha256(res.stderr||'')});
    }catch(error){cleanupErrors.push({dir,error:String(error.message||error)});}
  }
}

const headAfter=git(['rev-parse','HEAD']);
const treeAfter=git(['rev-parse','HEAD^{tree}']);
const dirtyAfter=git(['status','--porcelain=v1','--untracked-files=no']);
const targetUnchanged=headBefore===headAfter&&treeBefore===treeAfter&&!dirtyAfter;
const failed=steps.filter(row=>row.passed!==true);
const retryViolation=steps.some(row=>(row.attempts??1)>1);
const status=failed.length===0&&targetUnchanged&&!retryViolation?'PASS_FULL_SECURITY_BASELINE_REPLAY':'BLOCKED_BY_BASELINE_REPLAY_FAILURE';

const report={
  schema:'FAE_PSR17_FULL_SECURITY_BASELINE_REPLAY_REPORT_V1',
  status,
  target:{commit:headBefore,tree:treeBefore,clean_before:true,unchanged_after:targetUnchanged},
  retry_policy:{selective_retry_forbidden:true,retry_violation:retryViolation},
  steps,
  outputs,
  cleanup_errors:cleanupErrors,
  external_required_checks:manifest.external_required_checks,
  authority:manifest.authority
};
await mkdir(dirname(outPath),{recursive:true});
await writeFile(outPath,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({
  status,
  target_commit:headBefore,
  steps:{planned:steps.length,passed:steps.filter(x=>x.passed===true).length,failed:failed.length},
  failed:failed.map(x=>({id:x.id,title:x.title,exit_code:x.exit_code,semantic_error:x.semantic_error,blocked_by:x.blocked_by})),
  target_unchanged:targetUnchanged,
  retry_violation:retryViolation,
  report:outPath
},null,2));
await rm(temp,{recursive:true,force:true}).catch(()=>{});
if(status!=='PASS_FULL_SECURITY_BASELINE_REPLAY')process.exitCode=1;
