import {targetFromHex,targetHex} from './difficulty-timestamp-candidate.mjs';
import {FULL_TARGET_MIGRATION_STATUS,legacyBitsWork,workFromTarget} from './full-target-migration-candidate.mjs';

export const FULL_TARGET_ACTIVATION_STATUS='candidate-not-active-consensus';

function safeHeight(value,label){const n=Number(value);if(!Number.isSafeInteger(n)||n<1)throw new Error(`${label}_invalid`);return n}

export function validateWorkCommitmentForHeight(block,{activationHeight}={}){
  if(FULL_TARGET_MIGRATION_STATUS!=='candidate-not-active-consensus')throw new Error('migration_authority_guard_failed');
  const height=safeHeight(block?.height??block?.header?.height,'height'),activation=safeHeight(activationHeight,'activation_height');
  const bits=block?.difficulty_bits??block?.header?.difficulty_bits,target=block?.target_hex??block?.header?.target_hex;
  if(height<activation){
    if(target!==undefined)throw new Error('premature_full_target_commitment');
    if(bits===undefined)throw new Error('legacy_difficulty_commitment_required');
    return{mode:'legacy-bits',work:legacyBitsWork(bits)};
  }
  if(bits!==undefined)throw new Error('legacy_bits_forbidden_after_full_target_activation');
  if(target===undefined)throw new Error('full_target_commitment_required');
  const parsed=targetFromHex(String(target));
  return{mode:'full-target',target_hex:targetHex(parsed),work:workFromTarget(parsed)};
}

export function mixedActivatedChainWork(chain,{activationHeight}={}){
  if(!Array.isArray(chain))throw new Error('chain_required');
  return chain.reduce((sum,block)=>sum+validateWorkCommitmentForHeight(block,{activationHeight}).work,0n);
}
