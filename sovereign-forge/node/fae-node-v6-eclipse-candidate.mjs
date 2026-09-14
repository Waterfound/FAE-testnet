#!/usr/bin/env node
'use strict';

import http from 'node:http';
import {dirname,resolve} from 'node:path';
import {createAuthoritativeV4PeerNodeEclipseCandidate} from './authoritative/fae-v4-peer-node-eclipse-candidate.mjs';
import {prepareIndependentNodeStorage} from './authoritative/node-state-recovery.mjs';
import {freezeActivationPolicy} from './authoritative/activation-reorg-candidate.mjs';
import {activationPolicyDescriptor,assertActivationPolicyCompatible} from './authoritative/activation-policy-identity-candidate.mjs';

function activation(value){if(value===undefined||value===null||String(value).trim()==='')return null;const height=Number(value);if(!Number.isSafeInteger(height)||height<1)throw new Error('FAE_PPLNS_COINBASE_ACTIVATION_HEIGHT must be a positive integer or unset');return height}
function daaCandidateActivation(value){if(value===undefined||value===null||String(value).trim()==='')return null;const height=Number(value);if(!Number.isSafeInteger(height)||height<2)throw new Error('FAE_DAA_CANDIDATE_ACTIVATION_HEIGHT must be an integer >= 2 or unset');return height}
function integer(value,fallback,{min=0,max=Number.MAX_SAFE_INTEGER}={}){if(value===undefined||value===null||String(value).trim()==='')return fallback;const parsed=Number(value);if(!Number.isSafeInteger(parsed)||parsed<min||parsed>max)throw new Error(`Invalid integer environment value: ${value}`);return parsed}
function peerArray(value,name){if(value===undefined||value===null||String(value).trim()==='')return[];let parsed;try{parsed=JSON.parse(value)}catch{throw new Error(`${name} must be valid JSON`)}if(!Array.isArray(parsed))throw new Error(`${name} must be a JSON array`);return parsed}
function loopbackHost(value){const host=String(value||'127.0.0.1').trim().toLowerCase();if(!['127.0.0.1','::1','localhost'].includes(host))throw new Error('FAE_ECLIPSE_OPERATOR_HOST must remain loopback-only');return host}
function json(res,status,body){const data=JSON.stringify(body);res.writeHead(status,{'content-type':'application/json','content-length':Buffer.byteLength(data),'cache-control':'no-store'});res.end(data)}

if(String(process.env.FAE_PEERS||'').trim())throw new Error('FAE_PEERS is endpoint-only and is not accepted by the eclipse candidate; use identity-bound FAE_ECLIPSE_KNOWN_PEERS_JSON');

const host=process.env.FAE_HOST||'0.0.0.0';
const port=integer(process.env.FAE_PORT,8787,{min:1,max:65535});
const dataFile=resolve(process.env.FAE_DATA_FILE||'./data/fae-v6-eclipse-state.json');
const dataDir=dirname(dataFile);
const durableFile=resolve(process.env.FAE_DURABLE_STATE_FILE||`${dataFile}.durable`);
const identityFile=resolve(process.env.FAE_IDENTITY_FILE||`${dataDir}/fae-node-identity.json`);
const peerTrustFile=resolve(process.env.FAE_PEER_TRUST_FILE||`${dataDir}/fae-peer-trust.json`);
const knownPeers=peerArray(process.env.FAE_ECLIPSE_KNOWN_PEERS_JSON,'FAE_ECLIPSE_KNOWN_PEERS_JSON');
const pinnedPeers=peerArray(process.env.FAE_ECLIPSE_PINNED_PEERS_JSON,'FAE_ECLIPSE_PINNED_PEERS_JSON');
const publicUrl=(process.env.FAE_PUBLIC_URL||'').trim()||null;
const activationHeight=activation(process.env.FAE_PPLNS_COINBASE_ACTIVATION_HEIGHT);
const daaCandidateActivationHeight=daaCandidateActivation(process.env.FAE_DAA_CANDIDATE_ACTIVATION_HEIGHT);
const daaCandidatePolicy=daaCandidateActivationHeight===null?null:freezeActivationPolicy({activationHeight:daaCandidateActivationHeight});
const daaCandidateDescriptor=daaCandidatePolicy?activationPolicyDescriptor(daaCandidatePolicy):null;
const syncEnabled=process.env.FAE_SYNC!=='0';
const syncIntervalMs=syncEnabled?integer(process.env.FAE_SYNC_MS,15000,{min:5000,max:24*60*60_000}):0;
const durableCheckpointMs=integer(process.env.FAE_DURABLE_CHECKPOINT_MS,5000,{min:1000,max:24*60*60_000});
const operatorHost=loopbackHost(process.env.FAE_ECLIPSE_OPERATOR_HOST);
const operatorPort=integer(process.env.FAE_ECLIPSE_OPERATOR_PORT,8790,{min:1,max:65535});
const peerDiversityOptions={
  minDistinctIdentities:integer(process.env.FAE_MIN_DISTINCT_PEER_IDENTITIES,3,{min:0,max:64}),
  minDistinctNetworkGroups:integer(process.env.FAE_MIN_DISTINCT_NETWORK_GROUPS,3,{min:0,max:64}),
  minPinnedIdentities:integer(process.env.FAE_MIN_PINNED_PEER_IDENTITIES,1,{min:0,max:64}),
  maxPerNetworkGroup:integer(process.env.FAE_MAX_PEERS_PER_NETWORK_GROUP,2,{min:1,max:64})
};
const eclipseDiscoveryOptions={
  maxRecords:integer(process.env.FAE_ECLIPSE_MAX_RECORDS,512,{min:8,max:16384}),
  maxEndpointsPerIdentity:integer(process.env.FAE_ECLIPSE_MAX_ENDPOINTS_PER_IDENTITY,4,{min:1,max:32}),
  maxProbeBatch:integer(process.env.FAE_ECLIPSE_MAX_PROBE_BATCH,32,{min:1,max:256}),
  failureBackoffMs:integer(process.env.FAE_ECLIPSE_FAILURE_BACKOFF_MS,5000,{min:100,max:60*60_000}),
  maxFailureBackoffMs:integer(process.env.FAE_ECLIPSE_MAX_FAILURE_BACKOFF_MS,5*60_000,{min:100,max:24*60*60_000}),
  healthyReprobeMs:integer(process.env.FAE_ECLIPSE_HEALTHY_REPROBE_MS,60_000,{min:1000,max:24*60*60_000})
};
if(eclipseDiscoveryOptions.maxFailureBackoffMs<eclipseDiscoveryOptions.failureBackoffMs)throw new Error('FAE_ECLIPSE_MAX_FAILURE_BACKOFF_MS must be >= FAE_ECLIPSE_FAILURE_BACKOFF_MS');

const recovery=await prepareIndependentNodeStorage({dataFile,durableFile,activationHeight});
const node=createAuthoritativeV4PeerNodeEclipseCandidate({
  host,port,dataFile,identityFile,peerTrustFile,knownPeers,pinnedPeers,publicUrl,activationHeight,syncIntervalMs,
  peerDiversityOptions,eclipseDiscoveryOptions,
  secureChannelOptions:{contextBinding:daaCandidateDescriptor?.policy_id??null},
  peerHelloExtensions:daaCandidateDescriptor?{daa_activation_policy:daaCandidateDescriptor}:null,
  peerHelloValidator:daaCandidatePolicy?(hello=>assertActivationPolicyCompatible(daaCandidatePolicy,hello?.daa_activation_policy)):null
});

let stopping=false,checkpointRunning=false,checkpointTimer=null,operatorServer=null;
async function checkpoint(reason){
  if(checkpointRunning)return{saved:false,reason:'checkpoint_in_progress'};
  checkpointRunning=true;
  try{const result=await recovery.checkpoint(node.getState());if(result.saved)console.log(JSON.stringify({event:'fae-durable-checkpoint',reason,generation:result.generation,state_hash:result.state_hash}));return result}finally{checkpointRunning=false}
}
function operatorStatus(){return{candidate:'peer-isolation-eclipse-v1',authority:'operator-observation-only',...node.status(),durable_state:recovery.status()}}
function createOperatorServer(){return http.createServer((req,res)=>{
  if(req.method!=='GET'){json(res,405,{ok:false,error:'method_not_allowed'});return}
  if(req.url==='/healthz'){json(res,200,{ok:true,process:'alive',candidate:'peer-isolation-eclipse-v1'});return}
  if(req.url==='/readyz'){const status=node.status(),ready=status.peer_diversity?.ready===true;json(res,ready?200:503,{ok:ready,state:status.peer_diversity?.state||'HOLD',peer_diversity:status.peer_diversity,height:status.height,tip_hash:status.tip_hash});return}
  if(req.url==='/status'){json(res,200,operatorStatus());return}
  json(res,404,{ok:false,error:'not_found'});
})}
async function closeOperator(){if(!operatorServer)return;const current=operatorServer;operatorServer=null;await new Promise(resolve=>current.close(()=>resolve()))}
async function stop(signal){
  if(stopping)return;stopping=true;
  if(checkpointTimer)clearInterval(checkpointTimer);
  console.log(`[FAE] ${signal}: shutting down eclipse candidate`);
  try{await checkpoint('shutdown');await closeOperator();await node.close();process.exitCode=0}catch(error){console.error('[FAE] eclipse candidate shutdown error',error);process.exitCode=1}
}
process.on('SIGINT',()=>void stop('SIGINT'));
process.on('SIGTERM',()=>void stop('SIGTERM'));
process.on('unhandledRejection',error=>{console.error('[FAE] unhandled rejection',error);process.exitCode=1});
process.on('uncaughtException',error=>{console.error('[FAE] uncaught exception',error);process.exitCode=1});

await node.start();
operatorServer=createOperatorServer();
await new Promise((resolve,reject)=>{operatorServer.once('error',reject);operatorServer.listen(operatorPort,operatorHost,resolve)});
await checkpoint('startup');
let initialSync=[];
if(syncEnabled&&(knownPeers.length||pinnedPeers.length)){initialSync=await node.syncPeers();await checkpoint('post-initial-sync')}
const status=node.status();
console.log(JSON.stringify({
  event:'fae-eclipse-candidate-online',candidate:'peer-isolation-eclipse-v1',node_version:status.node_version,protocol_version:status.protocol_version,network:status.network,
  node_identity:status.node_identity,genesis_hash:status.genesis_hash,height:status.height,tip_hash:status.tip_hash,listen:{host,port},
  operator:{host:operatorHost,port:operatorPort,read_only:true},public_url:publicUrl,configured_known_peers:knownPeers.length,configured_pinned_peers:pinnedPeers.length,
  peer_diversity:status.peer_diversity,peer_view_authority:status.peer_view_authority,initial_sync:initialSync,
  pplns_coinbase_activation_height:status.pplns_coinbase_activation_height,
  daa_candidate_activation_policy:daaCandidateDescriptor?{policy_id:daaCandidateDescriptor.policy_id,activation_height:daaCandidateDescriptor.activation_height}:null,
  durable_state:recovery.status()
}));
checkpointTimer=setInterval(()=>checkpoint('interval').catch(error=>console.error('[FAE] durable checkpoint error',error)),durableCheckpointMs);
checkpointTimer.unref?.();
