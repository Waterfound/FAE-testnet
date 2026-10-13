import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {checkMatrix,checkProposal,verifyExactSource,reviewPublicCopy,runCandidateReview} from './release-gate.mjs';
const m=JSON.parse(readFileSync(new URL('./perimeter.json',import.meta.url)));
const base={baseline_commit:m.baseline_commit,release_kind:'docs_testnet_candidate',claims:['local_signing','testnet_issuance_parameters'],public_copy:'FAE public testnet. Test coins have no monetary value.'};
let n=0;const test=(label,fn)=>{fn();n++;console.log('PASS '+label)};
test('matrix schema and full refs',()=>assert.deepEqual(checkMatrix(m),[]));
test('document-only exact pinned subset passes',()=>assert.deepEqual(checkProposal(m,base),[]));
test('wrong SHA fails closed',()=>assert.ok(checkProposal(m,{...base,baseline_commit:'0'.repeat(40)}).length));
test('mainnet request fails',()=>assert.ok(checkProposal(m,{...base,request_mainnet:true}).length));
test('commercial release kind fails',()=>assert.ok(checkProposal(m,{...base,release_kind:'commercial'}).length));
test('encrypted-at-rest claim fails',()=>assert.ok(checkProposal(m,{...base,claims:['encrypted_at_rest']}).length));
test('absolute noncustody claim fails',()=>assert.ok(checkProposal(m,{...base,claims:['absolute_non_custody']}).length));
test('PPLNS active claim fails',()=>assert.ok(checkProposal(m,{...base,claims:['pplns_active']}).length));
test('regulator approved claim fails',()=>assert.ok(checkProposal(m,{...base,claims:['approved_by_bcb']}).length));
test('guaranteed revenue phrase PT fails',()=>assert.ok(checkProposal(m,{...base,public_copy:'Renda garantida para mineradores'}).length));
test('risk-free EN fails',()=>assert.ok(checkProposal(m,{...base,public_copy:'A risk-free asset'}).length));
test('no undocumented arbitrary claims',()=>assert.ok(checkProposal(m,{...base,claims:['fair_price']} ).length));
test('empty text given explicitly accepted',()=>assert.deepEqual(checkProposal(m,{...base,public_copy:''}),[]));
test('false verified row without source rejected',()=>{const altered=structuredClone(m);altered.features[0].technical_evidence.blob_sha=null;assert.ok(checkMatrix(altered).length)});

const sourceMap=new Map(m.features.filter(f=>f.technical_evidence?.verified).map(f=>[f.technical_evidence.path,f]));
const fakeGit=(rev,path)=>{
  if(rev!==m.baseline_commit)throw Error('wrong revision');
  if(path==='README.md')return{blob:m.public_surfaces.find(s=>s.path===path).blob_sha,content:'FAE public testnet. Testnet FAE has no monetary value.'};
  if(path==='index.html')return{blob:m.public_surfaces.find(s=>s.path===path).blob_sha,content:sourceMap.get(path).technical_evidence.source_assertions.map(a=>a.text).join('\n')};
  if(path==='explorer/index.html')return{blob:m.public_surfaces.find(s=>s.path===path).blob_sha,content:'Explorer public testnet. Blocks, transactions, addresses and network status.'};
  const dynamic=m.dynamic_public_surfaces.find(s=>s.path===path);
  if(dynamic)return{blob:dynamic.blob_sha,content:'Dynamic UI data requires rendered verification'};
  const f=sourceMap.get(path);if(!f)throw Error('not found');
  return{blob:f.technical_evidence.blob_sha,content:f.technical_evidence.source_assertions.map(a=>a.text).join('\n')};
};
test('source + public surfaces grounded fixture',()=>assert.deepEqual(verifyExactSource(m,'.',fakeGit),[]));
test('fake source blob rejection',()=>{
 const x=verifyExactSource(m,'.',(rev,path)=>{const r=fakeGit(rev,path);return path==='LICENSE'?{...r,blob:'0'.repeat(40)}:r});
 assert.match(x.join('|'),/blob drift F01/);
});
test('fake wallet source content rejection',()=>{
 const x=verifyExactSource(m,'.',(rev,path)=>{const r=fakeGit(rev,path);return path==='wallet-crypto.js'?{...r,content:'remote signing? no evidence'}:r});
 assert.match(x.join('|'),/missing predicate F03/);
});
test('unavailable git object fails closed',()=>{
 const x=verifyExactSource(m,'.',(rev,path)=>{if(path==='LICENSE')throw Error('missing');return fakeGit(rev,path)});
 assert.match(x.join('|'),/source: unavailable F01/);
});
test('tampered README Git blob fails closed',()=>{
 const x=verifyExactSource(m,'.',(rev,path)=>{const r=fakeGit(rev,path);return path==='README.md'?{...r,blob:'0'.repeat(40)}:r});
 assert.match(x.join('|'),/public: blob drift README/);
});
test('actual public copy risk in README rejected',()=>{
 const x=verifyExactSource(m,'.',(rev,path)=>{const r=fakeGit(rev,path);return path==='README.md'?{...r,content:'Guaranteed profits!'}:r});
 assert.match(x.join('|'),/financial promise/);
});
test('positive guaranteed income detected',()=>assert.ok(reviewPublicCopy('Renda garantida.').length));
test('false positive negated promise fixed',()=>assert.deepEqual(reviewPublicCopy('Não existe renda garantida. No guaranteed returns.'),[]));
test('false positive negated risk fixed',()=>assert.deepEqual(reviewPublicCopy('Mining is not risk-free.'),[]));
test('no generic financial word blocking',()=>assert.deepEqual(reviewPublicCopy('Risk and return remain uncertain.'),[]));
test('disclaimer cannot excuse positive guarantee',()=>assert.ok(reviewPublicCopy('Mining is risky. Guaranteed profits!').length));
test('unverified mainnet live claim detected',()=>assert.ok(reviewPublicCopy('Mainnet is live.').length));
test('unverified wallet encrypted claim detected',()=>assert.ok(reviewPublicCopy('Wallet keys are encrypted.').length));
test('unverified pool active claim detected',()=>assert.ok(reviewPublicCopy('PPLNS pool active.').length));
test('unverified ASIC claim detected',()=>assert.ok(reviewPublicCopy('Fully ASIC-resistant.').length));
test('unrelated commentary not blocked',()=>assert.deepEqual(reviewPublicCopy('Potential classification of hosted transaction relays requires review.'),[]));
test('source anchored guard on exact fetched canonical Git objects',()=>assert.deepEqual(verifyExactSource(m,process.cwd()),[]));
test('matrix status cannot self-certify encrypted-at-rest',()=>{const altered=structuredClone(m);altered.features.find(f=>f.id==='F04').status='TECHNICAL_PROPERTY_VERIFIED';assert.ok(checkProposal(altered,{...base,claims:['encrypted_at_rest']}).length)});
test('technical matrix cannot self-change reviewed baseline commit',()=>{const altered=structuredClone(m);altered.baseline_commit='0'.repeat(40);assert.ok(checkMatrix(altered).length)});
test('executable review requires source proof, even for valid proposal',()=>assert.deepEqual(runCandidateReview(m,base,'.',fakeGit),[]));
test('executable review rejects proof tampering even when metadata and claims pass',()=>{
  assert.deepEqual(checkProposal(m,base),[]);
  const errors=runCandidateReview(m,base,'.',(sha,path)=>{
    const x=fakeGit(sha,path);return path==='wallet-crypto.js'?{...x,blob:'f'.repeat(40)}:x;
  });
  assert.match(errors.join('|'),/blob drift F03/);
});
test('missing claims array fails closed',()=>assert.match(checkProposal(m,{...base,claims:undefined}).join('|'),/claims must be explicit array/));
test('missing and non-string public copy fail closed',()=>{
  assert.match(checkProposal(m,{...base,public_copy:null}).join('|'),/public_copy must be supplied as text/);
  assert.match(checkProposal(m,{...base,public_copy:undefined}).join('|'),/public_copy must be supplied as text/);
});
test('candidate authority escalation fails',()=>{
  const x=structuredClone(m);x.authority='MAY_APPROVE_MAINNET';assert.match(checkMatrix(x).join('|'),/authority escalation/);
});
test('markdown promotion heading cannot bypass financial promise review',()=>assert.match(reviewPublicCopy('# Guaranteed returns!').join('|'),/financial promise/));
test('markdown informational heading remains permitted',()=>assert.deepEqual(reviewPublicCopy('## Mining documentation: risks and uncertainties'),[]));
test('Markdown emphasis must not conceal a guaranteed return',()=>assert.match(reviewPublicCopy('Earn **guaranteed** returns.').join('|'),/financial promise/));
test('Markdown split tokens must not conceal a guaranteed return',()=>assert.match(reviewPublicCopy('**Guaranteed** **profits**.').join('|'),/financial promise/));
test('qualified technical description still allowed',()=>assert.deepEqual(reviewPublicCopy('Mining has no guaranteed returns.'),[]));
test('unsupported unconditional legal conformity copy rejected',()=>assert.match(reviewPublicCopy('We are fully compliant with all crypto regulations.').join('|'),/legal conformity claim/));
test('Portuguese regulatory guarantee rejected',()=>assert.match(reviewPublicCopy('Oferecemos conformidade regulatória garantida.').join('|'),/legal conformity claim/));
test('explicit denial of legal certification remains allowed',()=>assert.deepEqual(reviewPublicCopy('We are not fully compliant. Independent legal review is required.'),[]));
test('HTML split guarantee cannot bypass copy guard',()=>assert.match(reviewPublicCopy('Guaranteed <strong>returns</strong>').join('|'),/financial promise/));
test('accessible aria-label promise is inspected',()=>assert.match(reviewPublicCopy('<button aria-label="Guaranteed profits">Mine</button>').join('|'),/financial promise/));
test('HTML entity can no longer split guarantee',()=>assert.match(reviewPublicCopy('<p>Guar&#97;nteed profits</p>').join('|'),/financial promise/));
test('promotional Markdown blockquote is not a bypass',()=>assert.match(reviewPublicCopy('> Guaranteed returns').join('|'),/financial promise/));
test('negated HTML claim is permitted',()=>assert.deepEqual(reviewPublicCopy('<p>Mining is not <strong>risk-free</strong>.</p>'),[]));
test('neutral accessibility label is permitted',()=>assert.deepEqual(reviewPublicCopy('<button aria-label="Start mining">Start</button>'),[]));
test('public marketing template requires rendered proof',()=>assert.match(reviewPublicCopy('Earn '+String.fromCharCode(36,123)+'dynamic} returns').join('|'),/dynamic interpolation/));
test('HTML risk text remains permitted',()=>assert.deepEqual(reviewPublicCopy('<p>Mining involves risk and no guaranteed returns.</p>'),[]));
test('Explorer static source included as pinned public surface',()=>assert.ok(m.public_surfaces.some(x=>x.path==='explorer/index.html')));
test('Explorer static false financial copy rejected',()=>{
  const errors=verifyExactSource(m,'.',(rev,path)=>{const x=fakeGit(rev,path);return path==='explorer/index.html'?{...x,content:'Guaranteed profits from every block!'}:x});
  assert.match(errors.join('|'),/public: explorer\/index.html .*financial promise/);
});
test('removing Explorer inventory cannot self-certify coverage',()=>{
  const x=structuredClone(m);x.public_surfaces=x.public_surfaces.filter(v=>v.path!=='explorer/index.html');
  assert.match(checkMatrix(x).join('|'),/incomplete\/invalid static source inventory/);
});
test('dynamic wallet runtime coverage cannot self-promote',()=>{
  const x=structuredClone(m);x.dynamic_public_surfaces.find(v=>v.path==='wallet.js').coverage='RUNTIME_RENDERED_VERIFIED';
  assert.match(checkMatrix(x).join('|'),/incomplete\/invalid dynamic coverage inventory/);
});
test('dynamic Explorer script blob drift rejects proof',()=>{
  const errors=verifyExactSource(m,'.',(rev,path)=>{const x=fakeGit(rev,path);return path==='explorer/app.mjs'?{...x,blob:'0'.repeat(40)}:x});
  assert.match(errors.join('|'),/public: dynamic source blob drift explorer\/app.mjs/);
});
test('wrong CVM 40 link rejected even with official domain',()=>{
  const x=structuredClone(m);x.norms.CVM40='https://conteudo.cvm.gov.br/legislacao/pareceres-orientacao/pare035.html';
  assert.match(checkMatrix(x).join('|'),/CVM40: source identity/);
});
console.log(n+'/'+n+' candidate tests passed; Git source/object validation also covered');
