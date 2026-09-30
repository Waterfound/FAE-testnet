'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import {
  NETWORK, buildSubmission, doubleHashHex, hashHeaderNonce, leadingZeroBits,
  mineChunk, tipState, validAddress, validateTemplate, workMeetsTarget
} from '../standalone/mining-core.mjs';

const address='faet1z5g4r8qgv29jcy350mvxgr3hpk35vjhdk3s6fn';

function canonicalReference(value){
  if(Array.isArray(value))return value.map(canonicalReference);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonicalReference(value[key])]));
  return value;
}
function stableReference(value){return JSON.stringify(canonicalReference(value))}
function nodeReferenceHash(value){
  const first=createHash('sha256').update(Buffer.from(stableReference(value))).digest();
  return createHash('sha256').update(first).digest('hex');
}
async function browserReferenceHash(value){
  const bytes=new TextEncoder().encode(stableReference(value));
  const first=await webcrypto.subtle.digest('SHA-256',bytes);
  const second=await webcrypto.subtle.digest('SHA-256',first);
  return Buffer.from(second).toString('hex');
}
function referenceLeadingZeroBits(hash){
  let count=0;
  for(const character of hash){
    const value=parseInt(character,16);
    if(value===0){count+=4;continue}
    if(value<2)count+=3;else if(value<4)count+=2;else if(value<8)count++;
    break;
  }
  return count;
}
function template({difficulty=1,height=1,previousHash='0'.repeat(64)}={}){
  const txids=[];
  return{
    ok:true,
    template_policy:'snapshot',
    header:{
      network:NETWORK,
      height,
      previous_hash:previousHash,
      timestamp_ms:1770000000000,
      difficulty_bits:difficulty,
      miner_address:address,
      reward_atoms:'1000000000',
      tx_root:nodeReferenceHash(txids),
      tx_count:0
    },
    txids
  };
}

test('reward address validation matches active faet1 shape',()=>{
  assert.equal(validAddress(address),true);
  assert.equal(validAddress(address.toUpperCase()),false);
  assert.equal(validAddress('faet1invalid'),false);
});

test('standalone, node-style and browser-style hashing are deterministic parity',async()=>{
  const header=template({difficulty:18}).header;
  for(const nonce of [0,1,42,65535,999999]){
    const value={...header,nonce};
    const standalone=doubleHashHex(value);
    const node=nodeReferenceHash(value);
    const browser=await browserReferenceHash(value);
    assert.equal(standalone,node);
    assert.equal(standalone,browser);
    assert.equal(hashHeaderNonce(header,nonce),standalone);
    assert.equal(leadingZeroBits(standalone),referenceLeadingZeroBits(standalone));
  }
});

test('template interpretation and tip identity are fail closed',()=>{
  const current=template();
  assert.equal(validateTemplate(current,{address}).header.miner_address,address);
  assert.equal(tipState(current.header,{height:0,tip_hash:'0'.repeat(64)}),'current');
  assert.equal(tipState(current.header,{height:1,tip_hash:'1'.repeat(64)}),'stale');
  assert.equal(tipState(current.header,{height:-1,tip_hash:'0'.repeat(64)}),'unknown');

  assert.throws(()=>validateTemplate({...current,header:{...current.header,miner_address:'faet1invalid'}},{address}),/REWARD_ADDRESS/);
  assert.throws(()=>validateTemplate({...current,header:{...current.header,tx_root:'f'.repeat(64)}},{address}),/TX_ROOT/);
  assert.throws(()=>validateTemplate({...current,header:{...current.header,difficulty_bits:0}},{address}),/TARGET/);
});

test('found work serializes exactly the active node submission envelope',()=>{
  const candidate=template({difficulty:1});
  const work=mineChunk(candidate.header,{startNonce:0,maxHashes:128});
  assert.equal(work.found,true);
  assert.equal(workMeetsTarget(work.hash,candidate.header.difficulty_bits),true);
  const submission=buildSubmission(candidate,work.nonce,work.hash);
  assert.deepEqual(Object.keys(submission).sort(),['hash','header','nonce','txids']);
  assert.equal(submission.header,candidate.header);
  assert.equal(submission.nonce,work.nonce);
  assert.equal(submission.hash,nodeReferenceHash({...candidate.header,nonce:work.nonce}));
  assert.deepEqual(submission.txids,[]);
});
