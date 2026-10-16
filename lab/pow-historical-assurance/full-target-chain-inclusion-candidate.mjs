/**
 * HPA-UC-001 W3 -- READ-ONLY exact-proof inclusion reconciliation.
 * An accepted network response is not proof of inclusion. Only replay of
 * a complete authoritative chain state can provide a local inclusion witness.
 * Absence at a finite tip is NEVER evidence that resubmission is safe.
 * This module is isolated assurance: no active PPLNS/fee/consensus changes.
 */
import {verifyPersistedState} from '../../sovereign-forge/node/authoritative/fae-v4-peer-node.mjs';
import {leadingZeroBits} from '../../sovereign-forge/node/authoritative/crypto.mjs';
import {ShareLedger} from '../../sovereign-forge/node/authoritative/share-coordinator.mjs';

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

/**
 * HPA-W3-51..54: optional anchored SHARE LEDGER provenance before chain inclusion.
 *
 * A caller-controlled in-memory ledger or a syntactically valid file cannot
 * establish durable share provenance. Replay the actual append-only source
 * ledger and bind BOTH its hash-chain head and length to an independently
 * retained, authenticated checkpoint supplied by the caller.
 *
 * This function does NOT authenticate the checkpoint itself: a forged matching
 * anchor remains a forged anchor. It also cannot prove chain finality, pool
 * payout settlement, or safe automatic full-block resubmission.
 */
export function reconcileFullTargetAgainstAnchoredLedger({
  logFile,expectedLastEntryHash,expectedTotalShares,
  jobId,nonce,hash,rawChainState,activationHeight=null
}={}){
  if(typeof logFile!=='string'||!logFile.trim()||
     typeof expectedLastEntryHash!=='string'||!/^[0-9a-f]{64}$/.test(expectedLastEntryHash)||
     !Number.isSafeInteger(expectedTotalShares)||expectedTotalShares<1||
     expectedTotalShares>1_000_000)
    fail('invalid_anchored_ledger_input');

  // ShareLedger.load() checks each source entry's sequence, previous-entry
  // hash, computed entry hash and duplicate job/nonce identity.
  const ledger=new ShareLedger({logFile});
  if(ledger.shares.length!==expectedTotalShares||
     ledger.lastHash!==expectedLastEntryHash)
    fail('share_ledger_anchor_mismatch');

  return {
    ...reconcileFullTargetAgainstVerifiedChain({
      ledger,jobId,nonce,hash,rawChainState,activationHeight
    }),
    source_ledger_replayed_and_anchor_matched:true,
    source_ledger_head_hash:expectedLastEntryHash,
    source_ledger_share_count:expectedTotalShares,
    external_checkpoint_authenticity_verified_here:false,
    independently_observed_finality:false,
    safe_to_auto_resubmit:false
  };
}
