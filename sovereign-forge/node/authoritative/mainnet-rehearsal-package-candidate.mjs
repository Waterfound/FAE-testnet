import {createHash} from 'node:crypto';

export const MAINNET_REHEARSAL_STATUS='candidate-not-authorized-mainnet';
export const MAINNET_REHEARSAL_FORMAT='FAE_MAINNET_REHEARSAL_PACKAGE_V2';
export const REQUIRED_RELEASE_FORMAT='FAE_SOURCE_RELEASE_V2';
export const MAINNET_REHEARSAL_ECONOMICS=Object.freeze({
  target_seconds:300,
  initial_subsidy_fae:14,
  halving_era_blocks:430000,
  theoretical_max_supply_fae:12040000,
  coinbase_maturity_blocks:200,
  status:'not-authorized'
});
export const MAINNET_STARTUP_SEQUENCE=Object.freeze([
  'verify-release-bundle',
  'verify-release-source-tree',
  'freeze-launch-config',
  'derive-genesis-commitment',
  'start-bootstrap-isolated',
  'verify-bootstrap-diversity',
  'rehearse-genesis',
  'verify-peer-convergence',
  'evaluate-go-no-go'
]);
export const REQUIRED_EXTERNAL_EVIDENCE=Object.freeze([
  'physical_hfb','representative_device','operational_soak','independent_operators'
]);

const ZERO_HASH='0'.repeat(64),COIN=100000000n;
const VERIFIED_RELEASE_BINDINGS=new WeakSet();

function canonical(value){
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object'&&!Buffer.isBuffer(value))return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
  return value;
}
function stable(value){return JSON.stringify(canonical(value));}
function sha256Bytes(bytes){return createHash('sha256').update(bytes).digest('hex');}
function sha1Object(type,bytes){return createHash('sha1').update(Buffer.concat([Buffer.from(`${type} ${bytes.length}\0`),bytes])).digest('hex');}
function hex(value,label,length){const s=String(value??'').toLowerCase();if(!new RegExp(`^[0-9a-f]{${length}}$`).test(s))throw new Error(`${label}_invalid`);return s;}
function hex64(value,label){return hex(value,label,64);}
function hex40(value,label){return hex(value,label,40);}
function positiveInteger(value,label){const n=Number(value);if(!Number.isSafeInteger(n)||n<=0)throw new Error(`${label}_invalid`);return n;}
function requiredString(value,label){const s=String(value??'').trim();if(!s)throw new Error(`${label}_required`);return s;}
function codepointOrder(a,b){return a<b?-1:a>b?1:0;}
function parseJsonBytes(bytes,label){try{return JSON.parse(Buffer.from(bytes).toString('utf8'));}catch{throw new Error(`${label}_invalid_json`);}}
function bufferFrom(value,label){if(Buffer.isBuffer(value))return value;if(value instanceof Uint8Array)return Buffer.from(value);if(typeof value==='string')return Buffer.from(value);throw new Error(`${label}_bytes_required`);}

function reconstructSourceTree(metadata){
  const root={dirs:new Map(),files:[]};
  for(const row of metadata){
    const path=requiredString(row.path,'release_path');
    const parts=path.split('/');
    if(parts.some(part=>!part||part==='.'||part==='..'))throw new Error('release_path_invalid');
    let node=root;
    for(const part of parts.slice(0,-1)){
      if(!node.dirs.has(part))node.dirs.set(part,{dirs:new Map(),files:[]});
      node=node.dirs.get(part);
    }
    node.files.push({name:parts.at(-1),mode:String(row.git_mode),oid:hex40(row.git_object,'git_object')});
  }
  function build(node){
    const entries=[];
    for(const file of node.files)entries.push({...file,isTree:false});
    for(const[name,child]of node.dirs)entries.push({name,mode:'40000',oid:build(child),isTree:true});
    entries.sort((a,b)=>{
      const aKey=Buffer.from(`${a.name}${a.isTree?'/':'\0'}`),bKey=Buffer.from(`${b.name}${b.isTree?'/':'\0'}`);
      return Buffer.compare(aKey,bKey);
    });
    const content=Buffer.concat(entries.map(entry=>Buffer.concat([
      Buffer.from(`${entry.mode} ${entry.name}\0`),Buffer.from(entry.oid,'hex')
    ])));
    return sha1Object('tree',content);
  }
  return build(root);
}

function validateReleaseConfig(config){
  if(config?.format!=='FAE_RELEASE_CONFIG_FREEZE_V2'||config?.status!=='candidate-package-only')throw new Error('release_config_format_invalid');
  if(config?.authority?.candidate_to_authoritative!==false||config?.authority?.mainnet_launch_authorized!==false||config?.authority?.live_activation_height!==null)throw new Error('release_config_authority_invalid');
  const live=config?.canonical_public_testnet;
  if(live?.network!=='fairyelf-public-testnet-v4'||live?.target_seconds!==180||live?.initial_subsidy_fae!==10||live?.halving_era_blocks!==600000)throw new Error('release_config_live_economics_invalid');
  const future=config?.preferred_future_candidate;
  if(future?.target_seconds!==300||future?.initial_subsidy_fae!==14||future?.halving_era_blocks!==430000||future?.theoretical_max_supply_fae!==12040000||future?.coinbase_maturity_blocks!==200||future?.activation_height!==null||future?.status!=='not-authorized')throw new Error('release_config_candidate_economics_invalid');
  return true;
}

export function verifyReleaseEvidence({
  artifactBytes,manifestBytes,checksumText,
  expectedArtifactSha256,expectedManifestSha256,expectedSourceCommit,expectedSourceTree
}={}){
  const artifactBuffer=bufferFrom(artifactBytes,'release_artifact');
  const manifestBuffer=bufferFrom(manifestBytes,'release_manifest');
  const expectedArtifact=hex64(expectedArtifactSha256,'expected_release_artifact_sha256');
  const expectedManifest=hex64(expectedManifestSha256,'expected_release_manifest_sha256');
  const expectedCommit=hex40(expectedSourceCommit,'expected_release_source_commit');
  const expectedTree=hex40(expectedSourceTree,'expected_release_source_tree');
  const actualArtifact=sha256Bytes(artifactBuffer),actualManifest=sha256Bytes(manifestBuffer);
  if(actualArtifact!==expectedArtifact)throw new Error('release_artifact_digest_mismatch');
  if(actualManifest!==expectedManifest)throw new Error('release_manifest_digest_mismatch');
  if(String(checksumText??'')!==`${actualArtifact}  fae-source-release-v2.json\n`)throw new Error('release_checksum_file_mismatch');

  const artifact=parseJsonBytes(artifactBuffer,'release_artifact'),manifest=parseJsonBytes(manifestBuffer,'release_manifest');
  if(artifact?.format!==REQUIRED_RELEASE_FORMAT||artifact?.status!=='candidate-package-only')throw new Error('release_artifact_format_invalid');
  if(manifest?.format!==REQUIRED_RELEASE_FORMAT||manifest?.status!=='candidate-package-only')throw new Error('release_manifest_format_invalid');
  if(stable(artifact.manifest)!==stable(manifest))throw new Error('release_embedded_manifest_mismatch');
  if(hex40(manifest.source_commit,'release_source_commit')!==expectedCommit)throw new Error('release_source_commit_mismatch');
  if(hex40(manifest.source_tree,'release_source_tree')!==expectedTree)throw new Error('release_source_tree_claim_mismatch');
  if(manifest.source_bytes!=='git-commit-blobs-only'||manifest.tracked_worktree_required!=='clean')throw new Error('release_provenance_mode_invalid');
  if(!Array.isArray(artifact.files)||!Array.isArray(manifest.files)||artifact.files.length!==manifest.files.length||manifest.file_count!==artifact.files.length)throw new Error('release_file_count_mismatch');

  const paths=artifact.files.map(row=>requiredString(row?.path,'release_path'));
  if(new Set(paths).size!==paths.length)throw new Error('release_duplicate_path');
  if(paths.some((path,index)=>index>0&&codepointOrder(paths[index-1],path)>0))throw new Error('release_path_order_invalid');
  const metadata=new Map();
  for(const row of manifest.files){
    const path=requiredString(row?.path,'release_metadata_path');
    if(metadata.has(path))throw new Error('release_duplicate_metadata_path');
    metadata.set(path,row);
  }
  for(const row of artifact.files){
    const meta=metadata.get(row.path);if(!meta)throw new Error('release_metadata_missing');
    if(!/^(100644|100755|120000)$/.test(String(meta.git_mode)))throw new Error('release_git_mode_invalid');
    const content=Buffer.from(String(row.content_base64??''),'base64');
    if(content.length!==Number(meta.bytes))throw new Error('release_blob_length_mismatch');
    if(sha256Bytes(content)!==hex64(meta.sha256,'release_blob_sha256'))throw new Error('release_blob_sha256_mismatch');
    if(sha1Object('blob',content)!==hex40(meta.git_object,'release_git_blob'))throw new Error('release_git_blob_mismatch');
  }
  const reconstructedTree=reconstructSourceTree(manifest.files);
  if(reconstructedTree!==expectedTree)throw new Error('release_source_tree_mismatch');

  const configPath=requiredString(manifest.config_path,'release_config_path');
  const configRow=artifact.files.find(row=>row.path===configPath);if(!configRow)throw new Error('release_config_missing');
  const configBytes=Buffer.from(String(configRow.content_base64??''),'base64');
  const configSha=sha256Bytes(configBytes);
  if(configSha!==hex64(manifest.config_sha256,'release_config_sha256'))throw new Error('release_config_digest_mismatch');
  validateReleaseConfig(parseJsonBytes(configBytes,'release_config'));

  const binding=Object.freeze({
    status:'verified-source-release-v2',release_format:REQUIRED_RELEASE_FORMAT,
    artifact_sha256:actualArtifact,manifest_sha256:actualManifest,
    source_commit:expectedCommit,source_tree:expectedTree,config_sha256:configSha,
    file_count:artifact.files.length
  });
  VERIFIED_RELEASE_BINDINGS.add(binding);
  return binding;
}

function assertVerifiedReleaseBinding(binding){
  if(!binding||!VERIFIED_RELEASE_BINDINGS.has(binding))throw new Error('verified_release_binding_required');
  return binding;
}

export function createGenesisRehearsal({networkId='fairyelf-mainnet-rehearsal-v2',timestampMs,initialTargetHex,minerAddress}={}){
  const network=requiredString(networkId,'network_id'),timestamp=positiveInteger(timestampMs,'genesis_timestamp_ms'),target=hex64(initialTargetHex,'initial_target_hex'),miner=requiredString(minerAddress,'genesis_miner_address');
  const descriptor={
    format:'FAE_MAINNET_GENESIS_REHEARSAL_V2',status:MAINNET_REHEARSAL_STATUS,network,height:1,previous_hash:ZERO_HASH,
    timestamp_ms:timestamp,initial_target_hex:target,miner_address:miner,reward_atoms:(14n*COIN).toString(),
    target_seconds:MAINNET_REHEARSAL_ECONOMICS.target_seconds,halving_era_blocks:MAINNET_REHEARSAL_ECONOMICS.halving_era_blocks,
    coinbase_maturity_blocks:MAINNET_REHEARSAL_ECONOMICS.coinbase_maturity_blocks,txids:[]
  };
  return Object.freeze({...descriptor,genesis_commitment:sha256Bytes(Buffer.from(stable(descriptor)))});
}

export function assessBootstrapSet(nodes,requirements={}){
  if(!Array.isArray(nodes))throw new Error('bootstrap_nodes_required');
  const minDistinctOperators=positiveInteger(requirements.min_distinct_operators,'min_distinct_operators');
  const minDistinctNetworkGroups=positiveInteger(requirements.min_distinct_network_groups,'min_distinct_network_groups');
  const minPinnedIdentities=positiveInteger(requirements.min_pinned_identities,'min_pinned_identities');
  const identities=new Set(),endpoints=new Set(),operators=new Set(),groups=new Set();let pinned=0;
  for(const raw of nodes){
    const identity=hex64(raw?.identity_id,'bootstrap_identity_id'),endpoint=requiredString(raw?.endpoint,'bootstrap_endpoint'),operator=requiredString(raw?.operator_id,'bootstrap_operator_id'),group=requiredString(raw?.network_group,'bootstrap_network_group');
    if(identities.has(identity))throw new Error('duplicate_bootstrap_identity');
    if(endpoints.has(endpoint))throw new Error('duplicate_bootstrap_endpoint');
    identities.add(identity);endpoints.add(endpoint);operators.add(operator);groups.add(group);if(raw?.pinned===true)pinned++;
  }
  const ready=operators.size>=minDistinctOperators&&groups.size>=minDistinctNetworkGroups&&pinned>=minPinnedIdentities;
  return Object.freeze({ready,node_count:nodes.length,distinct_operators:operators.size,distinct_network_groups:groups.size,pinned_identities:pinned,requirements:{min_distinct_operators:minDistinctOperators,min_distinct_network_groups:minDistinctNetworkGroups,min_pinned_identities:minPinnedIdentities}});
}

function assertReleaseFreeze(config,binding){
  const checks={
    release_artifact_sha256:binding.artifact_sha256,
    release_manifest_sha256:binding.manifest_sha256,
    release_source_commit:binding.source_commit,
    release_source_tree:binding.source_tree,
    release_config_sha256:binding.config_sha256
  };
  for(const[key,expected]of Object.entries(checks))if(String(config?.[key]??'').toLowerCase()!==expected)throw new Error(`${key}_does_not_match_verified_release`);
  return true;
}

export function buildStartupPlan({releaseBinding,configDigest,genesisCommitment}={}){
  const binding=assertVerifiedReleaseBinding(releaseBinding),config=hex64(configDigest,'config_digest'),genesis=hex64(genesisCommitment,'genesis_commitment');
  return Object.freeze(MAINNET_STARTUP_SEQUENCE.map((step,index)=>Object.freeze({
    order:index+1,step,dry_run:true,authority:'rehearsal-only',
    release_artifact_sha256:binding.artifact_sha256,release_manifest_sha256:binding.manifest_sha256,
    release_source_commit:binding.source_commit,release_source_tree:binding.source_tree,
    config_digest:config,genesis_commitment:genesis
  })));
}

export function abortRehearsal({genesisPublished=false,reason='operator_abort'}={}){
  const why=requiredString(reason,'abort_reason');
  if(!genesisPublished)return Object.freeze({status:'ABORTED',reason:why,genesis_published:false,safe_to_restart_same_rehearsal_network:true,action:'discard_ephemeral_state_and_recheck_from_step_1'});
  return Object.freeze({status:'ABORTED',reason:why,genesis_published:true,safe_to_restart_same_rehearsal_network:false,action:'preserve_evidence_do_not_rewrite_genesis_choose_new_network_or_genesis'});
}

function finalFreezeMissing(finalFreeze={}){
  const missing=[];
  const positive=['genesis_timestamp_ms','live_activation_height'];
  for(const key of positive){const n=Number(finalFreeze[key]);if(!Number.isSafeInteger(n)||n<=0)missing.push(key);}
  const h64=['initial_target_hex','release_artifact_sha256','release_manifest_sha256','release_config_sha256'];
  for(const key of h64)if(!/^[0-9a-f]{64}$/.test(String(finalFreeze[key]??'').toLowerCase()))missing.push(key);
  const h40=['release_source_commit','release_source_tree'];
  for(const key of h40)if(!/^[0-9a-f]{40}$/.test(String(finalFreeze[key]??'').toLowerCase()))missing.push(key);
  if(!String(finalFreeze.genesis_miner_address??'').trim())missing.push('genesis_miner_address');
  if(!finalFreeze.bootstrap_requirements||typeof finalFreeze.bootstrap_requirements!=='object'||Array.isArray(finalFreeze.bootstrap_requirements))missing.push('bootstrap_requirements');
  if(!Array.isArray(finalFreeze.bootstrap_nodes)||finalFreeze.bootstrap_nodes.length===0)missing.push('bootstrap_nodes');
  return missing;
}

export function evaluateLaunchChecklist({software={},externalEvidence={},finalFreeze={}}={}){
  const softwareKeys=['release_reproducible','release_binding_verified','genesis_rehearsed','bootstrap_ready','peer_convergence','rollback_rehearsed'];
  const softwareMissing=softwareKeys.filter(key=>software[key]!==true);
  const externalMissing=REQUIRED_EXTERNAL_EVIDENCE.filter(key=>externalEvidence[key]!==true);
  const freezeMissing=finalFreezeMissing(finalFreeze);
  return Object.freeze({
    status:MAINNET_REHEARSAL_STATUS,
    software_ready:softwareMissing.length===0,software_missing:softwareMissing,
    external_evidence_complete:externalMissing.length===0,external_missing:externalMissing,
    final_freeze_complete:freezeMissing.length===0,final_freeze_missing:freezeMissing,
    candidate_to_authoritative:false,mainnet_launch_authorized:false,automatic_go_path:false,
    decision:'HOLD_FINAL_EXPLICIT_AUTHORIZATION'
  });
}

export function buildMainnetRehearsalPackage({releaseBinding,config,genesis,bootstrap,software,externalEvidence={}}={}){
  const binding=assertVerifiedReleaseBinding(releaseBinding);
  if(!config||!genesis||!bootstrap)throw new Error('rehearsal_package_inputs_required');
  assertReleaseFreeze(config,binding);
  const configDigest=sha256Bytes(Buffer.from(stable(config)));
  const startup=buildStartupPlan({releaseBinding:binding,configDigest,genesisCommitment:genesis.genesis_commitment});
  const checklist=evaluateLaunchChecklist({software,externalEvidence,finalFreeze:config});
  const body={
    format:MAINNET_REHEARSAL_FORMAT,status:MAINNET_REHEARSAL_STATUS,
    release_binding:binding,config_digest:configDigest,economics_candidate:MAINNET_REHEARSAL_ECONOMICS,
    genesis,bootstrap,startup_sequence:startup,checklist,
    authority:Object.freeze({candidate_to_authoritative:false,mainnet_launch_authorized:false,automatic_go_path:false})
  };
  return Object.freeze({...body,package_digest:sha256Bytes(Buffer.from(stable(body)))});
}
