#!/usr/bin/env node
// Candidate-only fail-closed review tool. NOT a governmental/legal compliance checker.
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const officialSourcePaths=new Set(['README.md','index.html']);
const FROZEN_BASELINE='6d0c3956fdf72cd2e7543eee2539397ed5c0e699';
const FROZEN_UNVERIFIED_CLAIMS=new Set(['encrypted_at_rest','absolute_non_custody','pplns_active']);
const STATUSES=new Set(['TECHNICAL_PROPERTY_VERIFIED','NO_TRIGGER_IDENTIFIED_IN_REVIEWED_SCOPE','POTENTIAL_TRIGGER','LEGAL_INTERPRETATION_REQUIRED','TECHNICAL_REPAIR_REQUIRED','EXTERNAL_AUTHORITY_GATE','INSUFFICIENT_EVIDENCE']);
export function checkMatrix(matrix){
  const errors=[];
  if(matrix?.schema!=='FAE_LRP_001_PERIMETER_V2'||matrix?.baseline_commit!==FROZEN_BASELINE||!/^([a-f0-9]{40})$/.test(matrix?.baseline_commit||''))errors.push('invalid matrix schema/baseline');
  if(matrix?.authority!=='PASSIVE_CANDIDATE_ONLY_NO_MAINNET_OR_COMMERCIAL_RELEASE')errors.push('matrix authority escalation');
  if(!Array.isArray(matrix?.features)||!matrix.features.length)errors.push('missing matrix features');
  const ids=new Set();
  for(const row of matrix?.features||[]){
    if(!row?.id||ids.has(row.id))errors.push('duplicate/missing feature id: '+row?.id);
    ids.add(row.id);
    if(!STATUSES.has(row.status))errors.push('unknown status: '+row.id);
    for(const key of ['feature','class','possible_legal_trigger','risk_uncertainty','preventive_control','owner','release_disposition'])if(typeof row[key]!=='string'||!row[key].trim())errors.push('missing '+key+': '+row.id);
    if(!row.technical_evidence?.path||typeof row.technical_evidence?.verified!=='boolean')errors.push('missing technical evidence: '+row.id);
    if(row.technical_evidence?.verified&&(!/^[a-f0-9]{40}$/.test(row.technical_evidence.blob_sha||'')||!Array.isArray(row.technical_evidence.source_assertions)||!row.technical_evidence.source_assertions.length))errors.push('verified evidence missing git blob SHA: '+row.id);
    if(!Array.isArray(row.primary_source)||!row.primary_source.length||row.primary_source.some(k=>{try{const u=new URL(matrix.norms?.[k]);return u.protocol!=='https:'||!['www.bcb.gov.br','www.planalto.gov.br','www.gov.br','conteudo.cvm.gov.br'].includes(u.hostname)}catch{return true}}))errors.push('missing official source: '+row.id);
  }
  return errors;
}
const CLAIM_FEATURES={'local_signing':'F03','encrypted_at_rest':'F04','absolute_non_custody':'F05','testnet_issuance_parameters':'F07','pplns_active':'F08'};
export function checkProposal(matrix,proposal){
  const errors=checkMatrix(matrix);
  if(!proposal||typeof proposal!=='object')return [...errors,'missing proposal'];
  if(proposal.baseline_commit!==matrix.baseline_commit)errors.push('proposal not pinned to reviewed commit');
  if(proposal.release_kind!=='docs_testnet_candidate')errors.push('mainnet, production, paid and commercial release not authorized by LRP-001');
  if(proposal.request_mainnet||proposal.request_commercial||proposal.actual_activation)errors.push('activation request outside LRP-001 authority');
  if(!Array.isArray(proposal.claims))errors.push('claims must be explicit array');
  const features=new Map((matrix.features||[]).map(f=>[f.id,f]));
  for(const c of proposal.claims||[]){
    if(typeof c!=='string') {errors.push('invalid claim');continue}
    if(FROZEN_UNVERIFIED_CLAIMS.has(c)){errors.push('candidate baseline cannot self-certify unverified property: '+c);continue}
    if(['regulatory_compliant','approved_by_bcb','approved_by_cvm','guaranteed_returns','risk_free','premine_fully_audited'].includes(c)){errors.push('prohibited/unproven absolute claim: '+c);continue}
    if(!Object.hasOwn(CLAIM_FEATURES,c)){errors.push('unrecognized claim: '+c);continue}
    const f=features.get(CLAIM_FEATURES[c]);
    if(!f?.technical_evidence.verified||f.status!=='TECHNICAL_PROPERTY_VERIFIED')errors.push('claim not exact-head independently verified: '+c);
    if(c==='pplns_active')errors.push('pplns is not activated in reviewed baseline');
  }
  if(typeof proposal.public_copy==='string')errors.push(...reviewPublicCopy(proposal.public_copy));
  else errors.push('public_copy must be supplied as text for review');
  return [...new Set(errors)];
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  if(process.argv.length!==4){console.error('Usage: node release-gate.mjs perimeter.json proposal.json');process.exitCode=2}
  else {const m=JSON.parse(readFileSync(process.argv[2],'utf8')),p=JSON.parse(readFileSync(process.argv[3],'utf8')),errors=runCandidateReview(m,p,process.cwd());console.log(JSON.stringify({verdict:errors.length?'REJECT':'CANDIDATE_REVIEW_PASS_NOT_RELEASE_AUTHORITY',errors,baseline_commit:m.baseline_commit},null,2));if(errors.length)process.exitCode=1}
}

export function reviewPublicCopy(copy){
  const errors=[];
  for(const clause of String(copy).normalize('NFKC').replace(/[\u200b-\u200d\ufeff]/g,'').replace(/[*_`~]+/g,'').toLowerCase().split(/[.!?;\n]+/)){
    if(!clause.trim()||/^\s*(?:>|\/\/)/.test(clause))continue;
    const pats=[
      ['financial promise',/\b(?:guaranteed\s+(?:profits?|returns?|yield)|risk[- ]free|fixed\s+yield|profits?\s+(?:are\s+)?guaranteed|lucros?\s+garantidos?|retornos?\s+garantidos?|rendas?\s+garantidas?|rentabilidades?\s+garantidas?|sem\s+risco|risco\s+zero|garantimos\s+(?:lucro|renda|retorno|rentabilidade))\b/u],
      ['regulator approval',/\b(?:approved\s+by\s+(?:the\s+)?(?:cvm|bcb)|(?:cvm|bcb)\s+approved|aprovad[ao]s?\s+pel[ao]\s+cvm|autorizad[ao]s?\s+pel[ao]\s+banco\s+central)\b/u],
      ['unsupported feature activation',/\b(?:mainnet\s+(?:is\s+)?(?:live|launched|ready)|(?:asic[- ]proof|fully\s+asic[- ]resistant)|(?:wallet\s+(?:keys?\s+)?(?:is|are)\s+encrypted)|(?:pplns\s+pool\s+(?:is\s+)?active))\b/u]
    ];
    for(const [label,re] of pats){
      const hit=re.exec(clause);if(!hit)continue;
      const prefix=clause.slice(Math.max(0,hit.index-26),hit.index);
      if(/(?:\bnot\s+|\bno\s+|\bnão\s+(?:existe\s+|há\s+|oferecemos\s+)?|\bnunca\s+|\bjamais\s+)$/u.test(prefix))continue;
      errors.push('public_copy: unsupported '+label);
    }
  }
  return [...new Set(errors)];
}
export function verifyExactSource(matrix,root,reader){
  let errors=checkMatrix(matrix);
  if(errors.length)return errors;
  const gitReader=reader||((sha,path)=>{
    if(!/^[0-9a-f]{40}$/.test(sha)||!/^[-\w./]+$/.test(path)||path.startsWith('/')||path.split('/').includes('..'))throw Error('unsafe object');
    const options={encoding:'utf8',timeout:10000,maxBuffer:3000000,stdio:['ignore','pipe','pipe']};
    return {blob:execFileSync('git',['-C',root,'rev-parse',sha+':'+path],options).trim(),content:execFileSync('git',['-C',root,'show',sha+':'+path],options)};
  });
  for(const row of matrix.features){
    const t=row.technical_evidence;if(!t.verified)continue;
    try{
      const source=gitReader(matrix.baseline_commit,t.path);
      if(source.blob!==t.blob_sha)errors.push('source: blob drift '+row.id);
      for(const assertion of t.source_assertions)if(assertion.kind!=='contains'||!source.content.includes(assertion.text))errors.push('source: missing predicate '+row.id);
    }catch{errors.push('source: unavailable '+row.id)}
  }
  if(!Array.isArray(matrix.public_surfaces)||matrix.public_surfaces.length!==2)errors.push('public: missing source surfaces');
  for(const surface of matrix.public_surfaces||[]){
    if(!officialSourcePaths.has(surface.path))errors.push('public: unreviewed path');
    try{
      const source=gitReader(matrix.baseline_commit,surface.path);
      if(source.blob!==surface.blob_sha)errors.push('public: blob drift '+surface.path);
      errors.push(...reviewPublicCopy(source.content).map(x=>'public: '+surface.path+' '+x));
    }catch{errors.push('public: unavailable '+surface.path)}
  }
  return [...new Set(errors)];
}

// The CLI must enforce source proof, not just review matrix assertions.
export function runCandidateReview(matrix,proposal,root,reader){
  return [...new Set([...checkProposal(matrix,proposal),...verifyExactSource(matrix,root,reader)])];
}
