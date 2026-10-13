/**
 * HPA-W3 — Candidate-only source-ledger payout binding.
 *
 * ShareCoordinator.createWork currently checks only TOTAL payout atoms, while
 * its distributedTemplateProvider may supply arbitrarily redirected payouts.
 * This opt-in adapter checks the REAL source ShareLedger weights before passing
 * the proposed template to that unchanged coordinator. It does NOT activate
 * PPLNS, verify fee-market economics, or establish a pool's trustworthiness.
 */
import {allocatePplnsOutputs} from '../../sovereign-forge/node/authoritative/share-coordinator.mjs';
import {hashHex} from '../../sovereign-forge/node/authoritative/crypto.mjs';
import {NETWORK} from '../../sovereign-forge/node/authoritative/fae-v4-core.mjs';
import {stableStringify} from '../../sovereign-forge/node/authoritative/canonical.mjs';

const fail=(code)=>{throw Object.assign(new Error(code),{code})};
const atoms=x=>typeof x==='string'&&/^(0|[1-9][0-9]*)$/.test(x);
const same=(a,b)=>stableStringify(a)===stableStringify(b);

/**
 * Only use where the ledger and original source-template provider are held by
 * the caller's already-authorized candidate runtime. This does not install it.
 *
 * The weighted SHARE SNAPSHOT is verified both before and after awaiting a
 * potentially adversarial template provider; no new share/job is credited on
 * rejection. Expected payouts use the real FAE allocator and the exact active
 * source ledger, not a caller-supplied 'independent' witness.
 */
export function createLedgerBoundPplnsProvider({ledger,provider,network=NETWORK}={}){
  if(!ledger||typeof ledger.weights!=='function'||
     typeof ledger.summary!=='function'||typeof provider!=='function'||
     network!==NETWORK)fail('invalid_pplns_binding_configuration');
  return async function boundTemplate({weights,fallback_address,...extra}={}){
    if(typeof fallback_address!=='string'||!fallback_address||
       !Array.isArray(weights)||weights.length<1)
      fail('invalid_pplns_payout_snapshot');
    const sourceWeights=ledger.weights(fallback_address)
      .map(({address,weight})=>({address,weight:weight.toString()}));
    if(!same(sourceWeights,weights))fail('pplns_source_share_weights_mismatch');
    const before=ledger.summary();
    const candidate=await provider({weights:structuredClone(sourceWeights),
      fallback_address,...extra});
    const after=ledger.summary();
    if(before.lastEntryHash!==after.lastEntryHash||
       before.totalShares!==after.totalShares)
      fail('pplns_share_window_changed_during_template');

    const header=candidate?.header;
    if(!header||header.network!==network||
       !atoms(header.reward_atoms)||!atoms(header.fee_atoms)||
       header.coinbase_mode!=='pplns-direct')
      fail('pplns_candidate_header_incompatible');
    const total=BigInt(header.reward_atoms)+BigInt(header.fee_atoms);
    if(total<=0n)fail('pplns_zero_payout_not_admitted');
    const expected=allocatePplnsOutputs(total,sourceWeights);
    const canonical=entries=>Array.isArray(entries)&&
      entries.every(x=>x&&typeof x.address==='string'&&atoms(x.amount_atoms));
    if(!canonical(candidate.payouts)||!canonical(candidate.coinbase_outputs)||
       !same(candidate.payouts,expected)||!same(candidate.coinbase_outputs,expected))
      fail('pplns_candidate_payout_diverges_from_ledger');
    if(header.coinbase_count!==expected.length||
       header.coinbase_root!==hashHex(expected))
      fail('pplns_candidate_coinbase_commitment_mismatch');
    return candidate;
  };
}
