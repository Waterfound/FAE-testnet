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
import {createHash,createPublicKey,verify as cryptoVerify} from 'node:crypto';
import {stableStringify} from '../../sovereign-forge/node/authoritative/canonical.mjs';
import {NETWORK} from '../../sovereign-forge/node/authoritative/fae-v4-core.mjs';

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

/**
 * HPA-W3-55..59: source-ledger witness signature bound to an OUT-OF-BAND
 * preselected Ed25519 SPKI fingerprint, ledger identity and witness identity.
 *
 * The caller must obtain trustedWitness from a separate governance/trust
 * channel, NOT from the candidate receipt/log. Even a valid signature does
 * not prove different human control, independent physical observation,
 * canonical mainnet inclusion, finality or economically safe pool behavior.
 */
export function verifyPinnedSignedLedgerWitness({witnessReceipt,trustedWitness}={}){
  const p=witnessReceipt?.payload,trust=trustedWitness;
  if(!p||typeof p!=='object'||Array.isArray(p)||!trust||
     typeof trust!=='object'||Array.isArray(trust)||
     typeof trust.witnessId!=='string'||!trust.witnessId||
     typeof trust.ledgerId!=='string'||!trust.ledgerId||
     !Number.isSafeInteger(trust.minimumSequence)||trust.minimumSequence<1||
     typeof trust.spkiDerBase64!=='string'||!trust.spkiDerBase64||
     typeof trust.spkiSha256!=='string'||!/^[0-9a-f]{64}$/.test(trust.spkiSha256)||
     typeof witnessReceipt.signatureBase64!=='string')
    fail('invalid_pinned_witness_inputs');
  if(p.domain!=='FAE_HPA_DURABLE_LEDGER_WITNESS_V1'||
     p.network!==NETWORK||
     p.witnessId!==trust.witnessId||p.ledgerId!==trust.ledgerId||
     !Number.isSafeInteger(p.sequence)||p.sequence<trust.minimumSequence||
     !Number.isSafeInteger(p.shareCount)||p.shareCount<1||p.shareCount>1_000_000||
     typeof p.lastEntryHash!=='string'||!/^[0-9a-f]{64}$/.test(p.lastEntryHash))
    fail('witness_scope_or_sequence_mismatch');

  // Fail closed on extra payload fields: precisely the signed domain fields
  // are admitted, not a caller-designed extension with ambiguous meaning.
  const expected=['domain','network','witnessId','ledgerId','sequence','shareCount','lastEntryHash'];
  if(Object.keys(p).length!==expected.length||expected.some(k=>!Object.hasOwn(p,k)))
    fail('witness_payload_shape_mismatch');
  let key,signature;
  try{
    const raw=Buffer.from(trust.spkiDerBase64,'base64');
    if(!raw.length||raw.toString('base64')!==trust.spkiDerBase64)
      fail('malformed_pinned_witness_key');
    if(createHash('sha256').update(raw).digest('hex')!==trust.spkiSha256)
      fail('pinned_witness_key_fingerprint_mismatch');
    key=createPublicKey({key:raw,format:'der',type:'spki'});
    if(key.asymmetricKeyType!=='ed25519')fail('witness_key_is_not_ed25519');
    signature=Buffer.from(witnessReceipt.signatureBase64,'base64');
    if(signature.length!==64||
       signature.toString('base64')!==witnessReceipt.signatureBase64)
      fail('malformed_witness_signature');
  }catch(error){
    if(error?.code)throw error;
    fail('invalid_witness_key_or_signature_encoding');
  }
  if(!cryptoVerify(null,Buffer.from(stableStringify(p),'utf8'),key,signature))
    fail('pinned_witness_signature_invalid');
  return {
    payload:p,
    trusted_witness_key_fingerprint_matched:true,
    witness_signature_valid:true,
    witness_external_independence_verified_here:false,
    witness_observation_authenticity_verified_here:false,
    witness_trust_configuration_external:true
  };
}
export function reconcileFullTargetAgainstPinnedSignedWitness({
  logFile,witnessReceipt,trustedWitness,
  jobId,nonce,hash,rawChainState,activationHeight=null
}={}){
  const verified=verifyPinnedSignedLedgerWitness({witnessReceipt,trustedWitness});
  const anchored=reconcileFullTargetAgainstAnchoredLedger({
    logFile,
    expectedLastEntryHash:verified.payload.lastEntryHash,
    expectedTotalShares:verified.payload.shareCount,
    jobId,nonce,hash,rawChainState,activationHeight
  });
  return {
    ...anchored,
    witness_signature_valid:true,
    witness_fingerprint_sha256:trustedWitness.spkiSha256,
    witness_sequence:verified.payload.sequence,
    independent_witness_identity_authenticated:false,
    actual_independent_witness_observation_proven:false,
    external_evidence_gate_open:true,
    finality_guaranteed:false,
    safe_to_auto_resubmit:false
  };
}
