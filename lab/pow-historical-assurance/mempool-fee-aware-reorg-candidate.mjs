/**
 * HPA-UC-001 / W2 — opt-in post-reorg fee-aware salvage candidate.
 * This is NOT a consensus rule, fee policy activation, or public-testnet change.
 * The current FAE reorg algorithm remains the first and default attempt.
 */
import {
  cloneState,normalizeTx,verifyTxCrypto,reconcileDetachedTransactions,preferred
} from '../../sovereign-forge/node/authoritative/fae-v4-core.mjs';
import {assertPendingIndexes,simulateFeeAwareAdmission} from './mempool-fee-aware-shadow-candidate.mjs';

function fail(code){throw Object.assign(new Error(code),{code})}
export function recoverDetachedFeeAware(candidate,previous,{maxAttempts=256}={}){
  if(!Number.isSafeInteger(maxAttempts)||maxAttempts<1||maxAttempts>4096)fail('invalid_recovery_bound');
  if(!preferred(candidate,previous))fail('nonpreferred_reorg');
  assertPendingIndexes(candidate);assertPendingIndexes(previous);
  const canonical=cloneState(candidate),original=cloneState(previous);
  // Preserve default source semantics for all transactions that still fit.
  const first=reconcileDetachedTransactions(canonical,original);
  assertPendingIndexes(first.state);
  const adopted=first.state,acceptedIds=new Set(first.reacceptedRecords.map(x=>x.txid));
  const missing=Object.values(previous.transactions).filter(x=>x&&x.txid
    &&!adopted.transactions[x.txid]&&!candidate.transactions[x.txid]);
  // Only previously signed source-owned transactions are eligible.
  const order=missing.map(record=>{
    const verification=verifyTxCrypto(normalizeTx(record));
    if(!verification.ok||verification.txid!==record.txid)fail('unverified_detached_record');
    return record;
  }).sort((a,b)=>{
    const af=BigInt(a.fee_atoms),bf=BigInt(b.fee_atoms);
    return af===bf?String(a.txid).localeCompare(String(b.txid)):af>bf?-1:1;
  });
  let state=adopted,evicted=[],additional=[],attempted=0,pending=order;
  for(let round=0;round<maxAttempts&&pending.length;round++){
    let advanced=false,next=[];
    for(const record of pending){
      if(attempted++>=maxAttempts){next.push(record);continue}
      try{
        const trial=simulateFeeAwareAdmission(state,normalizeTx(record));
        state=trial.state;
        additional.push(state.transactions[trial.admitted]);
        evicted.push(...trial.evicted);
        acceptedIds.add(trial.admitted);
        advanced=true;
      }catch(error){
        // No override for invalid signatures/conflicts, no unauthorized replay.
        // Waiting for a missing ancestor is safe, but bounded.
        if(error.code==='missing_or_spent_input')next.push(record);
      }
    }
    pending=next;
    if(!advanced)break;
  }
  assertPendingIndexes(state);
  if(state.chain.length!==candidate.chain.length||state.chain.some((x,i)=>x.hash!==candidate.chain[i].hash))
    fail('reorg_changed_validated_chain');
  const reacceptedRecords=[...first.reacceptedRecords.filter(r=>state.transactions[r.txid]?.status==='pending'),
    ...additional.filter(r=>state.transactions[r.txid]?.status==='pending')];
  return {state,reacceptedRecords,rejected:missing.length-additional.length+
    Math.max(0,first.rejected-missing.length),attempted,evicted,
    disposition:'isolated_fee_aware_reorg_candidate_only'};
}
