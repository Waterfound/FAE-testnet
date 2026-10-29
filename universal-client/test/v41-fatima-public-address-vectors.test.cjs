'use strict';
// V41 public-only network-address identity vectors.
// These exercise the ORIGINAL FAE Bech32m codec; no duplicate encoder, runtime
// network switch, protected Wallet, original node or consensus mutation.
// 'fatima'/'testfatima' are FUTURE namespaces, not activated here.
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {canonicalAddress}=require('../src/canonical-public-address.cjs');
const {reviewPublicPayment}=require('../src/wallet-payment-review.cjs');
const source=path.resolve(__dirname,'..','..','sovereign-forge','node','authoritative','address.mjs');
const payload=Buffer.from(Array.from({length:20},(_,i)=>i));
const VECTORS=Object.freeze({
  faet:'faet1qqqsyqcyq5rqwzqfpg9scrgwpugpzysn7l0mej',
  fatima:'fatima1qqqsyqcyq5rqwzqfpg9scrgwpugpzysnljmq88',
  testfatima:'testfatima1qqqsyqcyq5rqwzqfpg9scrgwpugpzysnt95l7u'
});
const codec=()=>import(pathToFileURL(source).href);

test('V41 exact original Bech32m HRP vectors are deterministic and independently checksummed',async()=>{
  const {encodeAddress,isValidAddress}=await codec();
  for(const [hrp,expected] of Object.entries(VECTORS)){
    assert.equal(encodeAddress(payload,hrp),expected,
      'original source must reproduce the fixed public candidate vector');
    assert.equal(isValidAddress(expected,hrp),true);
    assert.equal(expected.slice(0,hrp.length+1),hrp+'1');
    assert.equal(expected.length,hrp.length+39,'20-byte payload => 32 symbols + 6 checksum');
  }
  assert.equal(encodeAddress(payload),VECTORS.faet,
    'default original encoding stays FAE v4 and never changes to future TRIUM');
});

test('V41 future testnet, proposed mainnet and legacy addresses reject cross-HRP use',async()=>{
  const {isValidAddress}=await codec();
  for(const [name,encoded] of Object.entries(VECTORS)){
    for(const other of Object.keys(VECTORS))
      assert.equal(isValidAddress(encoded,other),other===name,
        'foreign namespace cannot authenticate in '+other);
    assert.equal(isValidAddress(encoded),name==='faet',
      'FAE v4 default must reject unadmitted future HRP');
  }
  assert.equal(isValidAddress(VECTORS.fatima.replace(/^fatima1/,'faet1'),'faet'),false);
  assert.equal(isValidAddress(VECTORS.testfatima.replace(/^testfatima1/,'fatima1'),'fatima'),false);
});

test('V41 original Bech32m rejects tampering, mixed case, malformed and wrong-length payloads',async()=>{
  const {encodeAddress,isValidAddress}=await codec();
  for(const [hrp,encoded] of Object.entries(VECTORS)){
    const wrongChecksum=encoded.slice(0,-1)+(encoded.at(-1)==='q'?'p':'q');
    const wrongData=encoded.slice(0,hrp.length+1)+'p'+encoded.slice(hrp.length+2);
    for(const invalid of [
      wrongChecksum,wrongData,encoded.toUpperCase(),
      encoded[0].toUpperCase()+encoded.slice(1),
      encoded.slice(0,-1),encoded+'x',
      encoded.replace('1',''),encoded+' ',
      encodeAddress(Buffer.alloc(19),hrp),encodeAddress(Buffer.alloc(21),hrp)
    ])assert.equal(isValidAddress(invalid,hrp),false,
      'invalid public address rejected for '+hrp);
  }
});

test('V41 unadmitted FATIMA HRPs cannot enter current desktop watch or public payment gate',async()=>{
  for(const name of ['fatima','testfatima']){
    await assert.rejects(canonicalAddress(VECTORS[name],source),
      /Invalid canonical FAE public address/);
    await assert.rejects(reviewPublicPayment({
      from:VECTORS[name],to:VECTORS.faet,amount:'1',fee:'0'
    },{addressSource:source}),/Invalid canonical FAE testnet address/);
    await assert.rejects(reviewPublicPayment({
      from:VECTORS.faet,to:VECTORS[name],amount:'1',fee:'0'
    },{addressSource:source}),/Invalid canonical FAE testnet address/);
  }
  assert.equal(await canonicalAddress(VECTORS.faet,source),VECTORS.faet);
  assert.equal((await reviewPublicPayment({
    from:VECTORS.faet,to:VECTORS.faet,amount:'1',fee:'0'
  },{addressSource:source})).state,'UNSIGNED_PUBLIC_REVIEW_ONLY');
});
