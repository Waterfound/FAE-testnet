import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {checkMatrix,checkProposal,verifyExactSource,reviewPublicCopy} from './release-gate.mjs';
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
console.log(n+'/'+n+' candidate tests passed; Git source/object validation also covered');
