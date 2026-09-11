import http from 'node:http';
import {mkdir,readFile,rename,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {NETWORK,ZERO_HASH} from '../authoritative/fae-v4-core.mjs';
import {stableStringify} from '../authoritative/canonical.mjs';
import {loadOrCreateNodeIdentity,signEnvelope,verifyEnvelope} from '../authoritative/node-identity.mjs';
import {SecureChannelHub,establishSecurePeerSession} from '../authoritative/secure-channel.mjs';
import {activationPolicyDescriptor,assertActivationPolicyCompatible} from '../authoritative/activation-policy-identity-candidate.mjs';
import {validateBranchChain} from '../authoritative/activation-reorg-candidate.mjs';
import {validateDownloadedBodies,rehearseHeadersFirstSync} from '../authoritative/full-target-headers-sync-candidate.mjs';

export const FULL_TARGET_SHADOW_NODE_STATUS='lab-only-no-consensus-authority';
export const FULL_TARGET_SHADOW_NETWORK='fairyelf-full-target-shadow-v1';
export const FULL_TARGET_SHADOW_STATE_FORMAT='FAE_FULL_TARGET_SHADOW_STATE_V1';
const MAX_BODY=4*1024*1024;
const MAX_PAGE=512;

function int(value,label,{min=0,max=Number.MAX_SAFE_INTEGER}={}){const n=Number(value);if(!Number.isSafeInteger(n)||n<min||n>max)throw new Error(`${label}_invalid`);return n}
function hex64(value,label){const s=String(value??'').toLowerCase();if(!/^[0-9a-f]{64}$/.test(s))throw new Error(`${label}_invalid`);return s}
function jsonClone(value){return structuredClone(value)}
function normalizePeer(peer){const url=new URL(String(peer));if(!['http:','https:'].includes(url.protocol))throw new Error('shadow_peer_requires_http');url.search='';url.hash='';return url.toString().replace(/\/$/,'')}
async function readJson(req,limit=MAX_BODY){let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>limit)throw new Error('shadow_body_too_large')}return body?JSON.parse(body):{}}
function send(res,status,payload){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(payload))}
function blockAt(chain,height){return height===0?{height:0,hash:ZERO_HASH}:chain[height-1]??null}
function headerRecord(block){if(!block?.header_json||typeof block.header_json!=='object')throw new Error('shadow_block_header_json_required');const base={height:Number(block.height),hash:String(block.hash),previous_hash:String(block.previous_hash),timestamp_ms:Number(block.timestamp_ms),reward_atoms:String(block.reward_atoms),header_json:jsonClone(block.header_json)};if(block.difficulty_bits!==undefined)base.difficulty_bits=Number(block.difficulty_bits);if(block.target_hex!==undefined)base.target_hex=String(block.target_hex);return base}
function page(chain,from,limit){return chain.slice(Math.max(0,from-1),Math.max(0,from-1)+limit)}
function trustedPrefixMatches(chain,trusted){if(chain.length<trusted.length)return false;for(let i=0;i<trusted.length;i++)if(stableStringify(chain[i])!==stableStringify(trusted[i]))return false;return true}
function chainWork(chain,policy){return validateBranchChain(chain,policy,{enforceFutureDrift:false}).work}
function locator(chain){const result=[];for(let h=chain.length;h>=0&&result.length<128;h--)result.push({height:h,hash:h===0?ZERO_HASH:String(chain[h-1].hash)});return result}
function commonAncestor(chain,remoteLocator){if(!Array.isArray(remoteLocator))throw new Error('shadow_locator_required');for(const entry of remoteLocator){const h=Number(entry?.height),hash=String(entry?.hash??'');if(!Number.isSafeInteger(h)||h<0||h>chain.length||!/^[0-9a-f]{64}$/.test(hash))continue;const local=blockAt(chain,h);if(local&&String(local.hash)===hash)return{height:h,hash}}return null}

export function createFullTargetShadowPeerNode({host='127.0.0.1',port=0,dataFile=null,identityFile=null,policy,trustedPrefix,initialChain=null}={}){
  if(!policy)throw new Error('shadow_policy_required');if(!Array.isArray(trustedPrefix)||trustedPrefix.length<1)throw new Error('shadow_trusted_prefix_required');
  const trusted=jsonClone(trustedPrefix),trustedHeight=trusted.length,trustedTip=trusted.at(-1);if(Number(trustedTip.height)!==trustedHeight)throw new Error('shadow_trusted_prefix_height_mismatch');
  if(Number(policy.activation_height)<=trustedHeight)throw new Error('shadow_activation_must_follow_trusted_prefix');
  const descriptor=activationPolicyDescriptor(policy),checkpointHash=hex64(trustedTip.hash,'trusted_checkpoint_hash');
  const identity=loadOrCreateNodeIdentity(identityFile),secureChannels=new SecureChannelHub({identity,networkId:FULL_TARGET_SHADOW_NETWORK,contextBinding:descriptor.policy_id});
  const resolvedDataFile=dataFile?resolve(dataFile):null;
  let state={format:FULL_TARGET_SHADOW_STATE_FORMAT,chain:jsonClone(initialChain??trusted)},writeLock=Promise.resolve();

  function validateStateChain(chain){
    if(!Array.isArray(chain)||!trustedPrefixMatches(chain,trusted))throw new Error('shadow_trusted_prefix_mismatch');
    const suffix=chain.slice(trustedHeight);if(suffix.length){const headers=suffix.map(headerRecord);validateDownloadedBodies(trusted,headers,suffix,policy,{remotePolicyDescriptor:descriptor,nowMs:Date.now()+365*24*60*60_000});}
    return validateBranchChain(chain,policy,{enforceFutureDrift:false});
  }
  validateStateChain(state.chain);
  function serial(fn){const run=writeLock.then(fn,fn);writeLock=run.catch(()=>{});return run}
  async function persist(){if(!resolvedDataFile)return;await mkdir(dirname(resolvedDataFile),{recursive:true});const tmp=`${resolvedDataFile}.tmp`;await writeFile(tmp,`${JSON.stringify(state,null,2)}\n`);await rename(tmp,resolvedDataFile)}
  async function load(){if(!resolvedDataFile)return;try{const raw=JSON.parse(await readFile(resolvedDataFile,'utf8'));if(raw?.format!==FULL_TARGET_SHADOW_STATE_FORMAT)throw new Error('shadow_state_format_mismatch');validateStateChain(raw.chain);state={format:FULL_TARGET_SHADOW_STATE_FORMAT,chain:jsonClone(raw.chain)}}catch(error){if(error.code!=='ENOENT')throw error}}
  function status(){const replay=validateStateChain(state.chain),tip=state.chain.at(-1);return{ok:true,status:FULL_TARGET_SHADOW_NODE_STATUS,shadow_network:FULL_TARGET_SHADOW_NETWORK,consensus_network:NETWORK,node_identity:identity.id,policy_id:descriptor.policy_id,activation_height:descriptor.activation_height,trusted_height:trustedHeight,trusted_checkpoint_hash:checkpointHash,height:Number(tip.height),tip_hash:String(tip.hash),chain_work:replay.work.toString(),secure_context_binding:secureChannels.status().contextBinding}}
  function helloPayload(challenge){const s=status();return{challenge,software:'fairyelf-full-target-shadow',shadow_network:FULL_TARGET_SHADOW_NETWORK,consensus_network:NETWORK,policy:descriptor,trusted_height:trustedHeight,trusted_checkpoint_hash:checkpointHash,height:s.height,tip_hash:s.tip_hash,chain_work:s.chain_work,status:FULL_TARGET_SHADOW_NODE_STATUS}}

  async function peerHello(peer){
    const base=normalizePeer(peer),challenge=randomBytes(24).toString('hex'),response=await fetch(`${base}/peer/hello?challenge=${challenge}`,{signal:AbortSignal.timeout(8_000)}),envelope=await response.json();if(!response.ok)throw new Error(envelope.error??`shadow_peer_http_${response.status}`);
    const hello=verifyEnvelope(envelope,{kind:'full-target-shadow-hello',maxAgeMs:2*60_000});if(hello.challenge!==challenge)throw new Error('shadow_hello_challenge_mismatch');if(hello.shadow_network!==FULL_TARGET_SHADOW_NETWORK||hello.consensus_network!==NETWORK)throw new Error('shadow_network_mismatch');if(hello.trusted_height!==trustedHeight||hello.trusted_checkpoint_hash!==checkpointHash)throw new Error('shadow_trusted_checkpoint_mismatch');
    const compatibility=assertActivationPolicyCompatible(policy,hello.policy);if(!compatibility.ok)throw new Error(compatibility.error);
    if(!Number.isSafeInteger(Number(hello.height))||Number(hello.height)<trustedHeight||!/^[0-9a-f]{64}$/.test(String(hello.tip_hash))||!/^\d+$/.test(String(hello.chain_work)))throw new Error('shadow_hello_chain_metadata_invalid');
    return{...hello,base,peer_id:envelope.signer.id};
  }
  async function sessionFor(hello){return establishSecurePeerSession({baseUrl:hello.base,identity,networkId:FULL_TARGET_SHADOW_NETWORK,expectedServerId:hello.peer_id,contextBinding:descriptor.policy_id})}
  async function syncPeer(peer){
    const hello=await peerHello(peer);if(hello.tip_hash===state.chain.at(-1).hash&&BigInt(hello.chain_work)===chainWork(state.chain,policy))return{adopted:false,reason:'already_current',peer_id:hello.peer_id};
    const session=await sessionFor(hello);try{
      const ancestor=await session.request('/peer/ancestor',{method:'POST',body:{locator:locator(state.chain)}});if(!ancestor||!Number.isSafeInteger(Number(ancestor.height))||Number(ancestor.height)<0||Number(ancestor.height)>state.chain.length)throw new Error('shadow_invalid_ancestor');const local=blockAt(state.chain,Number(ancestor.height));if(!local||String(local.hash)!==String(ancestor.hash))throw new Error('shadow_ancestor_not_local');if(Number(hello.height)<=Number(ancestor.height))return{adopted:false,reason:'no_branch',peer_id:hello.peer_id};
      const from=Number(ancestor.height)+1,target=Number(hello.height);
      const result=await rehearseHeadersFirstSync({localChain:state.chain,commonAncestorHeight:Number(ancestor.height),remotePolicyDescriptor:hello.policy,remoteClaimedWork:BigInt(hello.chain_work),policy,nowMs:Date.now()+365*24*60*60_000,fetchHeaders:async()=>{const response=await session.request(`/headers?from=${from}&limit=${target-from+1}`);if(response.from!==from||!Array.isArray(response.headers)||response.headers.length!==target-from+1)throw new Error('shadow_incomplete_headers');return response.headers},fetchBlocks:async()=>{const response=await session.request(`/blocks?from=${from}&limit=${target-from+1}`);if(response.from!==from||!Array.isArray(response.blocks)||response.blocks.length!==target-from+1)throw new Error('shadow_incomplete_blocks');return response.blocks}});
      if(!result.ok)return{adopted:false,reason:result.error,stage:result.stage,peer_id:hello.peer_id};if(!result.preferred)return{adopted:false,reason:'validated_but_not_preferred',peer_id:hello.peer_id,headers_validated:result.headers_validated,blocks_validated:result.blocks_validated};
      await serial(async()=>{const currentWork=chainWork(state.chain,policy);const candidateWork=chainWork(result.candidate_chain,policy);if(candidateWork<currentWork)throw new Error('shadow_local_advanced');if(!Array.isArray(result.storage_chain))throw new Error('shadow_storage_chain_missing');validateStateChain(result.storage_chain);state={format:FULL_TARGET_SHADOW_STATE_FORMAT,chain:jsonClone(result.storage_chain)};await persist()});
      return{adopted:true,peer_id:hello.peer_id,height:state.chain.length,tip_hash:state.chain.at(-1).hash,headers_validated:result.headers_validated,blocks_validated:result.blocks_validated};
    }finally{session.close()}
  }
  async function appendBlock(block){return serial(async()=>{const next=[...state.chain,jsonClone(block)];validateStateChain(next);state={format:FULL_TARGET_SHADOW_STATE_FORMAT,chain:next};await persist();return status()})}

  async function secureDispatch(message){if(!message||typeof message.path!=='string'||typeof message.method!=='string')throw new Error('shadow_secure_request_malformed');const url=new URL(message.path,'http://shadow.invalid');if(message.method==='POST'&&url.pathname==='/peer/ancestor'){const ancestor=commonAncestor(state.chain,message.body?.locator);if(!ancestor)throw new Error('shadow_no_common_ancestor');return ancestor}if(message.method==='GET'&&url.pathname==='/headers'){const from=int(url.searchParams.get('from'),'from',{min:1}),limit=int(url.searchParams.get('limit'),'limit',{min:1,max:MAX_PAGE});return{from,headers:page(state.chain,from,limit).map(headerRecord)}}if(message.method==='GET'&&url.pathname==='/blocks'){const from=int(url.searchParams.get('from'),'from',{min:1}),limit=int(url.searchParams.get('limit'),'limit',{min:1,max:MAX_PAGE});return{from,blocks:jsonClone(page(state.chain,from,limit))}}throw new Error('shadow_secure_request_not_allowed')}

  const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://shadow.invalid');if(req.method==='GET'&&url.pathname==='/status')return send(res,200,status());if(req.method==='GET'&&url.pathname==='/peer/hello'){const challenge=url.searchParams.get('challenge')??'';if(!/^[0-9a-f]{32,128}$/.test(challenge))throw new Error('shadow_hello_challenge_required');return send(res,200,signEnvelope(identity,'full-target-shadow-hello',helloPayload(challenge)))}if(req.method==='POST'&&url.pathname==='/peer/channel')return send(res,200,secureChannels.accept(await readJson(req,128_000)));if(req.method==='POST'&&url.pathname==='/peer/secure'){const opened=secureChannels.openRequest(await readJson(req));let response;try{response={ok:true,status:200,body:await secureDispatch(opened.message)}}catch(error){response={ok:false,status:400,body:{error:error.message}}}return send(res,200,secureChannels.sealResponse(opened,response))}return send(res,404,{ok:false,error:'not_found'})}catch(error){return send(res,400,{ok:false,error:error.message})}});
  async function start(){await load();await new Promise((resolvePromise,reject)=>{server.once('error',reject);server.listen(port,host,()=>{server.off('error',reject);resolvePromise()})});return api()}
  async function close(){secureChannels.destroy();if(server.listening)await new Promise(resolvePromise=>server.close(resolvePromise))}
  function baseUrl(){const address=server.address();if(!address||typeof address==='string')return null;return `http://${host}:${address.port}`}
  function api(){return{start,close,baseUrl,status,syncPeer,appendBlock,getChain:()=>jsonClone(state.chain),identity,policy,descriptor,trustedPrefix:jsonClone(trusted)}}
  return api();
}
