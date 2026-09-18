import assert from 'node:assert/strict';
import {readdir,readFile,stat} from 'node:fs/promises';
import {join,relative,extname} from 'node:path';

const root=new URL('../',import.meta.url);
const rootPath=root.pathname;
const failures=[];
const notes=[];

function fail(message){failures.push(message)}
function note(message){notes.push(message)}

async function walk(dir){
  const out=[];
  for(const entry of await readdir(dir,{withFileTypes:true})){
    if(entry.name==='.git'||entry.name==='node_modules')continue;
    const path=join(dir,entry.name);
    if(entry.isDirectory())out.push(...await walk(path));
    else out.push(path);
  }
  return out;
}

function topLevelPermissions(content){
  const lines=content.split(/\r?\n/);
  const start=lines.findIndex(line=>/^permissions:/.test(line));
  if(start<0)return null;
  const first=lines[start].trim();
  if(first!=='permissions:')return first.slice('permissions:'.length).trim();
  const block=[];
  for(let i=start+1;i<lines.length;i++){
    const line=lines[i];
    if(!line.trim())continue;
    if(!/^\s/.test(line))break;
    block.push(line.trim());
  }
  return block.join('\n');
}

const workflowsDir=join(rootPath,'.github','workflows');
const workflowFiles=(await readdir(workflowsDir)).filter(name=>/\.ya?ml$/i.test(name)).sort();

for(const name of workflowFiles){
  const path=join(workflowsDir,name);
  const content=await readFile(path,'utf8');
  const permissions=topLevelPermissions(content);
  if(permissions===null)fail(name+': missing explicit top-level permissions');
  if(/write-all/i.test(String(permissions)))fail(name+': write-all is forbidden');
  if(/pull_request_target\s*:/m.test(content))fail(name+': pull_request_target is forbidden in the public-code baseline');
  if(/\bsecrets\.[A-Za-z0-9_]+/m.test(content))fail(name+': direct secrets.* reference requires explicit security review');

  const writes=[...String(permissions).matchAll(/^([a-z-]+):\s*write$/gmi)].map(m=>m[1]);
  const exactWriteAllowlist={
    'codeql.yml':['security-events'],
    'full-target-shadow-clock-health-wan.yml':['issues'],
    'full-target-shadow-free-real-wan.yml':['issues'],
    'peer-isolation-eclipse-real-wan.yml':['issues']
  };
  const allowedWrites=new Set(exactWriteAllowlist[name]??[]);
  for(const perm of writes)if(!allowedWrites.has(perm))fail(name+': unexpected write permission '+perm);
  for(const perm of allowedWrites)if(!writes.includes(perm))fail(name+': expected reviewed write permission missing '+perm);

  for(const match of content.matchAll(/\buses:\s*([^\s#]+)/g)){
    const ref=match[1];
    if(!ref.includes('@'))fail(name+': action without explicit ref '+ref);
    if(/@(main|master|latest)$/i.test(ref))fail(name+': floating action ref '+ref);
  }
}

const allFiles=await walk(rootPath);
const secretPatterns=[
  ['private-key-pem',/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['github-classic-token',/\bgh[pousr]_[A-Za-z0-9]{20,}\b/],
  ['github-fine-grained-token',/\bgithub_pat_[A-Za-z0-9_]{20,}\b/],
  ['aws-access-key',/\bAKIA[0-9A-Z]{16}\b/],
  ['stripe-live-secret',/\bsk_live_[A-Za-z0-9]{16,}\b/],
  ['slack-token',/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/]
];
const textExt=new Set(['.js','.mjs','.cjs','.ts','.tsx','.json','.md','.yml','.yaml','.txt','.toml','.go','.sh','.html','.css','.sql','.env','.example','']);
let scanned=0;
for(const path of allFiles){
  const rel=relative(rootPath,path).replaceAll('\\','/');
  if(rel==='tests/public-repo-hygiene.mjs')continue;
  const s=await stat(path);
  if(s.size>2_500_000)continue;
  if(!textExt.has(extname(path)))continue;
  let content;
  try{content=await readFile(path,'utf8')}catch{continue}
  if(content.includes('\u0000'))continue;
  scanned++;
  for(const [name,pattern] of secretPatterns){
    if(pattern.test(content))fail(rel+': high-signal secret pattern '+name);
  }
}

const nodePkg=JSON.parse(await readFile(join(rootPath,'sovereign-forge','node','package.json'),'utf8'));
assert.equal(nodePkg.license,'Apache-2.0','public node package license metadata must match repository license');

const dep=await readFile(join(rootPath,'.github','dependabot.yml'),'utf8');
for(const required of['package-ecosystem: "github-actions"','directory: "/sovereign-forge/node"','directory: "/lab/post-quantum-signatures"']){
  if(!dep.includes(required))fail('Dependabot missing '+required);
}

const codeql=await readFile(join(rootPath,'.github','workflows','codeql.yml'),'utf8');
for(const required of['github/codeql-action/init@v3','github/codeql-action/analyze@v3','languages: javascript-typescript']){
  if(!codeql.includes(required))fail('CodeQL workflow missing '+required);
}

if(failures.length){
  console.error(JSON.stringify({status:'FAIL',failures,workflow_count:workflowFiles.length,scanned_files:scanned},null,2));
  process.exit(1);
}

console.log(JSON.stringify({
  status:'PASS',
  workflow_count:workflowFiles.length,
  scanned_files:scanned,
  least_privilege_review:true,
  high_signal_secret_scan:true,
  dependabot_contract:true,
  codeql_contract:true,
  license_metadata:true,
  notes
}));
