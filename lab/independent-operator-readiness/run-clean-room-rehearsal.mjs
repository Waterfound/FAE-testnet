#!/usr/bin/env node
import {createHash,generateKeyPairSync,randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {legacyBlocks} from '../../sovereign-forge/tests/legacy-testnet-fixture.mjs';
import {emptyState,appendBlockFromFeed} from '../../sovereign-forge/node/authoritative/fae-v4-core.mjs';
import {createAuthoritativeV4PeerNode} from '../../sovereign-forge/node/authoritative/fae-v4-peer-node.mjs';
import {encodeAddress} from '../../sovereign-forge/node/authoritative/address.mjs';
import {hashHex,leadingZeroBits,sha256} from '../../sovereign-forge/node/authoritative/crypto.mjs';
import {runOperator} from './run-operator.mjs';
import {verifyEvidenceBundle} from './verify-evidence.mjs';

const repoRoot=fileURLToPath(new URL('../..',import.meta.url));
function git(args){return execFileSync('git',args,{cwd:repoRoot,encoding:'utf8'}).trim()}
function parseArgs(argv){const out={};for(let i=0;i<argv.length;i++){if(!argv[i].startsWith('--'))continue;const key=argv[i].slice(2),value=argv[i+1]&&!argv[i+1].startsWith('--')?argv[++i]:true;out[key]=value}return out}
function legacyState(){let state=emptyState();for(const block of legacyBlocks)state=appendBlockFromFeed(state,block,new Map(),{activationHeight:null});return state}
function wallet(){const{publicKey}=generateKeyPairSync('ed25519'),spki=publicKey.export({type:'spki',format:'der'});return encodeAddress(sha256(spki).subarray(0,20),'faet')}
async function json(url,options={}){const response=await fetch(url,options),body=await response.json();if(!response.ok)throw new Error(`${response.status} ${url}: ${JSON.stringify(body)}`);return body}
async function mine(base,address){
  const template=await json(`${base}/template?address=${encodeURIComponent(address)}`);
  let nonce=0,hash='';
  for(;nonce<12_000_000;nonce++){hash=hashHex({...template.header,nonce});if(leadingZeroBits(hash)>=template.header.difficulty_bits)break}
  if(nonce>=12_000_000)throw new Error('PoW search exhausted');
  await json(`${base}/submit-block`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({header:template.header,nonce,hash,txids:template.txids||[],coinbase_outputs:template.coinbase_outputs??null})});
}

const args=parseArgs(process.argv.slice(2));
if(!args.out)throw new Error('--out is required');
const seed=createAuthoritativeV4PeerNode({initialState:legacyState(),activationHeight:null});
await seed.start();
try{
  const sourceRevision=git(['rev-parse','HEAD']);
  const challenge=randomBytes(32).toString('hex');
  const operatorId=`SIMULATED-CLEAN-ROOM-${process.pid}`;
  const address=wallet();
  const run=await runOperator({
    peer:seed.baseUrl(),outDir:resolve(args.out),expectedSourceRevision:sourceRevision,runChallenge:challenge,
    operatorId,evidenceClass:'READINESS_REHEARSAL_ONLY',tipProgressTimeoutMs:30000,
    onInitialObservation:async()=>{await mine(seed.baseUrl(),address)}
  });
  const verdict=await verifyEvidenceBundle(run.bundle_dir,{
    expectedSourceRevision:sourceRevision,expectedChallenge:challenge,expectedOperatorId:operatorId,expectedEvidenceClass:'READINESS_REHEARSAL_ONLY'
  });
  if(verdict.verdict!=='PASS')throw new Error(`rehearsal verifier failed: ${JSON.stringify(verdict)}`);
  console.log(JSON.stringify({schema:'FAE_IOR_CLEAN_ROOM_REHEARSAL_RESULT_V1',status:'PASS',external_evidence:false,...run,verifier:verdict},null,2));
}finally{
  await seed.close();
}
