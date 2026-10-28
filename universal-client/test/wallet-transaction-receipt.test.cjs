'use strict';
// Real renderer wiring test of the selected-node TX receipt. No signer,
// submission, secrets or synthetic confirmation is introduced into the client.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const TX='a'.repeat(64),TIP='b'.repeat(64),BLOCK='c'.repeat(64);
const NETWORK='fairyelf-public-testnet-v4';
function receipt(status='pending'){
  const confirmed=status==='confirmed';
  return {
    ok:true,network:NETWORK,observed_tip_height:12,observed_tip_hash:TIP,
    transaction:{
      txid:TX,network:NETWORK,status,
      confirmed_height:confirmed?10:null,
      block_hash:confirmed?BLOCK:null,
      confirmations:confirmed?3:null
    }
  };
}
async function boot(explorer,{fundingCandidates=async()=>{throw Error('Funding fixture unavailable')}}={}){
  const elements=new Map();
  const get=id=>{
    if(!elements.has(id)){
      const events=new Map();
      elements.set(id,{
        id,events,textContent:'',value:'',hidden:false,disabled:false,
        classList:{toggle(){},contains(){return true}},
        addEventListener:(type,callback)=>events.set(type,callback),
        removeAttribute(){},setAttribute(){},replaceChildren(){},append(){}
      });
    }
    return elements.get(id);
  };
  const document={
    hidden:false,getElementById:get,querySelectorAll:()=>[],addEventListener(){}
  };
  let onState;
  const window={triumph:{
    onState:callback=>{onState=callback;return()=>{}},
    snapshot:async()=>({node:'running',miner:'stopped',telemetry:{}}),
    explorer,fundingCandidates
  }};
  const filename=path.resolve(__dirname,'../src/renderer.js');
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),{
    document,window,console,setTimeout,clearTimeout,
    matchMedia:()=>({matches:true,addEventListener(){}})
  },{filename});
  await new Promise(resolve=>setImmediate(resolve));
  return {
    get,
    setNode:node=>onState({node,miner:'stopped',telemetry:{}}),
    query:async id=>{
      get('wallet-txid').value=id;
      return get('wallet-tx-track').events.get('click')();
    }
  };
}
test('Wallet TX receipt observes actual selected-node pending and confirmed schemas without signing',async()=>{
  let current=receipt('pending'),calls=0;
  const ui=await boot(async(route,selector)=>{
    calls++;
    assert.equal(route,'/explorer/transaction');
    assert.equal(selector.txid,TX);
    return current;
  });
  await ui.query(TX);
  assert.match(ui.get('wallet-tx-output').textContent,/PENDING · SELECTED NODE MEMPOOL CLAIM/);
  assert.doesNotMatch(ui.get('wallet-tx-output').textContent,/CONFIRMED BY SELECTED NODE/);
  current=receipt('confirmed');
  await ui.query(TX);
  const output=ui.get('wallet-tx-output').textContent;
  assert.match(output,/CONFIRMED BY SELECTED NODE · 3 local-chain confirmation/);
  assert.match(output,/Included at block #10/);
  assert.match(output,/Desktop Wallet signing: UNAVAILABLE/);
  assert.ok(output.includes('\n'), 'Receipt must render separate observation lines');
  assert.equal(calls,2);
});
test('inconsistent selected-node transaction observations cannot claim confirmation',async()=>{
  let current={...receipt('confirmed'),transaction:{...receipt('confirmed').transaction,confirmations:4}};
  const ui=await boot(async()=>current);
  await ui.query(TX);
  assert.match(ui.get('wallet-tx-output').textContent,/Inconsistent confirmed/);
  current={...receipt('pending'),transaction:{...receipt('pending').transaction,block_hash:BLOCK}};
  await ui.query(TX);
  assert.match(ui.get('wallet-tx-output').textContent,/Contradictory pending/);
  current={...receipt('confirmed'),transaction:{...receipt('confirmed').transaction,txid:'d'.repeat(64)}};
  await ui.query(TX);
  assert.match(ui.get('wallet-tx-output').textContent,/No compatible transaction observation/);
});
test('invalid TXID and stopped node reject transaction reads before invoking Explorer',async()=>{
  let calls=0;
  const ui=await boot(async()=>{calls++;return receipt()});
  await ui.query('not-a-txid');
  assert.match(ui.get('wallet-tx-output').textContent,/Invalid FAE testnet transaction ID/);
  assert.equal(calls,0);
  ui.setNode('stopped');
  await ui.query(TX);
  assert.match(ui.get('wallet-tx-output').textContent,/Start your local node/);
  assert.equal(calls,0);
});
test('changed TXID and node shutdown invalidate an in-flight receipt',async()=>{
  let release;
  const ui=await boot(()=>new Promise(resolve=>{release=resolve}));
  const inFlight=ui.query(TX);
  ui.get('wallet-txid').value='d'.repeat(64);
  ui.get('wallet-txid').events.get('input')();
  release(receipt('confirmed'));
  await inFlight;
  assert.match(ui.get('wallet-tx-output').textContent,/Transaction ID changed/);
  const next=ui.query(TX);
  ui.setNode('stopped');
  release(receipt('confirmed'));
  await next;
  assert.match(ui.get('wallet-tx-output').textContent,/Selected-node observation cleared/);
});

test('Wallet renders exact selected-node confirmed and pending funding candidate amounts without signing',async()=>{
  const addr='faet1z5g4r8qgv29jcy350mvxgr3hpk35vjhdk3s6fn';
  let calls=0;
  const ui=await boot(async()=>null,{fundingCandidates:async requested=>{
    calls++;assert.equal(requested,addr);
    return {authority:'SELECTED_NODE_UNTRUSTED_UTXO_CLAIM',
      address:addr,candidate_atoms:'9007199254741000',
      confirmed_candidate_atoms:'9007199254740993',
      pending_candidate_atoms:'7',candidate_count:2,
      observed_tip_height:12,observed_tip_hash:TIP,
      outputs:[
        {outpoint:TX+':0',amount_atoms:'9007199254740993',source:'confirmed',created_height:1},
        {outpoint:BLOCK+':1',amount_atoms:'7',source:'pending',parent_txid:BLOCK}
      ]};
  }});
  ui.get('wallet-address').value=addr;
  await ui.get('funding-candidates-refresh').events.get('click')();
  const displayed=ui.get('funding-candidates-output').textContent;
  assert.match(displayed,/SELECTED NODE FUNDING CANDIDATES/);
  assert.match(displayed,/90071992\.54740993 FAE/);
  assert.match(displayed,/Claimed pending outputs: 0\.00000007 FAE/);
  assert.match(displayed,/Coinbase maturity: NOT VERIFIED/);
  assert.match(displayed,/Signing: UNAVAILABLE/);
  assert.ok(displayed.includes('\n'));
  assert.equal(calls,1);
});
test('funding candidate read is revoked when the address or managed node changes',async()=>{
  const addr='faet1z5g4r8qgv29jcy350mvxgr3hpk35vjhdk3s6fn';
  let release;
  const ui=await boot(async()=>null,{fundingCandidates:()=>new Promise(resolve=>{release=resolve})});
  ui.get('wallet-address').value=addr;
  const first=ui.get('funding-candidates-refresh').events.get('click')();
  ui.get('wallet-address').value='different-address';
  ui.get('wallet-address').events.get('input')();
  release({authority:'SELECTED_NODE_UNTRUSTED_UTXO_CLAIM',address:addr});
  await first;
  assert.match(ui.get('funding-candidates-output').textContent,/Node or selected address changed/);
  ui.get('wallet-address').value=addr;
  const second=ui.get('funding-candidates-refresh').events.get('click')();
  ui.setNode('stopped');
  release({authority:'SELECTED_NODE_UNTRUSTED_UTXO_CLAIM',address:addr});
  await second;
  assert.match(ui.get('funding-candidates-output').textContent,/Node or selected address changed/);
});
