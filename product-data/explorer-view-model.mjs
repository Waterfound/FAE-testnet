/**
 * Approved Explorer visual surface mapped to validated node read data.
 * Does not invent a mempool transaction feed, global tx ledger, or PoW percent.
 * Caller owns refresh timing, tip-change retry, and stale/offline rendering.
 */
import {ExplorerDataError} from './explorer-read-adapter.mjs';

function freezeObservation(observation){return Object.freeze(observation);}
function enforceAdapter(adapter){
  if(!adapter||typeof adapter.status!=='function'||typeof adapter.blocks!=='function')
    throw new ExplorerDataError('INVALID_QUERY','A read-only Explorer adapter is required');
}
function same(t1,t2){
  if(!t1||!t2||t1.network!==t2.network||t1.height!==t2.height||t1.hash!==t2.hash)
    throw new ExplorerDataError('TIP_CHANGED','Multiple observations refer to different chain tips');
}
/** Consistent home model. The three-block authored chronology is LOW -> HIGH. */
export async function loadExplorerOverview(adapter,{blockLimit=20}={}){
  enforceAdapter(adapter);
  if(!Number.isSafeInteger(blockLimit)||blockLimit<3||blockLimit>100)
    throw new ExplorerDataError('INVALID_QUERY','blockLimit must be 3–100');
  const status=await adapter.status();
  const blocks=await adapter.blocks({limit:blockLimit,expectedTip:status.tip});
  same(status.tip,blocks.tip);
  const tip=status.tip;
  if(tip.height===Number.MAX_SAFE_INTEGER)
    throw new ExplorerDataError('INVALID_RESPONSE','Height cannot safely advance');
  const selected=blocks.blocks;
  const latest=selected[0]??null;
  if(latest&&latest.height!==tip.height)
    throw new ExplorerDataError('INVALID_RESPONSE','Latest accepted block disagrees with status');
  return freezeObservation({
    state:'observed',
    source:'independently_validated_node',
    network:tip.network,
    binding:tip,
    latestAcceptedHeight:tip.height,
    latestAcceptedHash:tip.hash,
    nextPossibleHeight:tip.height+1,
    miningProgressPercent:null,
    observedMempoolSize:status.data.mempool_size,
    issuanceAtoms:status.data.issued_atoms,
    targetSeconds:status.data.target_seconds,
    acceptedChronology:Object.freeze([...selected.slice(0,3)].sort((a,b)=>a.height-b.height)),
    indexedBlocks:Object.freeze([...selected]),  // actual node order: newest first
    hasGlobalTransactionLedger:false,
    globalTransactions:null,
    globalPendingTransactions:null,
    nextBlocksBeforeHeight:blocks.nextBeforeHeight
  });
}
/** Information that may be shown in a transaction detail on the same tip. */
export async function loadExplorerTransaction(adapter,{txid,expectedTip}={}){
  if(!adapter||typeof adapter.transaction!=='function')
    throw new ExplorerDataError('INVALID_QUERY','A transaction read adapter is required');
  const {tip,transaction}=await adapter.transaction({txid,expectedTip});
  same(tip,expectedTip??tip);
  return freezeObservation({
    source:'independently_validated_node',
    binding:tip,
    txid:transaction.txid,
    status:transaction.status,
    feeAtoms:transaction.fee_atoms,
    inputs:transaction.inputs,
    outputs:transaction.outputs,
    confirmedHeight:transaction.status==='confirmed'?transaction.confirmed_height:null,
    confirmations:transaction.status==='confirmed'?transaction.confirmations:null,
    blockHash:transaction.status==='confirmed'?transaction.block_hash:null
  });
}
/** Explicit UI state from a read failure. Never return a fake success payload. */
export function explorerFailureState(error){
  const code=error instanceof ExplorerDataError?error.code:'NETWORK_UNAVAILABLE';
  const states={
    TIP_CHANGED:'retry_required',
    NETWORK_UNAVAILABLE:'offline',
    TIMEOUT:'offline',
    NETWORK_MISMATCH:'wrong_network',
    INVALID_RESPONSE:'invalid_response',
    NODE_HTTP_ERROR:'unavailable',
    INVALID_QUERY:'invalid_query'
  };
  return freezeObservation({state:states[code]??'unavailable',source:'no_current_validation',code,
    latestAcceptedHeight:null,nextPossibleHeight:null,observedMempoolSize:null,
    acceptedChronology:Object.freeze([]),globalTransactions:null});
}
