#!/usr/bin/env node
// Read-only candidate PR-diff invariant; not a security, custody, legal or release approval.
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

export const FROZEN_BASELINE='6d0c3956fdf72cd2e7543eee2539397ed5c0e699';
const WORKFLOW='.github/workflows/fae-lrp-001-candidate.yml';
const PREFIX='lab/legal-perimeter/';
const RUNS=new Set([
  'node lab/legal-perimeter/release-gate.test.mjs',
  'node lab/legal-perimeter/release-gate.mjs lab/legal-perimeter/perimeter.json lab/legal-perimeter/proposal.example.json',
  'node lab/legal-perimeter/candidate-boundary.test.mjs',
  'node lab/legal-perimeter/candidate-boundary.mjs',
  'node lab/legal-perimeter/source-to-runtime.test.mjs'
]);
const USES=new Set(['actions/checkout@v4','actions/setup-node@v4']);
function gitCmd(root,args){
  return execFileSync('git',['-C',root,...args],{encoding:'utf8',timeout:15000,maxBuffer:3000000,stdio:['ignore','pipe','pipe']}).trimEnd();
}
export function reviewWorkflow(text){
  if(typeof text!=='string')return ['workflow: unavailable'];
  const errors=[],s=text.replace(/\r/g,'');
  if(!/^on:\n  pull_request:\n    paths:\n      - 'lab\/legal-perimeter\/\*\*'\n      - '\.github\/workflows\/fae-lrp-001-candidate\.yml'/m.test(s))errors.push('workflow: PR paths not tightly scoped');
  if(!/^permissions:\n  contents: read$/m.test(s))errors.push('workflow: read-only token required');
  if(/^(?:schedule|push|workflow_dispatch|workflow_run|pull_request_target|repository_dispatch):/m.test(s)||/^ {2}(?:schedule|push|workflow_dispatch|workflow_run|pull_request_target|repository_dispatch):/m.test(s))errors.push('workflow: forbidden trigger');
  if(/^\s*(?:secrets|environment):/m.test(s)||/^\s*[^#\n]*\b(?:write-all|contents:\s*write|pull-requests:\s*write)\b/m.test(s))errors.push('workflow: forbidden privilege');
  const runs=[...s.matchAll(/^\s+-?\s*run:\s*(.+)$/gm)].map(m=>m[1].trim());
  const uses=[...s.matchAll(/^\s+-?\s*uses:\s*(.+)$/gm)].map(m=>m[1].trim());
  for(const c of RUNS)if(!runs.includes(c))errors.push('workflow: missing expected run '+c);
  for(const c of runs)if(!RUNS.has(c))errors.push('workflow: extra command '+c);
  for(const c of uses)if(!USES.has(c))errors.push('workflow: unreviewed action '+c);
  if(uses.length!==2)errors.push('workflow: unexpected action count');
  if(!/^\s+fetch-depth: 0$/m.test(s)||!/^\s+ref: \$\{\{ github\.event\.pull_request\.head\.sha \}\}$/m.test(s)||!/^\s+persist-credentials: false$/m.test(s))errors.push('workflow: exact PR SHA and full history required');
  return [...new Set(errors)];
}
export function reviewDiff(raw){
  const files=[],errors=[];
  if(typeof raw!=='string'||!raw.trim())return {files,errors:['diff: no candidate change evidence']};
  for(const line of raw.trim().split('\n')){
    const match=/^([A-Z][0-9]*?)\t(.+)$/.exec(line);
    if(!match){errors.push('diff: invalid name-status');continue}
    const [,status,path]=match;files.push(path);
    if(status!=='A'&&status!=='M')errors.push('diff: delete, rename, or type change '+path);
    if(path===WORKFLOW)continue;
    if(!path.startsWith(PREFIX)||!/^lab\/legal-perimeter\/[A-Za-z0-9_./-]+$/.test(path)||path.split('/').includes('..'))errors.push('diff: out-of-owner modification '+path);
  }
  return {files,errors:[...new Set(errors)]};
}
export function verifyCandidateBoundary(root=process.cwd(),{baseline=FROZEN_BASELINE,expectedBaseline=FROZEN_BASELINE,head='HEAD',git=gitCmd}={}){
  const errors=[];let currentHead=null,files=[];
  if(baseline!==expectedBaseline||!/^[0-9a-f]{40}$/.test(baseline))errors.push('baseline: wrong or unverified reference');
  try{currentHead=git(root,['rev-parse',head]);if(!/^[0-9a-f]{40}$/.test(currentHead))throw Error('invalid head')}catch{errors.push('head: unavailable')}
  try{if(git(root,['rev-parse',baseline])!==baseline)errors.push('baseline: object mismatch')}catch{errors.push('baseline: unavailable')}
  try{git(root,['merge-base','--is-ancestor',baseline,head])}catch{errors.push('ancestry: baseline not ancestor')}
  try{const found=reviewDiff(git(root,['diff','--name-status','--no-renames',baseline,head]));files=found.files;errors.push(...found.errors)}catch{errors.push('diff: unavailable')}
  try{errors.push(...reviewWorkflow(git(root,['show',head+':'+WORKFLOW])))}catch{errors.push('workflow: unavailable at head')}
  return {baseline,head:currentHead,changed_files:files,errors:[...new Set(errors)]};
}
const self=process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href;
if(self){
  const r=verifyCandidateBoundary();
  console.log(JSON.stringify({verdict:r.errors.length?'REJECT':'CANDIDATE_DIFF_SCOPE_PASS_NOT_RELEASE_AUTHORITY',...r},null,2));
  if(r.errors.length)process.exitCode=1;
}