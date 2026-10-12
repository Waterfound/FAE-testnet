import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {cp,mkdir,mkdtemp,readFile,rm,unlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {generateNodeIdentity,signEnvelope} from '../../../sovereign-forge/node/authoritative/node-identity.mjs';
import {verifyEvidenceBundle} from '../verify-evidence.mjs';

const here=fileURLToPath(new URL('..',import.meta.url));
const contract=JSON.parse(await readFile(resolve(here,'acceptance-contract.json'),'utf8'));
const sourceRevision='a'.repeat(40),sourceTree='b'.repeat(40),challenge='c'.repeat(64),operatorId='SIMULATED-UNIT-OPERATOR';
const network=contract.target_network.network,genesis=contract.target_network.genesis_hash;
const hash1='1'.repeat(64),hash2='2'.repeat(64);

function sha256(bytes){return createHash('sha256').update(bytes).digest('hex')}
function derived(phase){return sha256(Buffer.from(`${challenge}:${phase}`))}
async function writeJson(path,value){await writeFile(path,JSON.stringify(value,null,2)+'\n')}
async function rewriteManifest(dir){
  const run=JSON.parse(await readFile(join(dir,'operator-run.json'),'utf8'));
  const files=[];
  for(const rel of contract.required_bundle_files.filter(x=>x!=='manifest.json')){
    const bytes=await readFile(join(dir,rel));
    files.push({path:rel,sha256:sha256(bytes),size:bytes.length});
  }
  await writeJson(join(dir,'manifest.json'),{schema:'FAE_IOR_EVIDENCE_MANIFEST_V1',contract_id:contract.contract_id,run_id:run.run_id,created_at:new Date().toISOString(),files});
}
async function baseline(dir){
  await mkdir(join(dir,'logs'),{recursive:true});
  const identity=generateNodeIdentity();
  const start='2026-09-28T15:00:00.000Z',mid='2026-09-28T15:00:01.000Z',progress='2026-09-28T15:00:02.000Z',restartAt='2026-09-28T15:00:03.000Z',end='2026-09-28T15:00:04.000Z';
  const startup=signEnvelope(identity,'peer-hello',{challenge:derived('startup'),software:'fairyelf',protocol_version:6,network,genesis,height:11,tip_hash:hash1,chain_work:'11',capabilities:[]});
  const restart=signEnvelope(identity,'peer-hello',{challenge:derived('restart'),software:'fairyelf',protocol_version:6,network,genesis,height:12,tip_hash:hash2,chain_work:'12',capabilities:[]});
  await writeJson(join(dir,'operator-run.json'),{schema:'FAE_IOR_OPERATOR_RUN_V1',contract_id:contract.contract_id,run_id:'synthetic-fixture-run',evidence_class:'READINESS_REHEARSAL_ONLY',operator_id:operatorId,run_challenge:challenge,peer_endpoint:'https://peer.example.invalid',started_at:start,ended_at:end,completed:true});
  await writeJson(join(dir,'environment.json'),{schema:'FAE_IOR_ENVIRONMENT_V1',platform:'linux',arch:'x64',node_version:'v22.0.0',fresh_state_directory:true,preinitialized_database:false});
  await writeJson(join(dir,'source-provenance.json'),{schema:'FAE_IOR_SOURCE_PROVENANCE_V1',repository:'https://github.com/Waterfound/FAE-testnet.git',source_revision:sourceRevision,source_tree:sourceTree,worktree_clean_at_start:true});
  await writeJson(join(dir,'bootstrap.json'),{schema:'FAE_IOR_BOOTSTRAP_V1',peer_endpoint:'https://peer.example.invalid',explicit_peer_input:true,preinitialized_database:false,bootstrap_started_at:start,initial_sync_complete:true,initial_authenticated_peers:1});
  await writeJson(join(dir,'network-identity.json'),{schema:'FAE_IOR_NETWORK_IDENTITY_V1',network,genesis_hash:genesis,node_identity:identity.id,protocol_version:6,signed_challenges:{startup,restart}});
  await writeJson(join(dir,'peer-observations.json'),{schema:'FAE_IOR_PEER_OBSERVATIONS_V1',observations:[{at:start,phase:'startup',authenticated_peers:1,peer_identities:['peer-a']},{at:restartAt,phase:'restart',authenticated_peers:1,peer_identities:['peer-a']}]});
  await writeJson(join(dir,'tip-observations.json'),{schema:'FAE_IOR_TIP_OBSERVATIONS_V1',observations:[{at:start,phase:'startup',height:11,tip_hash:hash1},{at:mid,phase:'startup-confirmation',height:11,tip_hash:hash1},{at:progress,phase:'progressed',height:12,tip_hash:hash2},{at:restartAt,phase:'restart',height:12,tip_hash:hash2}]});
  await writeJson(join(dir,'restart-recovery.json'),{schema:'FAE_IOR_RESTART_RECOVERY_V1',controlled_restart:true,pre_restart:{node_identity:identity.id,height:12,tip_hash:hash2},post_restart:{node_identity:identity.id,height:12,tip_hash:hash2},same_node_identity:true,state_recovered:true,peer_recovered:true,manual_state_surgery:false,durable_state_present:true});
  await writeJson(join(dir,'operator-attestation.json'),{schema:'FAE_IOR_OPERATOR_ATTESTATION_V1',operator_id:operatorId,mode:'SIMULATED_CLEAN_ROOM',operator_independence_claimed:false,used_waterfound_machine:false,used_waterfound_shell:false,used_waterfound_private_credentials:false,used_preinitialized_database:false,received_undocumented_interactive_help:false,copied_prior_evidence:false});
  await writeFile(join(dir,'logs/node.log'),'synthetic unit-test fixture only\n');
  await rewriteManifest(dir);
}
async function cloneCase(base,parent,name){const dir=join(parent,name);await cp(base,dir,{recursive:true});return dir}
async function verify(dir,overrides={}){return verifyEvidenceBundle(dir,{expectedSourceRevision:sourceRevision,expectedChallenge:challenge,expectedOperatorId:operatorId,expectedEvidenceClass:'READINESS_REHEARSAL_ONLY',...overrides})}

test('IOR verifier passes a complete internally consistent rehearsal fixture and fails closed on false-PASS attempts',async()=>{
  const parent=await mkdtemp(join(tmpdir(),'fae-ior-adversarial-')),base=join(parent,'baseline');
  try{
    await baseline(base);
    const clean=await verify(base);
    assert.equal(clean.verdict,'PASS');
    assert.equal(clean.external_operator_evidence_admitted,false);

    const wrongNetwork=await cloneCase(base,parent,'wrong-network');
    const wn=JSON.parse(await readFile(join(wrongNetwork,'network-identity.json'),'utf8'));wn.network='wrong-network';await writeJson(join(wrongNetwork,'network-identity.json'),wn);await rewriteManifest(wrongNetwork);
    assert.notEqual((await verify(wrongNetwork)).verdict,'PASS');

    const fabricatedHeight=await cloneCase(base,parent,'fabricated-height');
    const fh=JSON.parse(await readFile(join(fabricatedHeight,'tip-observations.json'),'utf8'));fh.observations.at(-1).height=999999;await writeJson(join(fabricatedHeight,'tip-observations.json'),fh);await rewriteManifest(fabricatedHeight);
    assert.notEqual((await verify(fabricatedHeight)).verdict,'PASS');

    const duplicate=await cloneCase(base,parent,'duplicate-observation');
    const du=JSON.parse(await readFile(join(duplicate,'tip-observations.json'),'utf8'));du.observations.splice(2,0,structuredClone(du.observations[1]));await writeJson(join(duplicate,'tip-observations.json'),du);await rewriteManifest(duplicate);
    assert.notEqual((await verify(duplicate)).verdict,'PASS');

    const truncatedLog=await cloneCase(base,parent,'truncated-log');
    await writeFile(join(truncatedLog,'logs/node.log'),'truncated\n');
    assert.equal((await verify(truncatedLog)).verdict,'INVALID_PROVENANCE');

    const missingRestart=await cloneCase(base,parent,'missing-restart');
    await unlink(join(missingRestart,'restart-recovery.json'));
    assert.equal((await verify(missingRestart)).verdict,'INCOMPLETE');

    assert.equal((await verify(base,{expectedSourceRevision:'d'.repeat(40)})).verdict,'INVALID_PROVENANCE');

    const modifiedManifest=await cloneCase(base,parent,'modified-manifest');
    const mm=JSON.parse(await readFile(join(modifiedManifest,'manifest.json'),'utf8'));mm.files[0].sha256='0'.repeat(64);await writeJson(join(modifiedManifest,'manifest.json'),mm);
    assert.equal((await verify(modifiedManifest)).verdict,'INVALID_PROVENANCE');

    const invalidTime=await cloneCase(base,parent,'invalid-time');
    const it=JSON.parse(await readFile(join(invalidTime,'tip-observations.json'),'utf8'));it.observations[1].at='not-a-time';await writeJson(join(invalidTime,'tip-observations.json'),it);await rewriteManifest(invalidTime);
    assert.notEqual((await verify(invalidTime)).verdict,'PASS');

    const missingPeers=await cloneCase(base,parent,'missing-peers');
    const mp=JSON.parse(await readFile(join(missingPeers,'peer-observations.json'),'utf8'));mp.observations[0].authenticated_peers=0;mp.observations[0].peer_identities=[];await writeJson(join(missingPeers,'peer-observations.json'),mp);await rewriteManifest(missingPeers);
    assert.notEqual((await verify(missingPeers)).verdict,'PASS');

    assert.equal((await verify(base,{expectedOperatorId:'DIFFERENT-OPERATOR'})).verdict,'INVALID_PROVENANCE');
    assert.equal((await verify(base,{expectedChallenge:'e'.repeat(64)})).verdict,'INVALID_PROVENANCE');
    assert.equal((await verify(base,{expectedEvidenceClass:'EXTERNAL_OPERATOR_RUN'})).verdict,'INVALID_PROVENANCE');

    const partial=await cloneCase(base,parent,'partial');
    const pr=JSON.parse(await readFile(join(partial,'operator-run.json'),'utf8'));pr.completed=false;await writeJson(join(partial,'operator-run.json'),pr);await rewriteManifest(partial);
    assert.notEqual((await verify(partial)).verdict,'PASS');
  }finally{await rm(parent,{recursive:true,force:true})}
});
