#!/usr/bin/env node
import {readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {prepareStaging} from '../representative-device-evidence-readiness/prepare-staging.mjs';
import {collectEvidence} from '../representative-device-evidence-readiness/collect-evidence.mjs';
import {verifyEvidenceBundle} from '../representative-device-evidence-readiness/verify-evidence.mjs';
import {verifyPortfolio} from '../representative-device-evidence-readiness/verify-portfolio.mjs';
import {TESTED_SOURCE_REVISION} from './autopilot-core.mjs';

const args=Object.fromEntries(process.argv.slice(2).map((v,i,a)=>v.startsWith('--')?[v.slice(2),a[i+1]&&!a[i+1].startsWith('--')?a[i+1]:true]:null).filter(Boolean));
if(!args.file||!args.out){console.error('usage: import-browser-portfolio.mjs --file <browser-export.json> --out <directory>');process.exit(2)}
const payload=JSON.parse(await readFile(resolve(args.file),'utf8'));
if(payload.schema!=='FAE_RDE_BROWSER_PORTFOLIO_V1'||!Array.isArray(payload.captures))throw new Error('unsupported_browser_portfolio');
const out=resolve(args.out);await mkdir(out,{recursive:true});const results=[];
for(const [i,capture] of payload.captures.entries()){
  const id=String(capture?.run?.run_id||('capture-'+i)).replace(/[^a-zA-Z0-9._-]/g,'_');
  const root=join(out,id),capturePath=join(root,'capture.json'),staging=join(root,'staging'),bundle=join(out,'bundles',id);
  await mkdir(root,{recursive:true});await mkdir(join(out,'bundles'),{recursive:true});
  await writeFile(capturePath,JSON.stringify(capture,null,2));await rm(staging,{recursive:true,force:true});await rm(bundle,{recursive:true,force:true});
  await prepareStaging({capturePath,outDir:staging});await collectEvidence({inputDir:staging,outDir:bundle});
  const verification=await verifyEvidenceBundle(bundle,{expectedSourceRevision:TESTED_SOURCE_REVISION,expectedEvidenceClass:capture.run.evidence_class});
  results.push({run_id:id,verdict:verification.verdict,errors:verification.errors});
}
let portfolio=null;
if(payload.captures.length&&payload.captures.every(x=>x.run?.evidence_class===payload.captures[0].run?.evidence_class)){
  try{portfolio=await verifyPortfolio(join(out,'bundles'),{expectedSourceRevision:TESTED_SOURCE_REVISION,expectedEvidenceClass:payload.captures[0].run.evidence_class})}catch(error){portfolio={verdict:'INCOMPLETE',error:String(error.message||error)}}
}
const summary={schema:'FAE_RDE_BROWSER_IMPORT_RESULT_V1',capture_count:payload.captures.length,results,portfolio};
await writeFile(join(out,'import-summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
if(results.some(x=>x.verdict!=='PASS'))process.exitCode=1;
