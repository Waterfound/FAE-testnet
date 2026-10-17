/**
 * Element 5 isolated source falsification against the actual Explorer adapter.
 * A syntactically valid node response must also match the exact requested
 * object identity. Otherwise a malicious/stale node can substitute a different
 * signed transaction or block while claiming the same valid chain tip.
 * No keys, wallet source, consensus code, external provider or real funds.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createExplorerReadAdapter,ExplorerDataError} from './explorer-read-adapter.mjs';

const N='fairyelf-public-testnet-v4';
const A='a'.repeat(64),B='b'.repeat(64),C='c'.repeat(64),D='d'.repeat(64);
const tip={ok:true,network:N,observed_tip_height:12,observed_tip_hash:A};
const tx={txid:B,network:N,status:'confirmed',confirmed_height:12,
  confirmations:1,block_hash:C,fee_atoms:'0',inputs:[],outputs:[]};
const block={height:12,hash:C,confirmations:1};
const client=(path,data)=>createExplorerReadAdapter({
  baseUrl:'https://independent-node.invalid/',
  fetchImpl:async(url,opts)=>{
    assert.equal(new URL(url).pathname,path);
    assert.equal(opts.method,'GET');
    assert.equal(opts.credentials,'omit');
    return {ok:true,status:200,json:async()=>data};
  }
});
const invalid=error=>error instanceof ExplorerDataError&&error.code==='INVALID_RESPONSE';

test('transaction exact requested TXID matches returned validated-node record',async()=>{
  const a=client('/explorer/transaction',{...tip,transaction:tx});
  assert.equal((await a.transaction({txid:B})).transaction.txid,B);
});
test('transaction wrong TXID at the same tip is rejected, never displayed as requested',async()=>{
  const a=client('/explorer/transaction',{...tip,transaction:tx});
  await assert.rejects(a.transaction({txid:D}),invalid);
});
test('block exact requested height is bound to returned chain record',async()=>{
  const a=client('/explorer/block',{...tip,block});
  assert.equal((await a.block({height:12})).block.height,12);
});
test('block wrong height at the same tip is rejected, never displayed as requested',async()=>{
  const a=client('/explorer/block',{...tip,block});
  await assert.rejects(a.block({height:11}),invalid);
});
test('block wrong hash at the same tip is rejected, never displayed as requested',async()=>{
  const a=client('/explorer/block',{...tip,block});
  await assert.rejects(a.block({hash:D}),invalid);
});
