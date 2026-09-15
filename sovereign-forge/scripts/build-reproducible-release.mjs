import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {basename,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const RELEASE_FORMAT='FAE_SOURCE_RELEASE_V1';
export const RELEASE_STATUS='candidate-package-only';

const here=dirname(fileURLToPath(import.meta.url));
const repoRoot=resolve(here,'..','..');

function canonical(value){
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
  return value;
}
function stable(value){return JSON.stringify(canonical(value));}
function sha256(bytes){return createHash('sha256').update(bytes).digest('hex');}
function git(args,{encoding='utf8'}={}){return execFileSync('git',args,{cwd:repoRoot,encoding,maxBuffer:64*1024*1024});}

function trackedEntries(){
  const raw=git(['ls-files','-s','-z'],{encoding:'buffer'}).toString('utf8');
  const rows=raw.split('\0').filter(Boolean).map(row=>{
    const tab=row.indexOf('\t');if(tab<0)throw new Error('git_index_row_invalid');
    const meta=row.slice(0,tab).split(' '),path=row.slice(tab+1);if(meta.length<3||!path)throw new Error('git_index_row_invalid');
    return{git_mode:meta[0],path};
  });
  rows.sort((a,b)=>a.path.localeCompare(b.path));return rows;
}

export async function buildReproducibleRelease({outDir=resolve(repoRoot,'dist','release'),artifactName='fae-source-release-v1.json'}={}){
  const sourceCommit=git(['rev-parse','HEAD']).trim();
  const sourceDateEpoch=Number(git(['show','-s','--format=%ct','HEAD']).trim());
  if(!/^[0-9a-f]{40}$/.test(sourceCommit)||!Number.isSafeInteger(sourceDateEpoch)||sourceDateEpoch<=0)throw new Error('source_identity_invalid');
  const files=[];
  for(const entry of trackedEntries()){
    const bytes=await readFile(resolve(repoRoot,entry.path));
    files.push({path:entry.path,git_mode:entry.git_mode,bytes:bytes.length,sha256:sha256(bytes),content_base64:bytes.toString('base64')});
  }
  const configPath='sovereign-forge/release/release-candidate-config.json',config=files.find(file=>file.path===configPath);if(!config)throw new Error('release_config_not_tracked');
  const manifest={
    format:RELEASE_FORMAT,status:RELEASE_STATUS,source_commit:sourceCommit,source_date_epoch:sourceDateEpoch,
    required_runtime:'node>=22',file_count:files.length,config_path:configPath,config_sha256:config.sha256,
    files:files.map(({content_base64,...meta})=>meta)
  };
  const artifact={format:RELEASE_FORMAT,status:RELEASE_STATUS,manifest,files:files.map(({path,content_base64})=>({path,content_base64}))};
  const artifactBytes=Buffer.from(stable(artifact));const artifactSha256=sha256(artifactBytes);
  const manifestBytes=Buffer.from(stable(manifest));
  await mkdir(outDir,{recursive:true});const artifactPath=resolve(outDir,artifactName),manifestPath=resolve(outDir,'manifest.json'),checksumPath=resolve(outDir,`${artifactName}.sha256`);
  await writeFile(artifactPath,artifactBytes);await writeFile(manifestPath,manifestBytes);await writeFile(checksumPath,`${artifactSha256}  ${basename(artifactPath)}\n`);
  return{artifact_path:artifactPath,manifest_path:manifestPath,checksum_path:checksumPath,artifact_sha256:artifactSha256,manifest_sha256:sha256(manifestBytes),source_commit:sourceCommit,file_count:files.length};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const outIndex=process.argv.indexOf('--out');const outDir=outIndex>=0?resolve(process.argv[outIndex+1]):undefined;
  const nameIndex=process.argv.indexOf('--name');const artifactName=nameIndex>=0?process.argv[nameIndex+1]:undefined;
  const result=await buildReproducibleRelease({...(outDir?{outDir}:{}),...(artifactName?{artifactName}:{})});
  console.log(JSON.stringify({status:'PASS',...result}));
}
