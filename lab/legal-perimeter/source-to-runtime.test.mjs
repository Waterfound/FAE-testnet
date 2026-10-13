#!/usr/bin/env node
// A bounded behavioral witness: execute the REAL, baseline-pinned function bodies in
// isolated VM contexts. No production calls, network, wallet mutation or compliance verdict.
// This does not establish full-stack non-custody or deployment/runtime security.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';

const BASE='6d0c3956fdf72cd2e7543eee2539397ed5c0e699';
const GIT_OPTS={encoding:'utf8',timeout:15000,maxBuffer:3000000};
const source=path=>execFileSync('git',['show',BASE+':'+path],GIT_OPTS);
const fragment=(text,open,close)=>{
  const a=text.indexOf(open),b=text.indexOf(close,a+open.length);
  if(a<0||b<=a)throw Error('source boundary unavailable: '+open);
  return text.slice(a,b)+(open.includes('sendFAE')?'\n}':'');
};
const WALLET_SECRET='PRIVATE_JWK_SENTINEL_MUST_NOT_LEAVE_CLIENT';
const TRANSFER='faet1destination';
let n=0;
const test=async(name,fn)=>{await fn();n++;console.log('PASS '+name)};
const walletSource=source('wallet.js');
const client=fragment(walletSource,'async function sendFAE(){','\n}\n\nasync function copyLastSentTxid');
async function runWallet(code=client){
  const calls=[],signed=[];
  const fields={sendamt:{value:'1000'},sendto:{value:TRANSFER},lastsendtx:{hidden:true},lastsendtxid:{value:''},copylastsendtx:{disabled:true}};
  const priv={private_key_jwk:WALLET_SECRET};
  const ctx={
    wallet:{address:'faet1sender',pub:'PUBLIC_SPKI',priv,watchOnly:false},
    NETWORK:'fairyelf-public-testnet-v4',lastSubmittedTxid:'',lastSubmittedAddress:'',
    parseAmt:()=>1000n,validAddr:()=>true,
    $:id=>{assert.ok(Object.hasOwn(fields,id));return fields[id]},
    api:async (path,opts)=>{
      calls.push({path,opts});
      if(path.startsWith('/spendable?'))return {utxos:[{outpoint:'source:0',amount_atoms:'1100'}]};
      if(path==='/submit-tx')return {txid:'TX_ID_FAKE'};
      throw Error('unexpected API '+path);
    },
    crypto:{subtle:{sign:async (algorithm,key,message)=>{
      assert.equal(algorithm,'Ed25519');assert.equal(key,priv);signed.push(message);
      return Uint8Array.from([1,2,3]);
    }}},
    E:{encode:x=>new TextEncoder().encode(x)},stable:JSON.stringify,
    txPayload:t=>({network:t.network,inputs:t.inputs,outputs:t.outputs,public_key_spki:t.public_key_spki}),
    b64:()=>'B64_SIGNATURE',
    FAEWalletTransactions:{acceptedReceipt:({txid,address})=>({txid,address})},
    setStatus:()=>{},refresh:async()=>{}
  };
  vm.runInNewContext(code+'\nglobalThis.__probe=sendFAE;',ctx,{timeout:2000});
  await ctx.__probe();
  return {calls,signed,fields,priv,ctx};
}
function assertOnlyPublicTx(r){
  const txCalls=r.calls.filter(x=>x.path==='/submit-tx');
  assert.equal(txCalls.length,1);
  const payload=txCalls[0].opts.body;
  assert.equal(payload.includes(WALLET_SECRET),false,'private JWK sentinel transmitted');
  const body=JSON.parse(payload);
  assert.deepEqual(Object.keys(body),['tx']);
  assert.deepEqual(Object.keys(body.tx).sort(),['inputs','network','outputs','public_key_spki','signature','version'].sort());
  assert.equal(body.tx.signature,'B64_SIGNATURE');
  assert.equal(body.tx.outputs[0].address,TRANSFER);
  assert.equal(r.signed.length,1);
}
await test('actual canonical sendFAE signs locally and emits bounded public transaction',async()=>assertOnlyPublicTx(await runWallet()));
await test('actual sendFAE watches spendable before submitting signed transaction',async()=>{
  const r=await runWallet();assert.equal(r.calls.length,2);
  assert.match(r.calls[0].path,/^\/spendable\?address=/);
  assert.equal(r.fields.lastsendtxid.value,'TX_ID_FAKE');
});
await test('counterexample: preserved local signing PLUS outgoing secret is rejected',async()=>{
  const needle='body:JSON.stringify({tx:transaction})';
  assert.ok(client.includes(needle),'source changed');
  const bad=client.replace(needle,'body:JSON.stringify({tx:transaction,private_key_jwk:wallet.priv})');
  await assert.rejects(async()=>assertOnlyPublicTx(await runWallet(bad)),/private JWK sentinel transmitted/);
});
await test('private signing identity does not appear in submitted outputs or signature body',async()=>{
  const r=await runWallet();const payload=r.calls[1].opts.body;
  assert.equal(payload.includes('private_key_jwk'),false);
  assert.equal(payload.includes('wallet.priv'),false);
});

const relaySource=source('supabase/functions/fae-public-testnet-v4/index.ts');
const relay=fragment(relaySource,'async function submitTx(body){','async function history(a){');
async function runRelay(code=relay){
  const seen=[];
  const ctx={
    verifyTx:async t=>({ok:true,txid:'FAKE_TXID',from:'faet1sender'}),
    rest:async (endpoint,opts)=>{seen.push({endpoint,opts});return{ok:true}},
    J:(value,status)=>({value,status})
  };
  vm.runInNewContext(code+'\nglobalThis.__relay=submitTx;',ctx,{timeout:2000});
  const payload={tx:{version:2,network:'fairyelf-public-testnet-v4',inputs:['source:0'],
    outputs:[{address:TRANSFER,amount_atoms:'1000'}],public_key_spki:'PUBLIC_SPKI',
    signature:'B64_SIGNATURE',private_key_jwk:WALLET_SECRET}};
  const result=await ctx.__relay(payload);
  return {seen,result};
}
function assertBoundedRelay(r){
  assert.equal(r.seen.length,1);
  assert.equal(r.seen[0].endpoint,'rpc/fae_v4_accept_tx');
  const payload=r.seen[0].opts.body;
  assert.equal(payload.includes(WALLET_SECRET),false,'private JWK sentinel forwarded to RPC');
  assert.deepEqual(Object.keys(JSON.parse(payload)).sort(),
    ['p_txid','p_network','p_from_address','p_public_key_spki','p_signature','p_inputs','p_outputs'].sort());
}
await test('actual hosted relay forwards only the expected signed transaction fields',async()=>assertBoundedRelay(await runRelay()));
await test('hosted source path ignores unexpected private field in RPC output, not inbound API',async()=>{
  const r=await runRelay();assert.equal(r.result.status,200);assertBoundedRelay(r);
});
await test('counterexample: extra key in RPC forwarding is rejected by behavioral witness',async()=>{
  const needle='p_outputs:t.outputs';
  assert.ok(relay.includes(needle),'relay source changed');
  const bad=relay.replace(needle,'p_outputs:t.outputs,p_private_key_jwk:t.private_key_jwk');
  await assert.rejects(async()=>assertBoundedRelay(await runRelay(bad)),/private JWK sentinel forwarded/);
});
console.log(n+'/'+n+' source-to-runtime bounded behavioral tests passed');
