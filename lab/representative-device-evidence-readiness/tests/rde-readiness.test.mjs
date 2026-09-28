import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,cp,unlink,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {contract,readJson,writeJson,digestFile,manifestPayloadHash,stableEntries} from '../lib.mjs';
import {createRehearsalPortfolio} from '../run-rehearsal.mjs';
import {verifyEvidenceBundle} from '../verify-evidence.mjs';
import {verifyPortfolio} from '../verify-portfolio.mjs';

async function rewriteManifest(dir){
  const run=await readJson(join(dir,'run.json'));
  const files=[];
  for(const rel of contract.required_bundle_files.filter(x=>x!=='manifest.json')){
    const d=await digestFile(join(dir,rel));files.push({path:rel,...d});
  }
  const entries=stableEntries(files);
  await writeJson(join(dir,'manifest.json'),{schema:'FAE_RDE_EVIDENCE_MANIFEST_V1',contract_id:contract.contract_id,run_id:run.run_id,files:entries,manifest_payload_sha256:manifestPayloadHash(entries)});
}
async function clone(base,parent,name){const d=join(parent,name);await cp(base,d,{recursive:true});return d}
async function mutateJson(dir,rel,fn,rewrite=true){const p=join(dir,rel),v=await readJson(p);fn(v);await writeJson(p,v);if(rewrite)await rewriteManifest(dir)}
async function verify(dir,extra={}){return verifyEvidenceBundle(dir,{expectedSourceRevision:contract.source_binding.baseline_source_revision,expectedEvidenceClass:'REHEARSAL_ONLY',...extra})}

test('RDE rehearsal exercises all required classes without admitting physical evidence',async()=>{
  const parent=await mkdtemp(join(tmpdir(),'fae-rde-rehearsal-')),portfolio=join(parent,'portfolio');
  try{
    const r=await createRehearsalPortfolio(portfolio);
    assert.equal(r.verdict,'READINESS_REHEARSAL_ONLY');
    assert.equal(r.physical_portfolio_structurally_admissible,false);
    assert.equal(r.final_evidence_admission,false);
    assert.equal(r.required_classes.length,4);
    assert.ok(r.run_count>=26);
  }finally{await rm(parent,{recursive:true,force:true})}
});

test('RDE run verifier fails closed against false-PASS mutations',async()=>{
  const parent=await mkdtemp(join(tmpdir(),'fae-rde-adversarial-')),portfolio=join(parent,'portfolio');
  try{
    await createRehearsalPortfolio(portfolio);
    const base=join(portfolio,'run-00');
    assert.equal((await verify(base)).verdict,'PASS');

    const missing=await clone(base,parent,'missing-measurements');await unlink(join(missing,'measurements.json'));
    assert.equal((await verify(missing)).verdict,'INCOMPLETE');

    const altered=await clone(base,parent,'altered-device');
    await mutateJson(altered,'device.json',v=>{v.model='Post-hoc altered model'},false);
    assert.equal((await verify(altered)).verdict,'INVALID_PROVENANCE');

    const forged=await clone(base,parent,'forged-source');
    await mutateJson(forged,'source-provenance.json',v=>{v.source_revision='a'.repeat(40)});
    assert.equal((await verify(forged)).verdict,'INVALID_PROVENANCE');

    const impossible=await clone(base,parent,'impossible-time');
    await mutateJson(impossible,'run.json',v=>{v.ended_at='2026-09-28T11:00:00.000Z'});
    assert.notEqual((await verify(impossible)).verdict,'PASS');

    const lowEnergy=await clone(base,parent,'low-energy');
    await mutateJson(lowEnergy,'energy.json',v=>{v.average_power_w=0.001;v.energy_wh=0.001*Number(v.measured_seconds)/3600});
    assert.notEqual((await verify(lowEnergy)).verdict,'PASS');

    const wrongNetwork=await clone(base,parent,'wrong-network');
    await mutateJson(wrongNetwork,'source-provenance.json',v=>{v.network='wrong-network'});
    assert.equal((await verify(wrongNetwork)).verdict,'INVALID_PROVENANCE');

    const editedManifest=await clone(base,parent,'edited-manifest');
    const man=await readJson(join(editedManifest,'manifest.json'));man.files[0].sha256='0'.repeat(64);await writeJson(join(editedManifest,'manifest.json'),man);
    assert.equal((await verify(editedManifest)).verdict,'INVALID_PROVENANCE');

    const truncated=await clone(base,parent,'truncated-log');
    await import('node:fs/promises').then(fs=>fs.writeFile(join(truncated,'logs/miner.log'),'x\n'));await rewriteManifest(truncated);
    assert.notEqual((await verify(truncated)).verdict,'PASS');

    const unsupported=await clone(base,parent,'unsupported-class');
    await mutateJson(unsupported,'device.json',v=>{v.device_class='favorite_device_after_results'},false);
    await mutateJson(unsupported,'selection-lock.json',v=>{v.device_class='favorite_device_after_results'},false);
    await mutateJson(unsupported,'environment.json',v=>{v.device_class='favorite_device_after_results'},false);
    await mutateJson(unsupported,'workload.json',v=>{v.device_class='favorite_device_after_results'});
    assert.equal((await verify(unsupported)).verdict,'UNSUPPORTED_DEVICE_CLASS');

    const promoted=await clone(base,parent,'rehearsal-promoted');
    await mutateJson(promoted,'run.json',v=>{v.evidence_class='PHYSICAL_EVIDENCE'});
    assert.notEqual((await verify(promoted,{expectedEvidenceClass:undefined})).verdict,'PASS');

    const historical=await clone(base,parent,'historical-as-new');
    await mutateJson(historical,'run.json',v=>{v.evidence_class='HISTORICAL_REFERENCE';v.claimed_as_new_physical=true});
    assert.notEqual((await verify(historical,{expectedEvidenceClass:undefined})).verdict,'PASS');

    const contaminated=await clone(base,parent,'contaminated');
    await mutateJson(contaminated,'system-events.json',v=>{v.contamination_detected=true});
    assert.equal((await verify(contaminated)).verdict,'CONTAMINATED_RUN');

    const duplicateEvent=await clone(base,parent,'duplicate-event');
    await mutateJson(duplicateEvent,'miner-events.json',v=>{v.events[1].event_id=v.events[0].event_id});
    assert.notEqual((await verify(duplicateEvent)).verdict,'PASS');

    const noWarmup=await clone(base,parent,'physical-no-warmup');
    await mutateJson(noWarmup,'run.json',v=>{v.evidence_class='PHYSICAL_EVIDENCE';v.synthetic=false;v.rehearsal_scaled=false},false);
    await mutateJson(noWarmup,'operator-attestation.json',v=>{v.physical_run_performed=true;v.synthetic_data_used=false;v.test_fixture=false},false);
    await mutateJson(noWarmup,'integrity.json',v=>{v.evidence_class='PHYSICAL_EVIDENCE';v.collection_mode='PHYSICAL_CAPTURE_IMPORT'},false);
    await rewriteManifest(noWarmup);
    const warm=await verifyEvidenceBundle(noWarmup,{expectedSourceRevision:contract.source_binding.baseline_source_revision,expectedEvidenceClass:'PHYSICAL_EVIDENCE'});
    assert.notEqual(warm.verdict,'PASS');
    assert.ok(warm.errors.includes('insufficient_warmup'));
  }finally{await rm(parent,{recursive:true,force:true})}
});

test('RDE portfolio verifier rejects duplicated run identity',async()=>{
  const parent=await mkdtemp(join(tmpdir(),'fae-rde-duplicate-')),portfolio=join(parent,'portfolio');
  try{
    await createRehearsalPortfolio(portfolio);
    const a=await readJson(join(portfolio,'run-00','run.json'));
    await mutateJson(join(portfolio,'run-01'),'run.json',v=>{v.run_id=a.run_id},false);
    await mutateJson(join(portfolio,'run-01'),'operator-attestation.json',v=>{v.run_id=a.run_id},false);
    await mutateJson(join(portfolio,'run-01'),'integrity.json',v=>{v.run_id=a.run_id},false);
    await rewriteManifest(join(portfolio,'run-01'));
    const r=await verifyPortfolio(portfolio,{expectedSourceRevision:contract.source_binding.baseline_source_revision,expectedEvidenceClass:'REHEARSAL_ONLY'});
    assert.equal(r.verdict,'INSUFFICIENT_REPRESENTATIVE_DEVICE_EVIDENCE');
    assert.ok(r.errors.some(x=>x.startsWith('duplicate_run_id:')));
  }finally{await rm(parent,{recursive:true,force:true})}
});
