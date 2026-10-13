#!/usr/bin/env node
// LRP-001: real cryptographic verification from the canonical deployed Edge source.
// Inert local WebCrypto keys, stubbed helper/network/DB access, no production calls.
// This tests one source-level signature gate; it does not prove server/custody sovereignty.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {webcrypto,createHash} from 'node:crypto';
import vm from 'node:vm';

const BASE='6d0c3956fdf72cd2e7543eee2539397ed5c0e699';
const FILE='supabase/functions/fae-public-testnet-v4/index.ts';
const src=execFileSync('git',['show',BASE+':'+FILE],{encoding:'utf8',timeout:15000,maxBuffer:3000000});
const begin=src.indexOf('function txPayload(t){');
const finish=src.indexOf('async function submitBlock(body)',begin);
assert.ok(begin>=0&&finish>begin,'deployed Edge verification boundary moved');
const fragment=src.slice(begin,finish);
assert.match(fragment,/async function verifyTx\(t\)/);
assert.match(fragment,/crypto\.subtle\.verify/);
const norm=value=>{
 if(Array.isArray(value))return value.map(norm);
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,norm(value[k])]));
 return value;
};
const stable=value=>JSON.stringify(norm(value));
const E=new TextEncoder();
const calls=[];
const ctx={
 N:'fairyelf-public-testnet-v4',
 crypto:webcrypto,
 E,stable,
 b64d:value=>new Uint8Array(Buffer.from(value,'base64')),
 sha:async x=>new Uint8Array(createHash('sha256').update(x).digest()),
 encAddr:()=> 'faet1source',
 validAddr:x=>typeof x==='string'&&x.startsWith('faet1'),
 atom:x=>BigInt(x),
 dh:async ()=> 'TXID_TEST',
 rest:async (path,opts)=>{calls.push({path,opts});return{ok:true}},
 J:(value,status)=>({value,status})
};
vm.runInNewContext(fragment+'\nglobalThis.__verify=verifyTx;globalThis.__submit=submitTx;globalThis.__payload=txPayload;',ctx,{timeout:2000});
let n=0;const test=async(name,fn)=>{await fn();n++;console.log('PASS '+name)};
const pair=await webcrypto.subtle.generateKey({name:'Ed25519'},true,['sign','verify']);
const spki=Buffer.from(await webcrypto.subtle.exportKey('spki',pair.publicKey)).toString('base64');
const freshTx=()=>({version:2,network:'fairyelf-public-testnet-v4',inputs:['source:0'],
 outputs:[{address:'faet1recipient',amount_atoms:'1000'}],public_key_spki:spki,signature:''});
async function sign(t){
 const payload=E.encode(stable(ctx.__payload(t)));
 t.signature=Buffer.from(await webcrypto.subtle.sign('Ed25519',pair.privateKey,payload)).toString('base64');
 return t;
}
const good=await sign(freshTx());
await test('real Edge verifyTx accepts real Ed25519 signature over actual payload',async()=>{
 const verdict=await ctx.__verify(good);assert.equal(verdict.ok,true);
});
await test('real Edge verifyTx rejects altered recipient despite retaining signature',async()=>{
 const bad=structuredClone(good);bad.outputs[0].address='faet1attacker';
 const verdict=await ctx.__verify(bad);assert.equal(verdict.ok,false);
 assert.equal(verdict.error,'invalid signature');
});
await test('real Edge verifyTx rejects forged signature',async()=>{
 const bad=structuredClone(good);bad.signature=Buffer.alloc(64,42).toString('base64');
 assert.equal((await ctx.__verify(bad)).ok,false);
});
await test('real Edge submitTx never reaches service-role RPC on tampered output',async()=>{
 calls.length=0;
 const bad=structuredClone(good);bad.outputs[0].amount_atoms='999';
 const verdict=await ctx.__submit({tx:bad});
 assert.equal(verdict.status,400);assert.equal(calls.length,0);
});
await test('real Edge submitTx only forwards verified transaction to privileged RPC',async()=>{
 calls.length=0;
 const result=await ctx.__submit({tx:good});
 assert.equal(result.status,200);assert.equal(calls.length,1);
 assert.equal(calls[0].path,'rpc/fae_v4_accept_tx');
 const params=JSON.parse(calls[0].opts.body);
 assert.equal(params.p_public_key_spki,spki);
 assert.equal(params.p_signature,good.signature);
 assert.equal(JSON.stringify(params.p_outputs).includes('faet1recipient'),true);
});
console.log(n+'/'+n+' real-source Ed25519 Edge enforcement tests passed (source-level, not provider live probe)');
