import test from 'node:test';
import assert from 'node:assert/strict';
import {loadExplorerOverview,loadExplorerTransaction,explorerFailureState} from './explorer-view-model.mjs';
import {ExplorerDataError} from './explorer-read-adapter.mjs';

const tip={network:'fairyelf-public-testnet-v4',height:12,hash:'a'.repeat(64)};
const blocks=[12,11,10,9].map(height=>({height,hash:String(height).padStart(64,'b'),confirmations:12-height+1}));
const adapter={
  status:async()=>({tip,data:{mempool_size:2,issued_atoms:'123456789012345',target_seconds:180}}),
  blocks:async({expectedTip})=>{
    assert.deepEqual(expectedTip,tip);
    return{tip,blocks,nextBeforeHeight:9};
  },
  transaction:async()=>({tip,transaction:{txid:'c'.repeat(64),status:'pending',fee_atoms:'101',inputs:[],outputs:[],confirmed_height:null,confirmations:null,block_hash:null}})
};
test('real node read model shows full top, candidate, ascending visual chronology',async()=>{
 const o=await loadExplorerOverview(adapter);
 assert.equal(o.latestAcceptedHeight,12);
 assert.equal(o.nextPossibleHeight,13);
 assert.deepEqual(o.acceptedChronology.map(b=>b.height),[10,11,12]);
 assert.deepEqual(o.indexedBlocks.map(b=>b.height),[12,11,10,9]);
 assert.equal(o.observedMempoolSize,2);
 assert.equal(o.miningProgressPercent,null);
 assert.equal(o.hasGlobalTransactionLedger,false);
 assert.equal(o.globalTransactions,null);
});
test('mixed-tip node result is rejected rather than patched with old UI data',async()=>{
 const a={...adapter,blocks:async()=>({tip:{...tip,hash:'d'.repeat(64)},blocks})};
 await assert.rejects(loadExplorerOverview(a),e=>e.code==='TIP_CHANGED');
});
test('the latest accepted block must agree with the selected node tip',async()=>{
 const a={...adapter,blocks:async()=>({tip,blocks:[...blocks.slice(1)]})};
 await assert.rejects(loadExplorerOverview(a),e=>e.code==='INVALID_RESPONSE');
});
test('pending transaction cannot pretend to be confirmed in the UI',async()=>{
 const t=await loadExplorerTransaction(adapter,{txid:'c'.repeat(64),expectedTip:tip});
 assert.equal(t.status,'pending');
 assert.equal(t.confirmations,null);
 assert.equal(t.blockHash,null);
 assert.equal(t.feeAtoms,'101');
});
test('offline/timeout/reorg states contain no stale balances or fabricated blocks',()=>{
 for(const code of ['NETWORK_UNAVAILABLE','TIMEOUT','TIP_CHANGED']){
  const o=explorerFailureState(new ExplorerDataError(code,code));
  assert.equal(o.latestAcceptedHeight,null);
  assert.equal(o.observedMempoolSize,null);
  assert.equal(o.globalTransactions,null);
  assert.deepEqual(o.acceptedChronology,[]);
 }
 assert.equal(explorerFailureState(new ExplorerDataError('TIP_CHANGED','drift')).state,'retry_required');
});
