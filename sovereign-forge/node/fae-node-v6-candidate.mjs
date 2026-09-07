#!/usr/bin/env node
'use strict';

import {dirname,resolve} from 'node:path';
import {createAuthoritativeV4PeerNode} from './authoritative/fae-v4-peer-node.mjs';

function list(value){return[...new Set(String(value||'').split(',').map(item=>item.trim()).filter(Boolean))]}
function activation(value){if(value===undefined||value===null||String(value).trim()==='')return null;const height=Number(value);if(!Number.isSafeInteger(height)||height<1)throw new Error('FAE_PPLNS_COINBASE_ACTIVATION_HEIGHT must be a positive integer or unset');return height}
function integer(value,fallback,{min=0,max=Number.MAX_SAFE_INTEGER}={}){if(value===undefined||value===null||String(value).trim()==='')return fallback;const parsed=Number(value);if(!Number.isSafeInteger(parsed)||parsed<min||parsed>max)throw new Error(`Invalid integer environment value: ${value}`);return parsed}

const host=process.env.FAE_HOST||'0.0.0.0';
const port=integer(process.env.FAE_PORT,8787,{min:1,max:65535});
const dataFile=resolve(process.env.FAE_DATA_FILE||'./data/fae-v6-state.json');
const dataDir=dirname(dataFile);
const identityFile=resolve(process.env.FAE_IDENTITY_FILE||`${dataDir}/fae-node-identity.json`);
const peerTrustFile=resolve(process.env.FAE_PEER_TRUST_FILE||`${dataDir}/fae-peer-trust.json`);
const peers=list(process.env.FAE_PEERS);
const pinnedPeerIdentityIds=list(process.env.FAE_PINNED_PEER_IDENTITIES);
const publicUrl=(process.env.FAE_PUBLIC_URL||'').trim()||null;
const activationHeight=activation(process.env.FAE_PPLNS_COINBASE_ACTIVATION_HEIGHT);
const syncEnabled=process.env.FAE_SYNC!=='0';
const syncIntervalMs=syncEnabled?integer(process.env.FAE_SYNC_MS,15000,{min:5000,max:24*60*60_000}):0;
const peerDiversityOptions={
  minDistinctIdentities:integer(process.env.FAE_MIN_DISTINCT_PEER_IDENTITIES,3,{min:0,max:64}),
  minDistinctNetworkGroups:integer(process.env.FAE_MIN_DISTINCT_NETWORK_GROUPS,3,{min:0,max:64}),
  minPinnedIdentities:integer(process.env.FAE_MIN_PINNED_PEER_IDENTITIES,1,{min:0,max:64}),
  maxPerNetworkGroup:integer(process.env.FAE_MAX_PEERS_PER_NETWORK_GROUP,2,{min:1,max:64})
};

const node=createAuthoritativeV4PeerNode({
  host,port,dataFile,identityFile,peerTrustFile,peers,publicUrl,activationHeight,syncIntervalMs,
  pinnedPeerIdentityIds,peerDiversityOptions
});

let stopping=false;
async function stop(signal){if(stopping)return;stopping=true;console.log(`[FAE] ${signal}: shutting down`);try{await node.close();process.exitCode=0}catch(error){console.error('[FAE] shutdown error',error);process.exitCode=1}}
process.on('SIGINT',()=>void stop('SIGINT'));
process.on('SIGTERM',()=>void stop('SIGTERM'));
process.on('unhandledRejection',error=>{console.error('[FAE] unhandled rejection',error);process.exitCode=1});
process.on('uncaughtException',error=>{console.error('[FAE] uncaught exception',error);process.exitCode=1});

await node.start();
const status=node.status();
console.log(JSON.stringify({event:'fae-node-online',node_version:status.node_version,protocol_version:status.protocol_version,network:status.network,node_identity:status.node_identity,genesis_hash:status.genesis_hash,height:status.height,tip_hash:status.tip_hash,listen:{host,port},public_url:publicUrl,configured_peers:peers.length,peer_diversity:status.peer_diversity,pplns_coinbase_activation_height:status.pplns_coinbase_activation_height}));
if(syncEnabled&&peers.length){const initial=await node.syncPeers();console.log(JSON.stringify({event:'fae-initial-sync',results:initial,status:node.status()}))}
