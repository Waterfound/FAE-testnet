import test from 'node:test';
import assert from 'node:assert/strict';
import {createExplorerReadAdapter,ExplorerDataError} from './explorer-read-adapter.mjs';

const N='fairyelf-public-testnet-v4',H='a'.repeat(64),TX='b'.repeat(64),BH='c'.repeat(64);
const tip={ok:true,network:N,observed_tip_height:12,observed_tip_hash:H};
const status={...tip,height:12,tip_hash:H,mempool_size:2,target_seconds:180,issued_atoms:'1234567890987654321011'};
const block={height:12,hash:BH,confirmations:1};
const tx={txid:TX,network:N,status:'confirmed',confirmed_height:12,confirmations:1,block_hash:BH,fee_atoms:'8',inputs:[],outputs:[{address:'faet1example',amount_atoms:'100'}]};
const response=(data,statusCode=200)=>({ok:statusCode>=200&&statusCode<300,status:statusCode,json:async()=>data});
function node(routes){
 const calls=[];
 return {calls,fetchImpl:async(url,opts)=>{const u=new URL(url);calls.push({u,opts});return routes[u.pathname](u,opts);}};
}
function rejects(promise,code){return assert.rejects(promise,e=>e instanceof ExplorerDataError&&e.code===code);}

test('requires explicitly configured uncredentialed node, HTTPS except localhost',()=>{
 assert.throws(()=>createExplorerReadAdapter(),{code:'INVALID_QUERY'});
 assert.throws(()=>createExplorerReadAdapter({baseUrl:'https://token@example.org/'}),{code:'INVALID_QUERY'});
 assert.throws(()=>createExplorerReadAdapter({baseUrl:'http://reader.example/'}),{code:'INVALID_QUERY'});
});
test('status is read-only, uncredentialed and never converts large integer atoms',async()=>{
 const m=node({'/explorer/status':()=>response(status)});
 const a=createExplorerReadAdapter({baseUrl:'https://reader.example/',fetchImpl:m.fetchImpl});
 assert.equal((await a.status()).data.issued_atoms,'1234567890987654321011');
 assert.equal(m.calls[0].opts.method,'GET');
 assert.equal(m.calls[0].opts.credentials,'omit');
 assert.equal(m.calls[0].opts.cache,'no-store');
 assert.equal(m.calls[0].opts.redirect,'error');
});
test('block and transaction carry selected-chain confirmation depth',async()=>{
 const m=node({'/explorer/block':()=>response({...tip,block}),'/explorer/transaction':()=>response({...tip,transaction:tx})});
 const a=createExplorerReadAdapter({baseUrl:'https://reader.example/',fetchImpl:m.fetchImpl});
 assert.equal((await a.block({height:12})).block.confirmations,1);
 assert.equal((await a.transaction({txid:TX})).transaction.fee_atoms,'8');
});
test('different observed tip fails closed rather than blending pages',async()=>{
 const m=node({'/explorer/blocks':()=>response({...tip,observed_tip_hash:'d'.repeat(64),blocks:[block],next_before_height:null})});
 const a=createExplorerReadAdapter({baseUrl:'https://reader.example/',fetchImpl:m.fetchImpl});
 await rejects(a.blocks({expectedTip:{network:N,height:12,hash:H}}),'TIP_CHANGED');
});
test('cursor 503 requires re-query and cannot be treated as empty wallet',async()=>{
 const m=node({'/explorer/address':()=>response({ok:false,error:'tip_changed_retry'},503)});
 const a=createExplorerReadAdapter({baseUrl:'https://reader.example/',fetchImpl:m.fetchImpl});
 await rejects(a.address({address:'faet1example',cursor:H+':30'}),'TIP_CHANGED');
});
test('pending transaction cannot claim confirmed depth',async()=>{
 const pending={...tx,status:'pending',confirmed_height:null,block_hash:null,confirmations:1};
 const m=node({'/explorer/transaction':()=>response({...tip,transaction:pending})});
 const a=createExplorerReadAdapter({baseUrl:'https://reader.example/',fetchImpl:m.fetchImpl});
 await rejects(a.transaction({txid:TX}),'INVALID_RESPONSE');
});
test('wrong network rejects even when tip looks valid',async()=>{
 const m=node({'/explorer/status':()=>response({...status,network:'wrong'})});
 const a=createExplorerReadAdapter({baseUrl:'https://reader.example/',fetchImpl:m.fetchImpl});
 await rejects(a.status(),'NETWORK_MISMATCH');
});
test('404 never produces a fabricated record',async()=>{
 const m=node({'/explorer/search':()=>response({ok:false,error:'not_found'},404)});
 const a=createExplorerReadAdapter({baseUrl:'https://reader.example/',fetchImpl:m.fetchImpl});
 await rejects(a.search({query:'11'}),'NODE_HTTP_ERROR');
});
test('tip-bound address cursor and atom-accurate balance survive',async()=>{
 const m=node({'/explorer/address':()=>response({...tip,address:'faet1example',balance_atoms:'999999999999999999999999',events:[],next_cursor:H+':30',total_events:40})});
 const a=createExplorerReadAdapter({baseUrl:'https://reader.example/',fetchImpl:m.fetchImpl});
 const out=await a.address({address:'faet1example'});
 assert.equal(out.balanceAtoms,'999999999999999999999999');
 assert.equal(out.nextCursor,H+':30');
});
test('service unavailable cannot be shown as a fresh block or empty mempool',async()=>{
 const m=node({'/explorer/status':()=>response({ok:false},503)});
 const a=createExplorerReadAdapter({baseUrl:'https://reader.example/',fetchImpl:m.fetchImpl});
 await rejects(a.status(),'TIP_CHANGED');
});
test('invalid numeric node response is rejected',async()=>{
 const m=node({'/explorer/status':()=>response({...status,issued_atoms:1.5})});
 const a=createExplorerReadAdapter({baseUrl:'https://reader.example/',fetchImpl:m.fetchImpl});
 await rejects(a.status(),'INVALID_RESPONSE');
});
