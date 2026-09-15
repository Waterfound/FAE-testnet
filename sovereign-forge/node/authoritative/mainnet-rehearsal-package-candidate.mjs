import {createHash} from 'node:crypto';

export const MAINNET_REHEARSAL_STATUS='candidate-not-authorized-mainnet';
export const MAINNET_REHEARSAL_FORMAT='FAE_MAINNET_REHEARSAL_PACKAGE_V1';
export const MAINNET_REHEARSAL_ECONOMICS=Object.freeze({target_seconds:300,initial_subsidy_fae:14,halving_era_blocks:430000,theoretical_max_supply_fae:12040000,coinbase_maturity_blocks:200,status:'not-authorized'});
export const MAINNET_STARTUP_SEQUENCE=Object.freeze([
  'verify-release-artifact','freeze-launch-config','derive-genesis-commitment','start-bootstrap-isolated',
  'verify-bootstrap-diversity','rehearse-genesis','verify-peer-convergence','evaluate-go-no-go'
]);
export const REQUIRED_EXTERNAL_EVIDENCE=Object.freeze(['physical_hfb','representative_device','operational_soak','independent_operators']);
const ZERO_HASH='0'.repeat(64),COIN=100000000n;

function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));return value}
function stable(value){return JSON.stringify(canonical(value));}
function digest(value){return createHash('sha256').update(stable(value)).digest('hex');}
function positiveInteger(value,label){const n=Number(value);if(!Number.isSafeInteger(n)||n<=0)throw new Error(`${label}_invalid`);return n}
function hex64(value,label){const s=String(value??'').toLowerCase();if(!/^[0-9a-f]{64}$/.test(s))throw new Error(`${label}_invalid`);return s}
function requiredString(value,label){const s=String(value??'').trim();if(!s)throw new Error(`${label}_required`);return s}

export function createGenesisRehearsal({networkId='fairyelf-mainnet-rehearsal-v1',timestampMs,initialTargetHex,minerAddress}={}){
  const network=requiredString(networkId,'network_id'),timestamp=positiveInteger(timestampMs,'genesis_timestamp_ms'),target=hex64(initialTargetHex,'initial_target_hex'),miner=requiredString(minerAddress,'genesis_miner_address');
  const descriptor={
    format:'FAE_MAINNET_GENESIS_REHEARSAL_V1',status:MAINNET_REHEARSAL_STATUS,network,height:1,previous_hash:ZERO_HASH,
    timestamp_ms:timestamp,initial_target_hex:target,miner_address:miner,reward_atoms:(14n*COIN).toString(),
    target_seconds:MAINNET_REHEARSAL_ECONOMICS.target_seconds,halving_era_blocks:MAINNET_REHEARSAL_ECONOMICS.halving_era_blocks,
    coinbase_maturity_blocks:MAINNET_REHEARSAL_ECONOMICS.coinbase_maturity_blocks,txids:[]
  };
  return Object.freeze({...descriptor,genesis_commitment:digest(descriptor)});
}

export function assessBootstrapSet(nodes,requirements={}){
  if(!Array.isArray(nodes))throw new Error('bootstrap_nodes_required');
  const minDistinctOperators=positiveInteger(requirements.min_distinct_operators,'min_distinct_operators');
  const minDistinctNetworkGroups=positiveInteger(requirements.min_distinct_network_groups,'min_distinct_network_groups');
  const minPinnedIdentities=positiveInteger(requirements.min_pinned_identities,'min_pinned_identities');
  const identities=new Set(),endpoints=new Set(),operators=new Set(),groups=new Set();let pinned=0;
  for(const raw of nodes){
    const identity=hex64(raw?.identity_id,'bootstrap_identity_id'),endpoint=requiredString(raw?.endpoint,'bootstrap_endpoint'),operator=requiredString(raw?.operator_id,'bootstrap_operator_id'),group=requiredString(raw?.network_group,'bootstrap_network_group');
    if(identities.has(identity))throw new Error('duplicate_bootstrap_identity');if(endpoints.has(endpoint))throw new Error('duplicate_bootstrap_endpoint');
    identities.add(identity);endpoints.add(endpoint);operators.add(operator);groups.add(group);if(raw?.pinned===true)pinned++;
  }
  const ready=operators.size>=minDistinctOperators&&groups.size>=minDistinctNetworkGroups&&pinned>=minPinnedIdentities;
  return Object.freeze({ready,node_count:nodes.length,distinct_operators:operators.size,distinct_network_groups:groups.size,pinned_identities:pinned,requirements:{min_distinct_operators:minDistinctOperators,min_distinct_network_groups:minDistinctNetworkGroups,min_pinned_identities:minPinnedIdentities}});
}

export function buildStartupPlan({releaseArtifactSha256,configDigest,genesisCommitment}={}){
  const release=hex64(releaseArtifactSha256,'release_artifact_sha256'),config=hex64(configDigest,'config_digest'),genesis=hex64(genesisCommitment,'genesis_commitment');
  return Object.freeze(MAINNET_STARTUP_SEQUENCE.map((step,index)=>Object.freeze({order:index+1,step,dry_run:true,authority:'rehearsal-only',release_artifact_sha256:release,config_digest:config,genesis_commitment:genesis})));
}

export function abortRehearsal({genesisPublished=false,reason='operator_abort'}={}){
  const why=requiredString(reason,'abort_reason');
  if(!genesisPublished)return Object.freeze({status:'ABORTED',reason:why,genesis_published:false,safe_to_restart_same_rehearsal_network:true,action:'discard_ephemeral_state_and_recheck_from_step_1'});
  return Object.freeze({status:'ABORTED',reason:why,genesis_published:true,safe_to_restart_same_rehearsal_network:false,action:'preserve_evidence_do_not_rewrite_genesis_choose_new_network_or_genesis'});
}

export function evaluateLaunchChecklist({software={},externalEvidence={},finalFreeze={}}={}){
  const softwareKeys=['release_reproducible','genesis_rehearsed','bootstrap_ready','peer_convergence','rollback_rehearsed'];
  const softwareMissing=softwareKeys.filter(key=>software[key]!==true);
  const externalMissing=REQUIRED_EXTERNAL_EVIDENCE.filter(key=>externalEvidence[key]!==true);
  const finalFreezeKeys=['genesis_timestamp_ms','initial_target_hex','genesis_miner_address','release_artifact_sha256','bootstrap_requirements','bootstrap_nodes'];
  const finalFreezeMissing=finalFreezeKeys.filter(key=>finalFreeze[key]===null||finalFreeze[key]===undefined||(Array.isArray(finalFreeze[key])&&finalFreeze[key].length===0));
  return Object.freeze({
    status:MAINNET_REHEARSAL_STATUS,software_ready:softwareMissing.length===0,software_missing:softwareMissing,
    external_evidence_complete:externalMissing.length===0,external_missing:externalMissing,
    final_freeze_complete:finalFreezeMissing.length===0,final_freeze_missing:finalFreezeMissing,
    candidate_to_authoritative:false,mainnet_launch_authorized:false,automatic_go_path:false,decision:'HOLD_FINAL_EXPLICIT_AUTHORIZATION'
  });
}

export function buildMainnetRehearsalPackage({releaseArtifactSha256,config,genesis,bootstrap,software,externalEvidence={}}={}){
  const release=hex64(releaseArtifactSha256,'release_artifact_sha256');if(!config||!genesis||!bootstrap)throw new Error('rehearsal_package_inputs_required');
  const configDigest=digest(config),startup=buildStartupPlan({releaseArtifactSha256:release,configDigest,genesisCommitment:genesis.genesis_commitment});
  const checklist=evaluateLaunchChecklist({software,externalEvidence,finalFreeze:{...config,release_artifact_sha256:release}});
  const body={format:MAINNET_REHEARSAL_FORMAT,status:MAINNET_REHEARSAL_STATUS,release_artifact_sha256:release,config_digest:configDigest,economics_candidate:MAINNET_REHEARSAL_ECONOMICS,genesis,bootstrap,startup_sequence:startup,checklist};
  return Object.freeze({...body,package_digest:digest(body)});
}
