import http from 'node:http';
import {mkdirSync,readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {AuthoritativePplnsHttpAdapter} from './authoritative/pplns-http-adapter.mjs';
import {loadOrCreateNodeIdentity,signEnvelope} from './authoritative/node-identity.mjs';
import {verifyCoordinatorRotationChain} from './authoritative/coordinator-rotation.mjs';
import {PeerGuard} from './authoritative/peer-guard.mjs';

export const COORDINATOR_VERSION='share-coordinator-1.2.0-candidate';
export const DEFAULT_NETWORK='fairyelf-public-testnet-v4';
const MAX_JSON_BODY=64*1024;
const MAX_SHARE_PAGE=100;

function boundedInt(value,fallback,min,max){const parsed=Number.parseInt(String(value??''),10);return Number.isFinite(parsed)?Math.max(min,Math.min(max,parsed)):fallback}
function cleanUrl(value){if(value==null||value==='')return null;const url=new URL(String(value));if(url.protocol!=='http:'&&url.protocol!=='https:')throw new Error('Coordinator public URL must use HTTP(S)');url.hash='';url.search='';return url.toString().replace(/\/$/,'')}
function headers(){return{'content-type':'application/json; charset=utf-8','cache-control':'no-store','access-control-allow-origin':'*','access-control-allow-headers':'content-type','access-control-allow-methods':'GET,POST,OPTIONS'}}
function send(res,status,payload){res.writeHead(status,headers());res.end(status===204?'':JSON.stringify(payload))}
async function readJson(req,maxBytes=MAX_JSON_BODY){let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>maxBytes){const error=new Error('body_too_large');error.status=413;throw error}}if(!text)return{};try{return JSON.parse(text)}catch{const error=new Error('invalid_json');error.status=400;throw error}}
function classify(error){const message=String(error?.message||error||'coordinator_error');if(error?.status)return Number(error.status);if(/activation required|activation height .* not reached|Stale share job|Stale or unknown share job|chain-tip change/i.test(message))return 409;if(/fetch failed|ECONN|ENOTFOUND|upstream|http_5\d\d/i.test(message))return 502;if(/Invalid|missing|mismatch|below target|Duplicate share|not configured/i.test(message))return 400;return 500}
function requestIdentity(req,{trustProxy=false}={}){if(trustProxy){const forwarded=String(req.headers['x-forwarded-for']||'').split(',')[0].trim();if(forwarded)return forwarded}return req.socket.remoteAddress||'unknown'}
function loadRotationChainFile(path){if(!path)return[];const parsed=JSON.parse(readFileSync(resolve(path),'utf8')),chain=Array.isArray(parsed)?parsed:(parsed?.rotation_chain??parsed?.chain);if(!Array.isArray(chain))throw new Error('Coordinator rotation chain file must contain an array');return chain}
function validatePublishedRotationChain(chain,{identity,networkId,publicUrl}){
  if(chain==null||chain.length===0)return{chain:[],sequence:0};
  if(!Array.isArray(chain))throw new Error('Coordinator rotation chain must be an array');
  if(!publicUrl)throw new Error('Coordinator public URL is required when publishing a rotation chain');
  const first=chain[0],firstSequence=Number(first?.payload?.sequence);if(!first?.signer?.id||!first?.signer?.publicKey||!Number.isSafeInteger(firstSequence)||firstSequence<1)throw new Error('Coordinator rotation chain first certificate is malformed');
  const verified=verifyCoordinatorRotationChain(chain,{fromCoordinatorId:first.signer.id,fromPublicKey:first.signer.publicKey,networkId,endpoint:publicUrl,startSequence:firstSequence-1,targetCoordinatorId:identity.id,targetPublicKey:identity.publicKeyBase64});
  return{chain:structuredClone(chain),sequence:verified.sequence};
}

function makeShareReceipt(identity,networkId,entry,result){
  if(!entry||entry.seq!==Number(result?.share?.seq)||entry.entryHash!==result?.share?.entryHash)throw new Error('Persisted share/receipt mismatch');
  return signEnvelope(identity,'coordinator-share-acceptance',{
    receiptVersion:1,
    coordinatorId:identity.id,
    network:networkId,
    jobId:entry.jobId,
    address:entry.address,
    nonce:entry.nonce,
    hash:entry.hash,
    seq:entry.seq,
    entryHash:entry.entryHash,
    zeroBits:Number(result.share.zeroBits),
    targetDifficultyBits:Number(result.share.targetDifficultyBits),
    blockDifficultyBits:Number(entry.blockDifficultyBits),
    height:Number(entry.height),
    previousBlockHash:entry.previousBlockHash,
    payoutCommitment:result.payoutCommitment,
    weightsCommitment:result.weightsCommitment,
    templateCommitment:result.templateCommitment,
    blockAccepted:Boolean(result.block)
  });
}

export function createShareCoordinatorRuntime({
  host='127.0.0.1',port=3190,dataDir='.fairyelf/coordinator',candidateApiUrl,
  publicUrl=null,networkId=DEFAULT_NETWORK,windowSize=2048,shareDifficultyDelta=6,
  rotationChain=[],trustProxy=false,guardOptions={}
}={}){
  if(!candidateApiUrl)throw new Error('FAE candidate API URL is required');
  const root=resolve(dataDir);mkdirSync(root,{recursive:true});
  const identityPath=join(root,'coordinator-identity.json'),logFile=join(root,'shares.ndjson');
  const identity=loadOrCreateNodeIdentity(identityPath),adapter=new AuthoritativePplnsHttpAdapter({baseUrl:candidateApiUrl,networkId}),guard=new PeerGuard(guardOptions),normalizedPublicUrl=cleanUrl(publicUrl),rotationState=validatePublishedRotationChain(rotationChain,{identity,networkId,publicUrl:normalizedPublicUrl}),publishedRotationChain=rotationState.chain,rotationSequence=rotationState.sequence;
  let coordinatorPromise=null;
  const coordinator=async()=>coordinatorPromise??=(adapter.createCoordinator({identity,publicUrl:normalizedPublicUrl,rotationSequence,logFile,windowSize,shareDifficultyDelta}));

  const server=http.createServer(async(req,res)=>{
    const remote=requestIdentity(req,{trustProxy});
    try{
      const url=new URL(req.url,'http://coordinator.invalid');
      if(req.method==='OPTIONS')return send(res,204,{});
      const cost=url.pathname==='/work'?3:url.pathname==='/share'?2:1,access=guard.allow(remote,cost);if(!access.allowed)return send(res,429,{ok:false,error:access.reason,retry_after_ms:access.retryAfterMs});
      const c=await coordinator();
      if(req.method==='GET'&&url.pathname==='/health'){
        const upstream=await adapter.status();return send(res,200,{ok:true,service:COORDINATOR_VERSION,network:networkId,coordinator_id:identity.id,upstream_ok:true,upstream_height:upstream.height,pplns_coinbase_activation_height:upstream.pplns_coinbase_activation_height,mining_enabled:await adapter.activationReady(upstream),holds_payout_private_key:false,rotation_sequence:rotationSequence,rotation_chain_length:publishedRotationChain.length});
      }
      if(req.method==='GET'&&url.pathname==='/status'){
        const status=await c.status();return send(res,200,{ok:true,service:COORDINATOR_VERSION,network:networkId,coordinator_id:identity.id,public_url:normalizedPublicUrl,holds_payout_private_key:false,rotation_sequence:rotationSequence,rotation_chain_length:publishedRotationChain.length,...status});
      }
      if(req.method==='GET'&&url.pathname==='/descriptor')return send(res,200,{ok:true,descriptor:await c.descriptor(),rotation_chain:structuredClone(publishedRotationChain)});
      if(req.method==='GET'&&url.pathname==='/shares'){
        const limit=boundedInt(url.searchParams.get('limit'),20,1,MAX_SHARE_PAGE),summary=c.ledger.summary(),shares=c.ledger.shares.slice(-limit).map(entry=>structuredClone(entry));return send(res,200,{ok:true,network:networkId,coordinator_id:identity.id,summary,shares});
      }
      if(req.method==='POST'&&url.pathname==='/work'){
        const body=await readJson(req);const work=await c.createWork(String(body.address||''));guard.forgive(remote,1);return send(res,200,{ok:true,...work});
      }
      if(req.method==='POST'&&url.pathname==='/share'){
        const body=await readJson(req),jobId=String(body.jobId||''),nonce=Number(body.nonce),hash=String(body.hash||''),result=await c.submitShare({jobId,nonce,hash});
        const seq=Number(result.share?.seq),entry=Number.isSafeInteger(seq)&&seq>=1?c.ledger.shares[seq-1]:null,shareReceipt=makeShareReceipt(identity,networkId,entry,result);
        guard.forgive(remote,1);return send(res,200,{ok:true,...result,shareReceipt});
      }
      return send(res,404,{ok:false,error:'not_found'});
    }catch(error){guard.penalize(remote,1);return send(res,classify(error),{ok:false,error:error?.message||String(error)})}
  });

  async function start(){if(server.listening)return api();await new Promise((resolveStart,reject)=>{server.once('error',reject);server.listen(port,host,()=>{server.off('error',reject);resolveStart()})});return api()}
  async function close(){if(server.listening)await new Promise(resolveClose=>server.close(resolveClose))}
  function baseUrl(){const address=server.address();if(!address||typeof address==='string')return null;return `http://${host}:${address.port}`}
  function api(){return{server,start,close,baseUrl,identity,adapter,guard,getCoordinator:coordinator,dataDir:root,identityPath,logFile,rotationSequence,rotationChain:structuredClone(publishedRotationChain)}}
  return api();
}

export async function startShareCoordinatorFromEnv(env=process.env){
  const rotationChain=loadRotationChainFile(env.FAE_COORDINATOR_ROTATION_CHAIN_FILE||null);
  const runtime=createShareCoordinatorRuntime({
    host:env.FAE_COORDINATOR_HOST||'127.0.0.1',
    port:boundedInt(env.FAE_COORDINATOR_PORT,3190,1,65535),
    dataDir:env.FAE_COORDINATOR_DATA_DIR||'.fairyelf/coordinator',
    candidateApiUrl:env.FAE_CANDIDATE_API_URL,
    publicUrl:env.FAE_COORDINATOR_PUBLIC_URL||null,
    networkId:env.FAE_NETWORK||DEFAULT_NETWORK,
    windowSize:boundedInt(env.FAE_COORDINATOR_WINDOW,2048,1,100000),
    shareDifficultyDelta:boundedInt(env.FAE_SHARE_DIFFICULTY_DELTA,6,1,20),
    rotationChain,
    trustProxy:env.FAE_COORDINATOR_TRUST_PROXY==='1'
  });
  await runtime.start();
  const status=await runtime.adapter.status();
  console.log(JSON.stringify({ok:true,service:COORDINATOR_VERSION,url:runtime.baseUrl(),coordinator_id:runtime.identity.id,network:status.network,height:status.height,pplns_coinbase_activation_height:status.pplns_coinbase_activation_height,mining_enabled:await runtime.adapter.activationReady(status),holds_payout_private_key:false,rotation_sequence:runtime.rotationSequence,rotation_chain_length:runtime.rotationChain.length}));
  const stop=async()=>{await runtime.close();process.exit(0)};process.once('SIGINT',stop);process.once('SIGTERM',stop);return runtime;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){startShareCoordinatorFromEnv().catch(error=>{console.error(error?.stack||error);process.exit(1)})}
