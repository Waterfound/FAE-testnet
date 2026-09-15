import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {basename,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const RELEASE_FORMAT='FAE_SOURCE_RELEASE_V2';
export const RELEASE_STATUS='candidate-package-only';

const here=dirname(fileURLToPath(import.meta.url));
export const repoRoot=resolve(here,'..','..');

function canonical(value){
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object'&&!Buffer.isBuffer(value))return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
  return value;
}
function stable(value){return JSON.stringify(canonical(value));}
function sha256(bytes){return createHash('sha256').update(bytes).digest('hex');}
function git(args,{encoding='utf8',cwd=repoRoot,maxBuffer=256*1024*1024}={}){
  return execFileSync('git',args,{cwd,encoding,maxBuffer,stdio:['ignore','pipe','pipe']});
}

export function assertCleanTrackedTree({cwd=repoRoot}={}){
  const dirty=git(['status','--porcelain=v1','--untracked-files=no'],{cwd}).trim();
  if(dirty)throw Object.assign(new Error('tracked_worktree_dirty'),{code:'tracked_worktree_dirty',detail:dirty});
  return true;
}

function commitIdentity({cwd=repoRoot}={}){
  const sourceCommit=git(['rev-parse','HEAD'],{cwd}).trim();
  const sourceTree=git(['rev-parse','HEAD^{tree}'],{cwd}).trim();
  const sourceDateEpoch=Number(git(['show','-s','--format=%ct','HEAD'],{cwd}).trim());
  if(!/^[0-9a-f]{40}$/.test(sourceCommit)||!/^[0-9a-f]{40}$/.test(sourceTree)||!Number.isSafeInteger(sourceDateEpoch)||sourceDateEpoch<=0)throw new Error('source_identity_invalid');
  return{sourceCommit,sourceTree,sourceDateEpoch};
}

function committedEntries({cwd=repoRoot}={}){
  const raw=git(['ls-tree','-r','-z','--full-tree','HEAD'],{cwd,encoding:null}).toString('utf8');
  const rows=[];
  for(const record of raw.split('\0').filter(Boolean)){
    const tab=record.indexOf('\t');if(tab<0)throw new Error('git_tree_row_invalid');
    const meta=record.slice(0,tab).split(' '),path=record.slice(tab+1);
    if(meta.length!==3||!path)throw new Error('git_tree_row_invalid');
    const[git_mode,type,object_id]=meta;
    if(type!=='blob')throw Object.assign(new Error('non_blob_tree_entry_unsupported'),{path,type});
    if(!/^(100644|100755|120000)$/.test(git_mode)||!/^[0-9a-f]{40}$/.test(object_id))throw new Error('git_tree_metadata_invalid');
    rows.push({git_mode,type,object_id,path});
  }
  rows.sort((a,b)=>a.path.localeCompare(b.path));
  if(new Set(rows.map(row=>row.path)).size!==rows.length)throw new Error('duplicate_tree_path');
  return rows;
}

function committedBlob(objectId,{cwd=repoRoot}={}){
  return git(['cat-file','blob',objectId],{cwd,encoding:null});
}

export async function buildReproducibleRelease({
  outDir=resolve(repoRoot,'dist','release'),artifactName='fae-source-release-v2.json',cwd=repoRoot
}={}){
  if(basename(artifactName)!==artifactName||!artifactName.endsWith('.json'))throw new Error('artifact_name_invalid');
  assertCleanTrackedTree({cwd});
  const{sourceCommit,sourceTree,sourceDateEpoch}=commitIdentity({cwd});
  const entries=committedEntries({cwd});
  const files=[];
  for(const entry of entries){
    const bytes=committedBlob(entry.object_id,{cwd});
    files.push({
      path:entry.path,git_mode:entry.git_mode,git_object:entry.object_id,
      bytes:bytes.length,sha256:sha256(bytes),content_base64:bytes.toString('base64')
    });
  }
  const configPath='sovereign-forge/release/release-candidate-config.json';
  const config=files.find(file=>file.path===configPath);if(!config)throw new Error('release_config_not_committed');
  const manifest={
    format:RELEASE_FORMAT,status:RELEASE_STATUS,
    source_commit:sourceCommit,source_tree:sourceTree,source_date_epoch:sourceDateEpoch,
    source_bytes:'git-commit-blobs-only',tracked_worktree_required:'clean',required_runtime:'node>=22',
    file_count:files.length,config_path:configPath,config_sha256:config.sha256,
    files:files.map(({content_base64,...meta})=>meta)
  };
  const artifact={format:RELEASE_FORMAT,status:RELEASE_STATUS,manifest,files:files.map(({path,content_base64})=>({path,content_base64}))};
  const artifactBytes=Buffer.from(stable(artifact));
  const manifestBytes=Buffer.from(stable(manifest));
  const artifactSha256=sha256(artifactBytes),manifestSha256=sha256(manifestBytes);
  const resolvedOut=resolve(outDir);await mkdir(resolvedOut,{recursive:true});
  const artifactPath=resolve(resolvedOut,artifactName),manifestPath=resolve(resolvedOut,'manifest.json'),checksumPath=resolve(resolvedOut,`${artifactName}.sha256`);
  await writeFile(artifactPath,artifactBytes);
  await writeFile(manifestPath,manifestBytes);
  await writeFile(checksumPath,`${artifactSha256}  ${artifactName}\n`);
  return{
    artifact_path:artifactPath,manifest_path:manifestPath,checksum_path:checksumPath,
    artifact_sha256:artifactSha256,manifest_sha256:manifestSha256,
    source_commit:sourceCommit,source_tree:sourceTree,file_count:files.length
  };
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const outIndex=process.argv.indexOf('--out'),nameIndex=process.argv.indexOf('--name');
  if(outIndex>=0&&!process.argv[outIndex+1])throw new Error('out_dir_missing');
  if(nameIndex>=0&&!process.argv[nameIndex+1])throw new Error('artifact_name_missing');
  const result=await buildReproducibleRelease({
    ...(outIndex>=0?{outDir:resolve(process.argv[outIndex+1])}:{}),
    ...(nameIndex>=0?{artifactName:process.argv[nameIndex+1]}:{})
  });
  console.log(JSON.stringify({status:'PASS',...result}));
}
