/**
 * HPA-UC-001 W3 -- READ-ONLY exact-proof inclusion reconciliation.
 * An accepted network response is not proof of inclusion. Only replay of
 * a complete authoritative chain state can provide a local inclusion witness.
 * Absence at a finite tip is NEVER evidence that resubmission is safe.
 * This module is isolated assurance: no active PPLNS/fee/consensus changes.
 */
import {verifyPersistedState} from '../../sovereign-forge/node/authoritative/fae-v4-peer-node.mjs';
import {leadingZeroBits} from '../../sovereign-forge/node/authoritative/crypto.mjs';

const fail=(code)=>{throw Object.assign(new Error(code),{code})};
export function reconcileFullTargetAgainstVerifiedChain({
 ledger,jobId,nonce,hash,rawChainState,activationHeight=null
}={}){
  if(!ledger||!Array.isArray(ledger.shares)||typeof ledger.seen?.has!=='function'||
     typeof jobId!=='string'||!jobId||
     !Number.isSafeInteger(nonce)||nonce<0||
     typeof hash!=='string'||!/^[0-9a-f]{64}$/.test(hash)||
     !rawChainState)fail('invalid_full_target_reconciliation_input');
  const key=jobId+':'+nonce;
  if(!ledger.seen.has(key))fail('no_durable_share_evidence');
  const entry=ledger.shares.find(x=>x.jobId===jobId&&x.nonce===nonce);
  if(!entry||entry.hash!==hash||
     leadingZeroBits(hash)<Number(entry.blockDifficultyBits)||
     !Number.isSafeInteger(Number(entry.height))||
     !/^[0-9a-f]{64}$/.test(entry.previousBlockHash))
    fail('full_target_share_evidence_mismatch');
  // Reconstruct chain/transactions from actual authenticated on-disk state.
  // verifyPersistedState raises on invalid source block/header/PoW/UTXO.
  const source=verifyPersistedState(rawChainState,{activationHeight});
  const matches=source.chain.filter(b=>b.hash===hash);
  if(matches.length>1)fail('duplicated_block_hash_in_source_chain');
  const block=matches[0];
  const sourceTip=source.chain.at(-1)?.hash??null;
  if(!block)return{
    verdict:'NOT_OBSERVED_AT_THIS_VERIFIED_TIP',
    block_hash:hash,source_tip_hash:sourceTip,confirmed:false,
    safe_to_auto_resubmit:false,inclusion_unknown:true
  };
  if(block.height!==Number(entry.height)||
     block.previous_hash!==entry.previousBlockHash||
     block.nonce!==nonce)fail('block_does_not_match_share_proof');
  const depth=source.chain.length-source.chain.findIndex(b=>b.hash===hash);
  return{
    verdict:'INCLUDED_IN_THIS_VERIFIED_CHAIN_ONLY',
    block_hash:hash,source_tip_hash:sourceTip,confirmed:true,
    observed_depth:depth,finality_guaranteed:false,
    safe_to_auto_resubmit:false,inclusion_unknown:false
  };
}
