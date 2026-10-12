import http from 'node:http';
import {randomBytes} from 'node:crypto';
import {mkdir,readFile,rename,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {
  NETWORK,ZERO_HASH,TARGET_SECONDS,MAX_SUPPLY,HALVING_ERA_BLOCKS,LEGACY_TESTNET_HASHES,
  emptyState,cloneState,tip,issued,formatAtoms,nextDifficulty,chainWork,
  publicBlock,blockHeaderRecord,validateHeaderSequence,
  appendBlockFromFeed,appendBlockFromSubmission,createMiningTemplate,createDistributedTemplate,
  acceptTxInto,normalizeTx,balanceAtoms,spendableOutputs,
  preferred,reconcileDetachedTransactions
} from './fae-v4-core.mjs';
import {PPLNS_COINBASE_ACTIVATION_HEIGHT} from './pplns-activation.mjs';
import {loadOrCreateNodeIdentity,signEnvelope,verifyEnvelope} from './node-identity.mjs';
import {PeerTrustStore} from './peer-trust.mjs';
import {PeerGuard} from './peer-guard.mjs';
import {SecureChannelHub,establishSecurePeerSession} from './secure-channel.mjs';
import {CoordinatorRegistry} from './coordinator-registry.mjs';
import {PeerDiversityPolicy} from './peer-diversity.mjs';
import {PeerDirectory,createPeerDescriptor} from './peer-directory.mjs';

export const AUTHORITATIVE_P2P_PROTOCOL_VERSION=6;
export const AUTHORITATIVE_NODE_VERSION='independent-0.3.0-candidate';
export const CANONICAL_GENESIS_HASH=LEGACY_TESTNET_HASHES[1];
const MAX_PEERS=64;
const MAX_HEADERS_PAGE=2000;
const MAX_BLOCKS_PAGE=128;
const MAX_BRANCH_BLOCKS=50_000;
const MAX_COORDINATOR_PAGE=256;
const MAX_PEER_DESCRIPTOR_PAGE=128;
const MAX_DISCOVERY_PROBES=32;
const MAX_SYNC_SELECTION=8;
const MAX_JSON_BODY=2*1024*1024;
const MAX_PEER_HELLO_EXTENSION_BYTES=64*1024;
const NODE_CAPABILITIES=['headers-first','common-ancestor-v1','signed-peer-framing-v1','encrypted-peer-channel-v1','cumulative-work','deterministic-equal-work-tiebreak','serialized-chain-adoption','reorg-mempool-recovery','recovered-tx-repropagation','coordinator-gossip-v1','peer-descriptor-gossip-v1','peer-diversity-selection-v1'];
const PEER_HELLO_RESERVED_FIELDS=new Set(['challenge','software','protocol_version','network','genesis','height','tip_hash','chain_work','capabilities']);

function normalizePeer(peer){
  const url=new URL(String(peer));
  if(url.protocol!=='http:'&&url.protocol!=='https:')throw new Error('Peer URL must use HTTP or HTTPS');
  url.hash='';url.search='';
  return url.toString().replace(/\/$/,'');
}
function normalizePeers(peers){
  if(!Array.isArray(peers))throw new Error('Peers must be an array');
  if(peers.length>MAX_PEERS)throw new Error('Too many configured peers');
  const normalized=[...new Set(peers.map(normalizePeer))];
  if(normalized.length!==peers.length)throw new Error('Duplicate configured peers are not allowed');
  return normalized;
}
function normalizePeerHelloExtensions(value){
  if(value===null||value===undefined)return null;
  if(typeof value!=='object'||Array.isArray(value))throw new Error('peer_hello_extensions_must_be_object');
  for(const key of Object.keys(value))if(PEER_HELLO_RESERVED_FIELDS.has(key))throw new Error(`peer_hello_extension_reserved:${key}`);
  let encoded;try{encoded=JSON.stringify(value)}catch{throw new Error('peer_hello_extensions_not_json_serializable')}
  if(encoded===undefined||Buffer.byteLength(encoded)>MAX_PEER_HELLO_EXTENSION_BYTES)throw new Error('peer_hello_extensions_too_large');
  const cloned=JSON.parse(encoded);if(!cloned||typeof cloned!=='object'||Array.isArray(cloned))throw new Error('peer_hello_extensions_must_be_object');return Object.freeze(cloned);
}
function boundedInt(value,fallback,min,max){const parsed=Number.parseInt(value??'',10);return Number.isFinite(parsed)?Math.max(min,Math.min(max,parsed)):fallback}
async function readJson(req,maxBytes=MAX_JSON_BODY){let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>maxBytes)throw new Error('body_too_large')}return text?JSON.parse(text):{}}
function headers(){return{'content-type':'application/json; charset=utf-8','cache-control':'no-store','access-control-allow-origin':'*','access-control-allow-headers':'content-type','access-control-allow-methods':'GET,POST,OPTIONS'}}
function send(res,status,payload){res.writeHead(status,headers());res.end(status===204?'':JSON.stringify(payload))}
async function fetchJson(url,init={},timeoutMs=8000){const response=await fetch(url,{...init,signal:init.signal??AbortSignal.timeout(timeoutMs),headers:{'content-type':'application/json',...(init.headers||{})}});const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.error??`peer_http_${response.status}`);return body}

function blockAtHeight(state,height){if(height===0)return{height:0,hash:ZERO_HASH};const block=state.chain[height-1];return block&&Number(block.height)===height?block:null}
export function blockLocator(state){
  const height=tip(state)?.height??0,locator=[];let cursor=Number(height),step=1,linear=0;
  while(cursor>0&&locator.length<64){const block=blockAtHeight(state,cursor);if(block)locator.push({height:cursor,hash:block.hash});if(linear<10){cursor-=1;linear++}else{cursor-=step;step=Math.min(step*2,1<<20)}}
  locator.push({height:0,hash:ZERO_HASH});return locator;
}
export function findCommonAncestor(state,locator){
  if(!Array.isArray(locator)||locator.length<1||locator.length>128)throw new Error('invalid_block_locator');
  for(const entry of locator){const height=Number(entry?.height),hash=String(entry?.hash||'');if(!Number.isSafeInteger(height)||height<0||!/^[0-9a-f]{64}$/.test(hash))continue;const local=blockAtHeight(state,height);if(local&&local.hash===hash)return{height,hash}}
  return null;
}
function branchHeaders(state,from,limit){return state.chain.slice(Math.max(0,from-1),Math.max(0,from-1)+limit).map(blockHeaderRecord)}
function branchBlocks(state,from,limit){const blocks=state.chain.slice(Math.max(0,from-1),Math.max(0,from-1)+limit).map(publicBlock),txids=new Set(blocks.flatMap(block=>block.txids||[])),transactions=[...txids].map(id=>state.transactions[id]).filter(Boolean).map(record=>structuredClone(record));return{blocks,transactions}}
function blockSubmission(block){const full={...(block.header_json||{})},nonce=Number(full.nonce??block.nonce);delete full.nonce;return{header:full,nonce,hash:String(block.hash),txids:[...(block.txids||[])],coinbase_outputs:block.coinbase_outputs??null}}

function confirmedMap(state,upToHeight=Infinity){return new Map(Object.values(state.transactions).filter(record=>record?.txid&&record.status==='confirmed'&&Number(record.confirmed_height)<=upToHeight).map(record=>[String(record.txid),structuredClone(record)]))}
export function replayPrefix(source,height,{activationHeight=PPLNS_COINBASE_ACTIVATION_HEIGHT}={}){
  if(!Number.isSafeInteger(height)||height<0||height>(tip(source)?.height??0))throw new Error('invalid_prefix_height');
  let rebuilt=emptyState();const txMap=confirmedMap(source,height);
  for(const block of source.chain.slice(0,height))rebuilt=appendBlockFromFeed(rebuilt,publicBlock(block),txMap,{activationHeight});
  return rebuilt;
}
export function verifyPersistedState(raw,{activationHeight=PPLNS_COINBASE_ACTIVATION_HEIGHT}={}){
  if(!raw||raw.network!==NETWORK||!Array.isArray(raw.chain)||!raw.transactions||typeof raw.transactions!=='object')throw new Error('wrong_state_format_or_network');
  let rebuilt=replayPrefix(raw,raw.chain.length,{activationHeight});
  const pending=Object.values(raw.transactions).filter(record=>record?.txid&&record.status==='pending').sort((a,b)=>Number(a.mempool_seq||0)-Number(b.mempool_seq||0)||String(a.txid).localeCompare(String(b.txid)));
  for(const record of pending)acceptTxInto(rebuilt,{version:2,network:NETWORK,inputs:[...(record.inputs||[])],outputs:(record.outputs||[]).map(o=>({address:String(o.address),amount_atoms:String(o.amount_atoms)})),public_key_spki:String(record.public_key_spki),signature:String(record.signature),txid:String(record.txid),from_address:String(record.from_address),mempool_seq:Number(record.mempool_seq||0),created_at:record.created_at},{fromFeed:true});
  return rebuilt;
}

export function createAuthoritativeV4PeerNode({
  host='127.0.0.1',port=0,dataFile=null,identityFile=null,peerTrustFile=null,peers=[],publicUrl=null,
  initialState=null,activationHeight=PPLNS_COINBASE_ACTIVATION_HEIGHT,syncIntervalMs=0,
  pinnedPeerIdentityIds=[],peerDiversityOptions={},guardOptions={},secureChannelOptions={},
  peerHelloExtensions=null,peerHelloValidator=null
}={}){
  if(peerHelloValidator!==null&&peerHelloValidator!==undefined&&typeof peerHelloValidator!=='function')throw new Error('peer_hello_validator_must_be_function');
  const helloExtensions=normalizePeerHelloExtensions(peerHelloExtensions),helloValidator=peerHelloValidator??null;
  const configuredPeers=normalizePeers(peers),publicEndpoint=publicUrl?normalizePeer(publicUrl):null,identity=loadOrCreateNodeIdentity(identityFile),trust=new PeerTrustStore({path:peerTrustFile,networkId:NETWORK}),guard=new PeerGuard(guardOptions),secureChannels=new SecureChannelHub({identity,networkId:NETWORK,...secureChannelOptions}),coordinators=new CoordinatorRegistry({networkId:NETWORK}),directory=new PeerDirectory({networkId:NETWORK}),diversity=new PeerDiversityPolicy({...peerDiversityOptions,pinnedIdentityIds:pinnedPeerIdentityIds});
  const authenticatedPeers=new Map();
  let state=initialState?verifyPersistedState(initialState,{activationHeight}):emptyState(),writeLock=Promise.resolve(),syncRunning=false,syncTimer=null;
  const resolvedDataFile=dataFile?resolve(dataFile):null;

  function serial(operation){const run=writeLock.then(operation,operation);writeLock=run.catch(()=>{});return run}
  async function persist(){if(!resolvedDataFile)return;await mkdir(dirname(resolvedDataFile),{recursive:true});const tmp=resolvedDataFile+'.tmp';await writeFile(tmp,JSON.stringify(state,null,2));await rename(tmp,resolvedDataFile)}
  async function load(){if(!resolvedDataFile)return;try{const raw=JSON.parse(await readFile(resolvedDataFile,'utf8'));state=verifyPersistedState(raw,{activationHeight})}catch(error){if(error.code!=='ENOENT')throw error}}
  function authenticatedObservations(){return[...authenticatedPeers.values()].map(row=>structuredClone(row))}
  function diversityStatus(){return diversity.evaluate(authenticatedObservations())}
  function refreshSelfDescriptor(){if(!publicEndpoint)return null;const envelope=createPeerDescriptor(identity,{networkId:NETWORK,endpoint:publicEndpoint,capabilities:NODE_CAPABILITIES});directory.register(envelope,{source:'self'});return envelope}
  function status(){const last=tip(state),amount=issued(state),peerDiversity=diversityStatus();return{ok:true,node_version:AUTHORITATIVE_NODE_VERSION,protocol_version:AUTHORITATIVE_P2P_PROTOCOL_VERSION,network:NETWORK,genesis_hash:CANONICAL_GENESIS_HASH,node_identity:identity.id,height:last?Number(last.height):0,tip_hash:last?.hash||ZERO_HASH,difficulty_bits:nextDifficulty(state.chain),target_seconds:TARGET_SECONDS,issued_atoms:amount.toString(),issued_fae:formatAtoms(amount),max_supply_atoms:MAX_SUPPLY.toString(),halving_era_blocks:HALVING_ERA_BLOCKS,chain_work:chainWork(state.chain).toString(),mempool_size:state.mempoolOrder.filter(id=>state.transactions[id]?.status==='pending').length,configured_peers:configuredPeers.length,authenticated_peers:authenticatedPeers.size,discovered_peer_descriptors:directory.observations().length,peer_diversity:peerDiversity,secure_channels:secureChannels.status(),discovered_coordinators:coordinators.list().length,pplns_coinbase_activation_height:activationHeight??null,peer_hello_extension_keys:helloExtensions?Object.keys(helloExtensions).sort():[],capabilities:NODE_CAPABILITIES}}

  async function peerHello(peer,{source='configured',expectedIdentityId=null}={}){const base=normalizePeer(peer),challenge=randomBytes(24).toString('hex'),envelope=await fetchJson(`${base}/peer/hello?challenge=${challenge}`),hello=verifyEnvelope(envelope,{kind:'peer-hello',maxAgeMs:2*60_000});if(hello.challenge!==challenge)throw new Error('peer_hello_challenge_mismatch');if(hello.network!==NETWORK)throw new Error('peer_wrong_network');if(hello.genesis!==CANONICAL_GENESIS_HASH)throw new Error('peer_genesis_mismatch');if(!Number.isInteger(hello.protocol_version)||hello.protocol_version<AUTHORITATIVE_P2P_PROTOCOL_VERSION)throw new Error('peer_protocol_too_old');if(expectedIdentityId&&envelope.signer.id!==expectedIdentityId)throw new Error('peer_descriptor_identity_mismatch');if(helloValidator){const verdict=await helloValidator(hello,{peer:base,signer:envelope.signer});if(verdict===false)throw new Error('peer_hello_extension_rejected');if(verdict&&typeof verdict==='object'&&verdict.ok===false){const error=new Error(verdict.error||'peer_hello_extension_rejected');error.code=verdict.error||'peer_hello_extension_rejected';error.verdict=verdict;throw error}}trust.observe(base,envelope.signer.id,envelope.signer.publicKey);authenticatedPeers.set(base,{endpoint:base,identityId:envelope.signer.id,source});return{...hello,peer_id:envelope.signer.id,base}}
  function verifyPeerFrame(envelope,{kind,peerId}){return verifyEnvelope(envelope,{kind,expectedSignerId:peerId,maxAgeMs:2*60_000})}
  async function peerSession(peer,options={}){const hello=await peerHello(peer,options),session=await establishSecurePeerSession({baseUrl:hello.base,identity,networkId:NETWORK,expectedServerId:hello.peer_id});return{hello,session}}
  async function relayTx(record,{exclude=null}={}){const excluded=exclude?normalizePeer(exclude):null,targets=diversity.select(authenticatedObservations().filter(row=>row.endpoint!==excluded),{limit:MAX_SYNC_SELECTION}).map(row=>row.endpoint);return Promise.allSettled(targets.map(async peer=>{const{session}=await peerSession(peer,{source:authenticatedPeers.get(peer)?.source||'relay'});try{return await session.request('/tx',{method:'POST',body:{tx:normalizeTx(record)}})}finally{session.close()}}))}
  async function relayBlock(block,{exclude=null}={}){const excluded=exclude?normalizePeer(exclude):null,targets=diversity.select(authenticatedObservations().filter(row=>row.endpoint!==excluded),{limit:MAX_SYNC_SELECTION}).map(row=>row.endpoint),submission=blockSubmission(block);return Promise.allSettled(targets.map(async peer=>{const{session}=await peerSession(peer,{source:authenticatedPeers.get(peer)?.source||'relay'});try{return await session.request('/blocks',{method:'POST',body:submission})}finally{session.close()}}))}
  async function fetchPeerHeaders(session,peerId,from,target){const headers=[];for(let cursor=from;cursor<=target;){const limit=Math.min(MAX_HEADERS_PAGE,target-cursor+1),envelope=await session.request(`/headers?from=${cursor}&limit=${limit}`),page=verifyPeerFrame(envelope,{kind:'headers-page',peerId});if(Number(page.from)!==cursor||!Array.isArray(page.headers)||page.headers.length<1)throw new Error('peer_incomplete_headers');headers.push(...page.headers);cursor+=page.headers.length;if(headers.length>MAX_BRANCH_BLOCKS)throw new Error('peer_branch_exceeds_sync_ceiling')}return headers}
  async function fetchPeerBlocks(session,peerId,from,target){const blocks=[],transactions=new Map();for(let cursor=from;cursor<=target;){const limit=Math.min(MAX_BLOCKS_PAGE,target-cursor+1),envelope=await session.request(`/blocks?from=${cursor}&limit=${limit}`),page=verifyPeerFrame(envelope,{kind:'blocks-page',peerId});if(Number(page.from)!==cursor||!Array.isArray(page.blocks)||page.blocks.length<1)throw new Error('peer_incomplete_blocks');for(const tx of Array.isArray(page.transactions)?page.transactions:[])if(tx?.txid)transactions.set(String(tx.txid),tx);blocks.push(...page.blocks);cursor+=page.blocks.length;if(blocks.length>MAX_BRANCH_BLOCKS)throw new Error('peer_branch_exceeds_sync_ceiling')}return{blocks,transactions}}
  async function pullPeerDescriptors(session,peerId){try{const page=await session.request(`/peer-descriptors?limit=${MAX_PEER_DESCRIPTOR_PAGE}`);if(page?.network!==NETWORK)throw new Error('peer_descriptor_page_wrong_network');return directory.merge(page.descriptors,{source:`peer:${peerId}`})}catch{return 0}}
  async function authenticateDiscoveredCandidates(){const candidates=directory.observations().filter(row=>row.identityId!==identity.id&&!authenticatedPeers.has(row.endpoint)).slice(0,MAX_DISCOVERY_PROBES),results=[];for(const candidate of candidates){try{await peerHello(candidate.endpoint,{source:'descriptor',expectedIdentityId:candidate.identityId});results.push({endpoint:candidate.endpoint,identityId:candidate.identityId,authenticated:true})}catch(error){results.push({endpoint:candidate.endpoint,identityId:candidate.identityId,authenticated:false,error:error.message})}}return results}

  async function syncPeer(peer,{source='configured',expectedIdentityId=null}={}){
    const hello=await peerHello(peer,{source,expectedIdentityId}),session=await establishSecurePeerSession({baseUrl:hello.base,identity,networkId:NETWORK,expectedServerId:hello.peer_id});
    try{
      try{const page=await session.request(`/coordinators?limit=${MAX_COORDINATOR_PAGE}`);coordinators.merge(page.coordinators)}catch{}
      await pullPeerDescriptors(session,hello.peer_id);
      const syncBase=cloneState(state),syncBaseTip=tip(syncBase)?.hash||ZERO_HASH,syncBaseWork=chainWork(syncBase.chain),remoteWork=BigInt(hello.chain_work);
      if(remoteWork<syncBaseWork)return{adopted:false,reason:'less_work',peer_id:hello.peer_id};
      if(remoteWork===syncBaseWork&&hello.tip_hash===syncBaseTip)return{adopted:false,reason:'already_current',peer_id:hello.peer_id};
      const request_nonce=randomBytes(16).toString('hex'),ancestorEnvelope=await session.request('/peer/ancestor',{method:'POST',body:{locator:blockLocator(syncBase),request_nonce}}),ancestorFrame=verifyPeerFrame(ancestorEnvelope,{kind:'peer-ancestor',peerId:hello.peer_id});
      if(ancestorFrame.request_nonce!==request_nonce)throw new Error('peer_ancestor_nonce_mismatch');const ancestor=ancestorFrame.ancestor;if(!ancestor||!Number.isSafeInteger(Number(ancestor.height))||Number(ancestor.height)<0||Number(ancestor.height)>(tip(syncBase)?.height??0))throw new Error('peer_invalid_ancestor');const localAncestor=blockAtHeight(syncBase,Number(ancestor.height));if(!localAncestor||localAncestor.hash!==ancestor.hash)throw new Error('peer_ancestor_not_local');if(Number(hello.height)<=Number(ancestor.height))return{adopted:false,reason:'no_branch',peer_id:hello.peer_id};

      const from=Number(ancestor.height)+1,target=Number(hello.height),prefix=syncBase.chain.slice(0,Number(ancestor.height)),headersPage=await fetchPeerHeaders(session,hello.peer_id,from,target);validateHeaderSequence(prefix,headersPage,{activationHeight});if(Number(ancestor.height)===0&&headersPage[0]?.hash!==CANONICAL_GENESIS_HASH)throw new Error('peer_genesis_checkpoint_mismatch');if(headersPage.at(-1)?.hash!==hello.tip_hash)throw new Error('peer_tip_changed_during_headers');
      const downloaded=await fetchPeerBlocks(session,hello.peer_id,from,target);if(downloaded.blocks.length!==headersPage.length)throw new Error('header_block_length_mismatch');for(let i=0;i<downloaded.blocks.length;i++)if(downloaded.blocks[i]?.hash!==headersPage[i]?.hash)throw new Error('downloaded_block_header_mismatch');

      let candidate=replayPrefix(syncBase,Number(ancestor.height),{activationHeight});for(const block of downloaded.blocks)candidate=appendBlockFromFeed(candidate,block,downloaded.transactions,{activationHeight});if((tip(candidate)?.hash||ZERO_HASH)!==hello.tip_hash)throw new Error('candidate_tip_mismatch');if(chainWork(candidate.chain).toString()!==String(hello.chain_work))throw new Error('peer_chain_work_mismatch');if(!preferred(candidate,syncBase))return{adopted:false,reason:'validated_but_not_preferred',peer_id:hello.peer_id,headers_validated:headersPage.length,blocks_downloaded:downloaded.blocks.length};

      const adoption=await serial(async()=>{
        const current=state,currentTip=tip(current)?.hash||ZERO_HASH;
        if(currentTip===(tip(candidate)?.hash||ZERO_HASH))return{adopted:false,reason:'already_adopted',height:tip(current)?.height??0,tip_hash:currentTip,reacceptedRecords:[],dropped:0};
        if(!preferred(candidate,current))return{adopted:false,reason:'local_state_advanced',height:tip(current)?.height??0,tip_hash:currentTip,reacceptedRecords:[],dropped:0};
        const reconciled=reconcileDetachedTransactions(cloneState(candidate),current);state=reconciled.state;await persist();return{adopted:true,reason:'preferred_candidate',height:tip(state)?.height??0,tip_hash:tip(state)?.hash||ZERO_HASH,reacceptedRecords:reconciled.reacceptedRecords,dropped:reconciled.rejected};
      });
      if(!adoption.adopted)return{adopted:false,reason:adoption.reason,height:adoption.height,tip_hash:adoption.tip_hash,reaccepted:0,repropagated:0,dropped:0,headers_validated:headersPage.length,blocks_downloaded:downloaded.blocks.length,peer_id:hello.peer_id};
      const sourcePropagation=await Promise.allSettled(adoption.reacceptedRecords.map(record=>session.request('/tx',{method:'POST',body:{tx:normalizeTx(record)}}))),repropagated=sourcePropagation.filter(result=>result.status==='fulfilled').length;
      if(adoption.reacceptedRecords.length)void Promise.allSettled(adoption.reacceptedRecords.map(record=>relayTx(record,{exclude:hello.base})));
      return{adopted:true,height:adoption.height,tip_hash:adoption.tip_hash,reaccepted:adoption.reacceptedRecords.length,repropagated,dropped:adoption.dropped,headers_validated:headersPage.length,blocks_downloaded:downloaded.blocks.length,peer_id:hello.peer_id};
    }finally{session.close()}
  }
  async function syncPeers(){if(syncRunning)return[];syncRunning=true;try{refreshSelfDescriptor();const results=[],attempted=new Set();for(const peer of configuredPeers){attempted.add(peer);try{results.push({peer,...await syncPeer(peer,{source:'configured'})})}catch(error){results.push({peer,adopted:false,error:error.code||error.message})}}await authenticateDiscoveredCandidates();const selected=diversity.select(authenticatedObservations(),{limit:MAX_SYNC_SELECTION});for(const record of selected){if(attempted.has(record.endpoint))continue;attempted.add(record.endpoint);try{results.push({peer:record.endpoint,...await syncPeer(record.endpoint,{source:record.source||'selected',expectedIdentityId:record.identityId})})}catch(error){results.push({peer:record.endpoint,adopted:false,error:error.code||error.message})}}return results}finally{syncRunning=false}}

  async function dispatchSecure(message){
    if(!message||typeof message.path!=='string'||typeof message.method!=='string')throw new Error('malformed_encrypted_peer_request');const url=new URL(message.path,'http://peer.invalid');
    if(message.method==='POST'&&url.pathname==='/peer/ancestor'){const body=message.body??{};if(!/^[0-9a-f]{16,128}$/.test(body.request_nonce??''))throw new Error('missing_peer_request_nonce');const ancestor=findCommonAncestor(state,body.locator);if(!ancestor)throw new Error('no_common_ancestor');return signEnvelope(identity,'peer-ancestor',{request_nonce:body.request_nonce,ancestor})}
    if(message.method==='GET'&&url.pathname==='/headers'){const from=boundedInt(url.searchParams.get('from'),1,1,(tip(state)?.height??0)+1),limit=boundedInt(url.searchParams.get('limit'),MAX_HEADERS_PAGE,1,MAX_HEADERS_PAGE);return signEnvelope(identity,'headers-page',{from,headers:branchHeaders(state,from,limit)})}
    if(message.method==='GET'&&url.pathname==='/blocks'){const from=boundedInt(url.searchParams.get('from'),1,1,(tip(state)?.height??0)+1),limit=boundedInt(url.searchParams.get('limit'),MAX_BLOCKS_PAGE,1,MAX_BLOCKS_PAGE),page=branchBlocks(state,from,limit);return signEnvelope(identity,'blocks-page',{from,...page})}
    if(message.method==='GET'&&url.pathname==='/peer-descriptors'){refreshSelfDescriptor();const limit=boundedInt(url.searchParams.get('limit'),64,1,MAX_PEER_DESCRIPTOR_PAGE);return{network:NETWORK,descriptors:directory.descriptors({limit})}}
    if(message.method==='POST'&&url.pathname==='/blocks'){const body=message.body??{};await serial(async()=>{state=appendBlockFromSubmission(state,{header:body.header,nonce:Number(body.nonce),hash:String(body.hash||''),txids:(body.txids||[]).map(String),coinbase_outputs:body.coinbase_outputs??null},{activationHeight});await persist()});return{accepted:true,height:tip(state)?.height??0,hash:tip(state)?.hash||ZERO_HASH}}
    if(message.method==='POST'&&url.pathname==='/tx'){let accepted;await serial(async()=>{accepted=acceptTxInto(state,message.body?.tx||message.body);await persist()});return{accepted:true,txid:accepted.txid,fee_atoms:accepted.fee_atoms}}
    if(message.method==='GET'&&url.pathname==='/coordinators'){const limit=boundedInt(url.searchParams.get('limit'),64,1,MAX_COORDINATOR_PAGE);return{network:NETWORK,coordinators:coordinators.list().slice(0,limit)}}
    throw new Error('encrypted_peer_request_not_allowed');
  }

  const server=http.createServer(async(req,res)=>{
    const remote=req.socket.remoteAddress||'unknown';
    try{
      const url=new URL(req.url,'http://localhost');if(req.method==='OPTIONS')return send(res,204,{});
      const sensitive=url.pathname.startsWith('/peer/')||url.pathname==='/headers'||url.pathname==='/blocks';if(sensitive){const access=guard.allow(remote,req.method==='POST'?3:1);if(!access.allowed)return send(res,429,{ok:false,error:access.reason,retry_after_ms:access.retryAfterMs})}
      if(req.method==='GET'&&(url.pathname==='/'||url.pathname==='/status'))return send(res,200,status());
      if(req.method==='GET'&&url.pathname==='/peer/hello'){const challenge=url.searchParams.get('challenge')||'';if(!/^[0-9a-f]{32,128}$/.test(challenge))throw new Error('peer_hello_requires_random_challenge');return send(res,200,signEnvelope(identity,'peer-hello',{challenge,software:'fairyelf',protocol_version:AUTHORITATIVE_P2P_PROTOCOL_VERSION,network:NETWORK,genesis:CANONICAL_GENESIS_HASH,height:tip(state)?.height??0,tip_hash:tip(state)?.hash||ZERO_HASH,chain_work:chainWork(state.chain).toString(),capabilities:NODE_CAPABILITIES,...(helloExtensions||{})}))}
      if(req.method==='POST'&&url.pathname==='/peer/channel'){const body=await readJson(req,64_000);return send(res,200,secureChannels.accept(body))}
      if(req.method==='POST'&&url.pathname==='/peer/secure'){const frame=await readJson(req,3*1024*1024),opened=secureChannels.openRequest(frame);let response;try{response={ok:true,status:200,body:await dispatchSecure(opened.message)};guard.forgive(remote,1)}catch(error){guard.penalize(remote,1);response={ok:false,status:400,body:{error:error.message}}}return send(res,200,secureChannels.sealResponse(opened,response))}
      if(req.method==='GET'&&url.pathname==='/template'){const address=url.searchParams.get('address')||'';return send(res,200,createMiningTemplate(state,address,{activationHeight}))}
      if(req.method==='POST'&&url.pathname==='/template/pplns'){const body=await readJson(req,128_000);return send(res,200,createDistributedTemplate(state,body.weights,{activationHeight}))}
      if(req.method==='POST'&&url.pathname==='/submit-block'){const body=await readJson(req);let accepted;await serial(async()=>{state=appendBlockFromSubmission(state,{header:body.header,nonce:Number(body.nonce),hash:String(body.hash||''),txids:(body.txids||[]).map(String),coinbase_outputs:body.coinbase_outputs??null},{activationHeight});accepted=tip(state);await persist()});void relayBlock(accepted);return send(res,200,{ok:true,height:accepted.height,hash:accepted.hash,tx_count:accepted.txids.length})}
      if(req.method==='POST'&&url.pathname==='/submit-tx'){const body=await readJson(req);let accepted;await serial(async()=>{accepted=acceptTxInto(state,body.tx||body);await persist()});void relayTx(accepted);return send(res,200,{ok:true,txid:accepted.txid,fee_atoms:accepted.fee_atoms})}
      if(req.method==='GET'&&url.pathname==='/balance'){const address=url.searchParams.get('address')||'',amount=balanceAtoms(state,address);return send(res,200,{ok:true,address,balance_atoms:amount.toString(),balance_fae:formatAtoms(amount),utxos:spendableOutputs(state,address)})}
      if(req.method==='GET'&&url.pathname==='/coordinators')return send(res,200,{ok:true,network:NETWORK,coordinators:coordinators.list()});
      if(req.method==='GET'&&url.pathname==='/peer-diversity')return send(res,200,{ok:true,network:NETWORK,authenticated_peers:authenticatedObservations(),assessment:diversityStatus()});
      return send(res,404,{ok:false,error:'not_found'});
    }catch(error){guard.penalize(remote,1);return send(res,400,{ok:false,error:error.code||error.message})}
  });

  async function start(){await load();refreshSelfDescriptor();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,()=>{server.off('error',reject);resolve()})});if(syncIntervalMs>0)syncTimer=setInterval(()=>syncPeers().catch(()=>{}),Math.max(5000,syncIntervalMs));return api()}
  async function close(){if(syncTimer)clearInterval(syncTimer);secureChannels.destroy();if(server.listening)await new Promise(resolve=>server.close(resolve))}
  function baseUrl(){const address=server.address();if(!address||typeof address==='string')return null;return `http://${host}:${address.port}`}
  function api(){return{server,start,close,baseUrl,status,syncPeer,syncPeers,getState:()=>cloneState(state),replaceState:async next=>serial(async()=>{state=verifyPersistedState(next,{activationHeight});await persist()}),authenticatedPeerObservations:authenticatedObservations,identity,trust,guard,secureChannels,coordinators,directory,diversity,activationHeight,peerHelloExtensions:helloExtensions}}
  return api();
}
