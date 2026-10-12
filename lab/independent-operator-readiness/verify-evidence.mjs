#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {lstat,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyEnvelope} from '../../sovereign-forge/node/authoritative/node-identity.mjs';

const contractPath=fileURLToPath(new URL('./acceptance-contract.json',import.meta.url));
const contract=JSON.parse(await readFile(contractPath,'utf8'));
const SHA256=/^[0-9a-f]{64}$/;
const HEX40=/^[0-9a-f]{40}$/;

function sha256(bytes){return createHash('sha256').update(bytes).digest('hex')}
function deriveChallenge(root,phase){return sha256(Buffer.from(`${root}:${phase}`))}
function parseArgs(argv){
  const out={};
  for(let i=0;i<argv.length;i++){
    const arg=argv[i];
    if(!arg.startsWith('--'))continue;
    const key=arg.slice(2);
    const value=argv[i+1]&&!argv[i+1].startsWith('--')?argv[++i]:true;
    out[key]=value;
  }
  return out;
}
function time(value,label,errors){
  const ms=Date.parse(value);
  if(!Number.isFinite(ms))errors.push(`invalid_timestamp:${label}`);
  return ms;
}
async function readJson(path,label,errors){
  try{return JSON.parse(await readFile(path,'utf8'))}
  catch(error){errors.push(`malformed_or_missing_json:${label}:${error.code||error.message}`);return null}
}
async function fileDigest(path){
  const bytes=await readFile(path);
  return{sha256:sha256(bytes),size:bytes.length};
}
function classify(errors){
  if(!errors.length)return'PASS';
  if(errors.some(x=>x.startsWith('missing_required_file')||x.startsWith('malformed_or_missing_json')))return'INCOMPLETE';
  if(errors.some(x=>/checksum|manifest|source_revision|challenge|operator_id|evidence_class|signed_|contract_id|source_tree/.test(x)))return'INVALID_PROVENANCE';
  return'FAIL';
}

export async function verifyEvidenceBundle(bundleDir,expectations={}){
  const root=resolve(bundleDir);
  const errors=[];
  const required=[...contract.required_bundle_files];
  for(const rel of required){
    try{
      const st=await lstat(resolve(root,rel));
      if(st.isSymbolicLink())errors.push(`missing_required_file:${rel}:symlink_forbidden`);
      if(!st.isFile())errors.push(`missing_required_file:${rel}:not_file`);
    }catch{errors.push(`missing_required_file:${rel}`)}
  }
  if(errors.some(x=>x.startsWith('missing_required_file')))return{verdict:'INCOMPLETE',errors};

  const jsonNames=required.filter(x=>x.endsWith('.json'));
  const docs={};
  for(const rel of jsonNames)docs[rel]=await readJson(resolve(root,rel),rel,errors);
  if(errors.length)return{verdict:classify(errors),errors};

  const run=docs['operator-run.json'];
  const env=docs['environment.json'];
  const source=docs['source-provenance.json'];
  const bootstrap=docs['bootstrap.json'];
  const network=docs['network-identity.json'];
  const peers=docs['peer-observations.json'];
  const tips=docs['tip-observations.json'];
  const restart=docs['restart-recovery.json'];
  const attestation=docs['operator-attestation.json'];
  const manifest=docs['manifest.json'];

  if(run?.schema!=='FAE_IOR_OPERATOR_RUN_V1')errors.push('unsupported_schema:operator-run');
  if(run?.contract_id!==contract.contract_id)errors.push('contract_id_mismatch');
  if(run?.completed!==true)errors.push('partial_execution:operator-run-not-complete');
  if(!run?.run_id||typeof run.run_id!=='string')errors.push('partial_execution:missing-run-id');
  if(!SHA256.test(String(run?.run_challenge||'')))errors.push('challenge_format_invalid');
  if(!run?.operator_id)errors.push('operator_id_missing');
  if(!['READINESS_REHEARSAL_ONLY','EXTERNAL_OPERATOR_RUN'].includes(run?.evidence_class))errors.push('evidence_class_unsupported');

  if(expectations.expectedSourceRevision&&source?.source_revision!==expectations.expectedSourceRevision)errors.push('source_revision_mismatch');
  if(expectations.expectedChallenge&&run?.run_challenge!==expectations.expectedChallenge)errors.push('challenge_mismatch');
  if(expectations.expectedOperatorId&&run?.operator_id!==expectations.expectedOperatorId)errors.push('operator_id_mismatch');
  if(expectations.expectedEvidenceClass&&run?.evidence_class!==expectations.expectedEvidenceClass)errors.push('evidence_class_mismatch');

  if(source?.schema!=='FAE_IOR_SOURCE_PROVENANCE_V1')errors.push('unsupported_schema:source-provenance');
  if(!HEX40.test(String(source?.source_revision||'')))errors.push('source_revision_invalid');
  if(!HEX40.test(String(source?.source_tree||'')))errors.push('source_tree_invalid');
  if(source?.worktree_clean_at_start!==true)errors.push('source_worktree_not_clean_at_start');
  if(!source?.repository)errors.push('source_repository_missing');

  if(env?.schema!=='FAE_IOR_ENVIRONMENT_V1')errors.push('unsupported_schema:environment');
  if(env?.fresh_state_directory!==true)errors.push('fresh_state_directory_required');
  if(env?.preinitialized_database!==false)errors.push('preinitialized_database_forbidden');

  if(bootstrap?.schema!=='FAE_IOR_BOOTSTRAP_V1')errors.push('unsupported_schema:bootstrap');
  if(bootstrap?.explicit_peer_input!==true||!bootstrap?.peer_endpoint)errors.push('explicit_peer_input_required');
  if(Number(bootstrap?.initial_authenticated_peers)<contract.acceptance.peers.minimum_authenticated_peers)errors.push('missing_authenticated_peer:bootstrap');

  if(network?.schema!=='FAE_IOR_NETWORK_IDENTITY_V1')errors.push('unsupported_schema:network-identity');
  if(network?.network!==contract.target_network.network)errors.push('wrong_network');
  if(network?.genesis_hash!==contract.target_network.genesis_hash)errors.push('wrong_genesis');
  if(!SHA256.test(String(network?.node_identity||'')))errors.push('node_identity_invalid');
  const signed=network?.signed_challenges||{},signedPayloads={};
  for(const phase of ['startup','restart']){
    const envelope=signed[phase];
    if(!envelope){errors.push(`signed_challenge_missing:${phase}`);continue}
    try{
      const payload=verifyEnvelope(envelope,{kind:'peer-hello',expectedSignerId:network.node_identity,maxAgeMs:Number.MAX_SAFE_INTEGER,allowFutureMs:300000});
      signedPayloads[phase]=payload;
      const expected=deriveChallenge(run.run_challenge,phase);
      if(payload.challenge!==expected)errors.push(`signed_challenge_mismatch:${phase}`);
      if(payload.network!==contract.target_network.network)errors.push(`signed_wrong_network:${phase}`);
      if(payload.genesis!==contract.target_network.genesis_hash)errors.push(`signed_wrong_genesis:${phase}`);
      if(Number(payload.protocol_version)<contract.target_network.minimum_p2p_protocol_version)errors.push(`signed_protocol_too_old:${phase}`);
      if(!Number.isSafeInteger(Number(payload.height))||!SHA256.test(String(payload.tip_hash||'')))errors.push(`signed_tip_invalid:${phase}`);
    }catch(error){errors.push(`signed_challenge_invalid:${phase}:${error.message}`)}
  }

  if(peers?.schema!=='FAE_IOR_PEER_OBSERVATIONS_V1'||!Array.isArray(peers?.observations))errors.push('unsupported_schema:peer-observations');
  else{
    const phases=new Set();
    for(const [i,row] of peers.observations.entries()){
      phases.add(row.phase);
      if(Number(row.authenticated_peers)<1)errors.push(`missing_authenticated_peer:observation:${i}`);
      if(!Array.isArray(row.peer_identities)||row.peer_identities.length<1)errors.push(`missing_peer_identity:observation:${i}`);
    }
    if(!phases.has('startup')||!phases.has('restart'))errors.push('peer_recovery_phases_missing');
  }

  if(tips?.schema!=='FAE_IOR_TIP_OBSERVATIONS_V1'||!Array.isArray(tips?.observations))errors.push('unsupported_schema:tip-observations');
  else{
    const obs=tips.observations;
    if(obs.length<contract.acceptance.tip.minimum_observations)errors.push('insufficient_tip_observations');
    let lastAt=-Infinity,lastHeight=-1;
    const exact=new Set();
    for(const [i,row] of obs.entries()){
      const at=time(row.at,`tip:${i}`,errors),height=Number(row.height),hash=String(row.tip_hash||'');
      const key=`${row.at}:${height}:${hash}`;
      if(exact.has(key))errors.push(`duplicate_tip_observation:${i}`);
      exact.add(key);
      if(at<=lastAt)errors.push(`non_monotonic_tip_time:${i}`);
      if(!Number.isSafeInteger(height)||height<0||height<lastHeight)errors.push(`non_monotonic_tip_height:${i}`);
      if(!SHA256.test(hash))errors.push(`invalid_tip_hash:${i}`);
      lastAt=at;lastHeight=height;
    }
    if(obs.length&&Number(obs.at(-1)?.height)<=Number(obs[0]?.height))errors.push('missing_tip_progression');
    const startupObs=obs.find(row=>row.phase==='startup'),restartObs=obs.find(row=>row.phase==='restart');
    if(startupObs&&signedPayloads.startup&&(Number(startupObs.height)!==Number(signedPayloads.startup.height)||startupObs.tip_hash!==signedPayloads.startup.tip_hash))errors.push('signed_tip_mismatch:startup');
    if(restartObs&&signedPayloads.restart&&(Number(restartObs.height)!==Number(signedPayloads.restart.height)||restartObs.tip_hash!==signedPayloads.restart.tip_hash))errors.push('signed_tip_mismatch:restart');
  }

  if(restart?.schema!=='FAE_IOR_RESTART_RECOVERY_V1')errors.push('unsupported_schema:restart-recovery');
  if(restart?.controlled_restart!==true)errors.push('missing_restart');
  if(restart?.same_node_identity!==true)errors.push('node_identity_changed_across_restart');
  if(restart?.state_recovered!==true)errors.push('restart_state_not_recovered');
  if(restart?.peer_recovered!==true)errors.push('restart_peer_not_recovered');
  if(restart?.manual_state_surgery!==false)errors.push('manual_state_surgery_forbidden');
  if(restart?.pre_restart?.node_identity!==restart?.post_restart?.node_identity)errors.push('restart_identity_values_differ');
  if(Number(restart?.post_restart?.height)<Number(restart?.pre_restart?.height))errors.push('restart_height_regressed');
  if(signedPayloads.restart&&(Number(restart?.post_restart?.height)!==Number(signedPayloads.restart.height)||restart?.post_restart?.tip_hash!==signedPayloads.restart.tip_hash))errors.push('signed_restart_state_mismatch');

  const start=time(run?.started_at,'run.started_at',errors),end=time(run?.ended_at,'run.ended_at',errors);
  if(Number.isFinite(start)&&Number.isFinite(end)&&(end<=start||end-start>24*60*60*1000))errors.push('impossible_run_time_window');
  for(const collection of [peers?.observations||[],tips?.observations||[]]){
    for(const row of collection){
      const at=Date.parse(row.at);
      if(Number.isFinite(at)&&Number.isFinite(start)&&Number.isFinite(end)&&(at<start||at>end))errors.push('observation_outside_run_window');
    }
  }

  if(attestation?.schema!=='FAE_IOR_OPERATOR_ATTESTATION_V1')errors.push('unsupported_schema:operator-attestation');
  if(attestation?.operator_id!==run?.operator_id)errors.push('operator_id_attestation_mismatch');
  for(const field of ['used_waterfound_machine','used_waterfound_shell','used_waterfound_private_credentials','used_preinitialized_database','received_undocumented_interactive_help','copied_prior_evidence']){
    if(attestation?.[field]!==false)errors.push(`forbidden_shortcut_attested:${field}`);
  }
  if(run?.evidence_class==='EXTERNAL_OPERATOR_RUN'){
    if(attestation?.mode!=='EXTERNAL_SELF_ATTESTATION'||attestation?.operator_independence_claimed!==true)errors.push('external_operator_attestation_missing');
  }else{
    if(attestation?.mode!=='SIMULATED_CLEAN_ROOM'||attestation?.operator_independence_claimed!==false)errors.push('rehearsal_attestation_scope_invalid');
  }

  if(manifest?.schema!=='FAE_IOR_EVIDENCE_MANIFEST_V1')errors.push('unsupported_schema:manifest');
  if(manifest?.contract_id!==contract.contract_id)errors.push('manifest_contract_id_mismatch');
  if(manifest?.run_id!==run?.run_id)errors.push('manifest_run_id_mismatch');
  if(!Array.isArray(manifest?.files))errors.push('manifest_files_missing');
  else{
    const expectedFiles=required.filter(x=>x!=='manifest.json').sort();
    const listed=manifest.files.map(x=>x.path).sort();
    if(JSON.stringify(listed)!==JSON.stringify(expectedFiles))errors.push('manifest_file_set_mismatch');
    for(const entry of manifest.files){
      if(typeof entry.path!=='string'||entry.path.startsWith('/')||entry.path.includes('..')){errors.push('manifest_path_invalid');continue}
      try{
        const actual=await fileDigest(resolve(root,entry.path));
        if(actual.sha256!==entry.sha256||actual.size!==entry.size)errors.push(`checksum_mismatch:${entry.path}`);
      }catch{errors.push(`checksum_missing_file:${entry.path}`)}
    }
  }

  const verdict=classify(errors);
  return{
    verdict,
    errors,
    contract_id:contract.contract_id,
    run_id:run?.run_id??null,
    evidence_class:run?.evidence_class??null,
    external_operator_evidence_admitted:false,
    note:verdict==='PASS'?'Bundle is structurally admissible under the frozen contract; external operator eligibility still requires separate admission.':undefined
  };
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const args=parseArgs(process.argv.slice(2));
  if(!args.bundle)throw new Error('--bundle is required');
  const result=await verifyEvidenceBundle(args.bundle,{
    expectedSourceRevision:args['expected-source-revision'],
    expectedChallenge:args['expected-challenge'],
    expectedOperatorId:args['expected-operator-id'],
    expectedEvidenceClass:args['expected-evidence-class']
  });
  console.log(JSON.stringify(result,null,2));
  if(result.verdict!=='PASS')process.exitCode=1;
}
