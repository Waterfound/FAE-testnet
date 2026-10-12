import {createHash} from 'node:crypto';
import {NETWORK,ZERO_HASH,nextDifficulty,subsidy} from '../authoritative/fae-v4-core.mjs';
import {encodeAddress} from '../authoritative/address.mjs';
import {hashHex,leadingZeroBits,sha256} from '../authoritative/crypto.mjs';
import {freezeActivationPolicy,validateBranchChain} from '../authoritative/activation-reorg-candidate.mjs';
import {mineFullActivationCandidate} from '../authoritative/full-activation-rehearsal-candidate.mjs';
import {activatedBlockRecord} from '../authoritative/full-target-headers-sync-candidate.mjs';

export const SHADOW_VALIDATION_FIXTURE_VERSION=1;
export const SHADOW_VALIDATION_TRUSTED_HEIGHT=12;
export const SHADOW_VALIDATION_ACTIVATION_HEIGHT=14;
export const SHADOW_VALIDATION_START_MS=1_760_000_000_000;
export const SHADOW_VALIDATION_PROFILES=Object.freeze(['trusted','weak-a','strong-b']);

function fixtureHash(label){return createHash('sha256').update(`FAE_SHADOW_EXTERNAL_V1/${label}`).digest('hex')}
function clone(value){return structuredClone(value)}

export function createShadowValidationPolicy(){return freezeActivationPolicy({activationHeight:SHADOW_VALIDATION_ACTIVATION_HEIGHT});}

export function createShadowValidationTrustedPrefix(){
  const chain=[];
  for(let height=1;height<=SHADOW_VALIDATION_TRUSTED_HEIGHT;height++){
    const previous=chain.at(-1),bits=nextDifficulty(chain),timestamp_ms=SHADOW_VALIDATION_START_MS+(height-1)*180_000;
    chain.push({
      height,hash:fixtureHash(`trusted-${height}`),previous_hash:previous?.hash??ZERO_HASH,
      timestamp_ms,difficulty_bits:bits,reward_atoms:'1000000000',
      header_json:{fixture:true,fixture_version:SHADOW_VALIDATION_FIXTURE_VERSION,height},txids:[]
    });
  }
  return chain;
}

function deterministicMiner(label){return encodeAddress(sha256(Buffer.from(`FAE_SHADOW_EXTERNAL_V1/${label}`)).subarray(0,20),'faet')}

function mineLegacy(prefix,{minerAddress,timestampMs,label}){
  const height=prefix.length+1,bits=nextDifficulty(prefix),base={
    network:NETWORK,height,previous_hash:prefix.at(-1)?.hash??ZERO_HASH,timestamp_ms:timestampMs,
    difficulty_bits:bits,miner_address:minerAddress,reward_atoms:subsidy(height).toString(),tx_root:hashHex([]),tx_count:0
  };
  for(let nonce=0;nonce<10_000_000;nonce++){
    const full={...base,nonce},hash=hashHex(full);if(leadingZeroBits(hash)<bits)continue;
    return{height,hash,previous_hash:base.previous_hash,timestamp_ms:timestampMs,difficulty_bits:bits,reward_atoms:base.reward_atoms,header_json:full,txids:[],fixture_label:label};
  }
  throw new Error('shadow_validation_legacy_nonce_budget_exhausted');
}

function buildFork({label,activationDelayMs}){
  const policy=createShadowValidationPolicy(),trusted=createShadowValidationTrustedPrefix(),minerAddress=deterministicMiner(label);
  let chain=clone(trusted);const h13Time=trusted.at(-1).timestamp_ms+180_000;
  const legacy=mineLegacy(chain,{minerAddress,timestampMs:h13Time,label});chain.push(legacy);
  const t14=legacy.timestamp_ms+activationDelayMs+180_000;
  const m14=mineFullActivationCandidate(chain,policy,{minerAddress,timestampMs:t14,maxNonce:10_000_000});chain.push(activatedBlockRecord(m14.candidate));
  const t15=t14+180_000;
  const m15=mineFullActivationCandidate(chain,policy,{minerAddress,timestampMs:t15,maxNonce:10_000_000});chain.push(activatedBlockRecord(m15.candidate));
  const replay=validateBranchChain(chain,policy,{enforceFutureDrift:false});
  return{chain,work:replay.work.toString(),tip_hash:String(chain.at(-1).hash),miner_address:minerAddress};
}

let cached=null;
function fixtureSet(){
  if(cached)return cached;
  const policy=createShadowValidationPolicy(),trustedPrefix=createShadowValidationTrustedPrefix();
  const weak=buildFork({label:'weak-a',activationDelayMs:48*60*60_000});
  const strong=buildFork({label:'strong-b',activationDelayMs:6*60*60_000});
  if(BigInt(strong.work)<=BigInt(weak.work))throw new Error('shadow_validation_fixture_work_order_invalid');
  cached=Object.freeze({policy,trustedPrefix,weak,strong});return cached;
}

export function createShadowValidationFixture(profile='trusted'){
  if(!SHADOW_VALIDATION_PROFILES.includes(profile))throw new Error('shadow_validation_profile_invalid');
  const set=fixtureSet();
  const initialChain=profile==='trusted'?set.trustedPrefix:profile==='weak-a'?set.weak.chain:set.strong.chain;
  const replay=validateBranchChain(initialChain,set.policy,{enforceFutureDrift:false});
  return{
    fixture_version:SHADOW_VALIDATION_FIXTURE_VERSION,profile,policy:set.policy,
    trustedPrefix:clone(set.trustedPrefix),initialChain:clone(initialChain),
    expected_height:initialChain.length,expected_tip_hash:String(initialChain.at(-1).hash),expected_work:replay.work.toString(),
    expected_strong_work:set.strong.work,expected_weak_work:set.weak.work
  };
}
