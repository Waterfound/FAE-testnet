#!/usr/bin/env node
import {createHash,randomUUID} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,readFile,rm,stat,writeFile} from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const repoRoot=fileURLToPath(new URL('../..',import.meta.url));
const entrypoint=resolve(repoRoot,'sovereign-forge/node/fae-node-v6-candidate.mjs');
const contract=JSON.parse(await readFile(fileURLToPath(new URL('./acceptance-contract.json',import.meta.url)),'utf8'));
const SHA256=/^[0-9a-f]{64}$/;

function sha256(bytes){return createHash('sha256').update(bytes).digest('hex')}
function deriveChallenge(root,phase){return sha256(Buffer.from(`${root}:${phase}`))}
function delay(ms){return new Promise(resolve=>setTimeout(resolve,ms))}
function git(args){return execFileSync('git',args,{cwd:repoRoot,encoding:'utf8'}).trim()}
async function freePort(){
  const server=net.createServer();
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
  const port=server.address().port;
  await new Promise(resolve=>server.close(resolve));
  return port;
}
async function json(url,options={}){
  const response=await fetch(url,{...options,signal:options.signal||AbortSignal.timeout(10000)});
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(`${response.status} ${url}: ${JSON.stringify(body)}`);
  return body;
}
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
async function waitUntil(check,{timeoutMs=30000,intervalMs=100,label='condition'}={}){
  const deadline=Date.now()+timeoutMs;
  let last;
  while(Date.now()<deadline){
    try{const value=await check();if(value)return value;last=null}catch(error){last=error}
    await delay(intervalMs);
  }
  throw new Error(`timeout waiting for ${label}: ${last?.message||'not satisfied'}`);
}
function startNode({port,runtimeDir,peer}){
  const env={
    ...process.env,
    FAE_HOST:'127.0.0.1',
    FAE_PORT:String(port),
    FAE_DATA_FILE:join(runtimeDir,'state.json'),
    FAE_DURABLE_STATE_FILE:join(runtimeDir,'state.durable.json'),
    FAE_IDENTITY_FILE:join(runtimeDir,'identity.json'),
    FAE_PEER_TRUST_FILE:join(runtimeDir,'peer-trust.json'),
    FAE_PEERS:peer,
    FAE_SYNC:'1',
    FAE_SYNC_MS:'5000',
    FAE_DURABLE_CHECKPOINT_MS:'1000'
  };
  const child=spawn(process.execPath,[entrypoint],{cwd:repoRoot,env,stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';
  child.stdout.on('data',chunk=>stdout+=chunk);
  child.stderr.on('data',chunk=>stderr+=chunk);
  child.logs=()=>({stdout,stderr});
  return child;
}
async function stopNode(child){
  if(!child||child.exitCode!==null||child.signalCode!==null)return;
  const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
  child.kill('SIGTERM');
  const result=await Promise.race([exited,delay(10000).then(()=>null)]);
  if(!result){child.kill('SIGKILL');throw new Error('node did not stop after SIGTERM')}
  if(result.code!==0)throw new Error(`node exited nonzero during controlled restart: ${JSON.stringify(result)}`);
}
async function ready(base){
  return waitUntil(async()=>{
    const status=await json(`${base}/status`);
    if(status.network!==contract.target_network.network||status.genesis_hash!==contract.target_network.genesis_hash)return null;
    if(Number(status.protocol_version)<contract.target_network.minimum_p2p_protocol_version)return null;
    const diversity=await json(`${base}/peer-diversity`);
    if(Number(diversity.authenticated_peers?.length||0)<1)return null;
    return{status,diversity};
  },{timeoutMs:60000,intervalMs:100,label:'node sync + authenticated peer'});
}
async function signedHello(base,challenge){
  return json(`${base}/peer/hello?challenge=${challenge}`);
}
async function writeJson(path,value){await writeFile(path,JSON.stringify(value,null,2)+'\n')}
async function buildManifest(outDir,runId){
  const required=contract.required_bundle_files.filter(x=>x!=='manifest.json');
  const files=[];
  for(const rel of required){
    const path=resolve(outDir,rel),bytes=await readFile(path),info=await stat(path);
    files.push({path:rel,sha256:sha256(bytes),size:info.size});
  }
  return{schema:'FAE_IOR_EVIDENCE_MANIFEST_V1',contract_id:contract.contract_id,run_id:runId,created_at:new Date().toISOString(),files};
}

export async function runOperator({
  peer,
  outDir,
  expectedSourceRevision,
  runChallenge,
  operatorId,
  evidenceClass='EXTERNAL_OPERATOR_RUN',
  attestation,
  tipProgressTimeoutMs=900000,
  onInitialObservation=null
}={}){
  if(!peer||!outDir||!expectedSourceRevision||!runChallenge||!operatorId)throw new Error('peer, outDir, expectedSourceRevision, runChallenge and operatorId are required');
  if(!SHA256.test(runChallenge))throw new Error('runChallenge must be 64 lowercase hex characters');
  if(!['READINESS_REHEARSAL_ONLY','EXTERNAL_OPERATOR_RUN'].includes(evidenceClass))throw new Error('unsupported evidenceClass');
  const peerUrl=new URL(peer);
  if(!['http:','https:'].includes(peerUrl.protocol)||peerUrl.username||peerUrl.password)throw new Error('peer must be a credential-free HTTP(S) URL');
  const normalizedPeer=peerUrl.toString().replace(/\/$/,'');
  const sourceRevision=git(['rev-parse','HEAD']),sourceTree=git(['rev-parse','HEAD^{tree}']);
  if(sourceRevision!==expectedSourceRevision)throw new Error(`source_revision_mismatch: expected ${expectedSourceRevision}, observed ${sourceRevision}`);
  const sourceStatus=git(['status','--porcelain']);
  if(sourceStatus!=='')throw new Error('source_worktree_not_clean_at_start');
  const repository=git(['config','--get','remote.origin.url'])||'unknown';

  const out=resolve(outDir);
  try{await stat(out);throw new Error('outDir must not already exist')}catch(error){if(error.code!=='ENOENT')throw error}
  await mkdir(resolve(out,'logs'),{recursive:true});
  const runtimeDir=await mkdtemp(join(os.tmpdir(),'fae-ior-runtime-'));
  const runId=randomUUID(),startedAt=new Date().toISOString(),port=await freePort(),base=`http://127.0.0.1:${port}`;
  let child=null,combinedLog='';

  try{
    child=startNode({port,runtimeDir,peer:normalizedPeer});
    const first=await ready(base);
    const firstAt=new Date().toISOString();
    const startupPeerIds=(first.diversity.authenticated_peers||[]).map(x=>x.identityId).filter(Boolean).sort();
    const startupHello=await signedHello(base,deriveChallenge(runChallenge,'startup'));
    const tips=[
      {at:firstAt,phase:'startup',height:Number(first.status.height),tip_hash:first.status.tip_hash},
    ];
    await delay(150);
    const secondStatus=await json(`${base}/status`);
    tips.push({at:new Date().toISOString(),phase:'startup-confirmation',height:Number(secondStatus.height),tip_hash:secondStatus.tip_hash});

    if(onInitialObservation)await onInitialObservation({status:first.status,base,peer:normalizedPeer});

    const progressed=await waitUntil(async()=>{
      const status=await json(`${base}/status`);
      if(Number(status.height)>Number(first.status.height))return status;
      return null;
    },{timeoutMs:tipProgressTimeoutMs,intervalMs:250,label:'tip progression'});
    tips.push({at:new Date().toISOString(),phase:'progressed',height:Number(progressed.height),tip_hash:progressed.tip_hash});
    const preRestart={node_identity:progressed.node_identity,height:Number(progressed.height),tip_hash:progressed.tip_hash};
    combinedLog+=`=== first process ===\n${child.logs().stdout}\n=== stderr ===\n${child.logs().stderr}\n`;
    await stopNode(child);child=null;

    child=startNode({port,runtimeDir,peer:normalizedPeer});
    const second=await ready(base);
    const restartPeerIds=(second.diversity.authenticated_peers||[]).map(x=>x.identityId).filter(Boolean).sort();
    const restartHello=await signedHello(base,deriveChallenge(runChallenge,'restart'));
    tips.push({at:new Date().toISOString(),phase:'restart',height:Number(second.status.height),tip_hash:second.status.tip_hash});
    const postRestart={node_identity:second.status.node_identity,height:Number(second.status.height),tip_hash:second.status.tip_hash};
    combinedLog+=`=== restart process ===\n${child.logs().stdout}\n=== stderr ===\n${child.logs().stderr}\n`;
    await stopNode(child);child=null;

    const durablePresent=await stat(join(runtimeDir,'state.durable.json')).then(x=>x.isFile()).catch(()=>false);
    const endedAt=new Date().toISOString();
    const operatorRun={
      schema:'FAE_IOR_OPERATOR_RUN_V1',contract_id:contract.contract_id,run_id:runId,evidence_class:evidenceClass,
      operator_id:operatorId,run_challenge:runChallenge,peer_endpoint:normalizedPeer,started_at:startedAt,ended_at:endedAt,completed:true
    };
    const environment={
      schema:'FAE_IOR_ENVIRONMENT_V1',platform:process.platform,arch:process.arch,node_version:process.version,
      fresh_state_directory:true,preinitialized_database:false,runtime_state_directory_disposable:true
    };
    const source={
      schema:'FAE_IOR_SOURCE_PROVENANCE_V1',repository,source_revision:sourceRevision,source_tree:sourceTree,
      worktree_clean_at_start:true
    };
    const bootstrap={
      schema:'FAE_IOR_BOOTSTRAP_V1',peer_endpoint:normalizedPeer,explicit_peer_input:true,preinitialized_database:false,
      bootstrap_started_at:startedAt,initial_sync_complete:true,initial_authenticated_peers:startupPeerIds.length
    };
    const network={
      schema:'FAE_IOR_NETWORK_IDENTITY_V1',network:first.status.network,genesis_hash:first.status.genesis_hash,
      node_identity:first.status.node_identity,protocol_version:first.status.protocol_version,
      signed_challenges:{startup:startupHello,restart:restartHello}
    };
    const peerEvidence={
      schema:'FAE_IOR_PEER_OBSERVATIONS_V1',observations:[
        {at:firstAt,phase:'startup',authenticated_peers:startupPeerIds.length,peer_identities:startupPeerIds},
        {at:tips.at(-1).at,phase:'restart',authenticated_peers:restartPeerIds.length,peer_identities:restartPeerIds}
      ]
    };
    const tipEvidence={schema:'FAE_IOR_TIP_OBSERVATIONS_V1',observations:tips};
    const restart={
      schema:'FAE_IOR_RESTART_RECOVERY_V1',controlled_restart:true,pre_restart:preRestart,post_restart:postRestart,
      same_node_identity:preRestart.node_identity===postRestart.node_identity,
      state_recovered:postRestart.height>=preRestart.height&&durablePresent,
      peer_recovered:restartPeerIds.length>=1,manual_state_surgery:false,durable_state_present:durablePresent
    };
    const defaultAttestation=evidenceClass==='READINESS_REHEARSAL_ONLY'?{
      mode:'SIMULATED_CLEAN_ROOM',operator_independence_claimed:false
    }:{
      mode:'EXTERNAL_SELF_ATTESTATION',operator_independence_claimed:true
    };
    const operatorAttestation={
      schema:'FAE_IOR_OPERATOR_ATTESTATION_V1',operator_id:operatorId,...defaultAttestation,...(attestation||{}),
      used_waterfound_machine:false,used_waterfound_shell:false,used_waterfound_private_credentials:false,
      used_preinitialized_database:false,received_undocumented_interactive_help:false,copied_prior_evidence:false
    };

    await writeJson(resolve(out,'operator-run.json'),operatorRun);
    await writeJson(resolve(out,'environment.json'),environment);
    await writeJson(resolve(out,'source-provenance.json'),source);
    await writeJson(resolve(out,'bootstrap.json'),bootstrap);
    await writeJson(resolve(out,'network-identity.json'),network);
    await writeJson(resolve(out,'peer-observations.json'),peerEvidence);
    await writeJson(resolve(out,'tip-observations.json'),tipEvidence);
    await writeJson(resolve(out,'restart-recovery.json'),restart);
    await writeJson(resolve(out,'operator-attestation.json'),operatorAttestation);
    await writeFile(resolve(out,'logs/node.log'),combinedLog||'node log capture empty\n');
    await writeJson(resolve(out,'manifest.json'),await buildManifest(out,runId));

    return{bundle_dir:out,run_id:runId,source_revision:sourceRevision,evidence_class:evidenceClass,operator_id:operatorId,run_challenge:runChallenge};
  }finally{
    if(child)await stopNode(child).catch(()=>child.kill('SIGKILL'));
    await rm(runtimeDir,{recursive:true,force:true});
  }
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const args=parseArgs(process.argv.slice(2));
  const evidenceClass=args['evidence-class']||'EXTERNAL_OPERATOR_RUN';
  if(evidenceClass==='EXTERNAL_OPERATOR_RUN'&&!args['attest-independent'])throw new Error('EXTERNAL_OPERATOR_RUN requires --attest-independent self-attestation');
  const result=await runOperator({
    peer:args.peer,
    outDir:args.out,
    expectedSourceRevision:args['expected-source-revision'],
    runChallenge:args.challenge,
    operatorId:args['operator-id'],
    evidenceClass,
    tipProgressTimeoutMs:Number(args['tip-timeout-ms']||900000)
  });
  console.log(JSON.stringify(result,null,2));
}
