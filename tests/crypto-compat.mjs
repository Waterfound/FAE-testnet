import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';

const elements=new Map();
function fakeElement(){
  return{
    hidden:false,
    tabIndex:0,
    addEventListener(){},
    setAttribute(){},
    classList:{add(){},remove(){},toggle(){}}
  };
}

const context={
  crypto:webcrypto,
  TextEncoder,
  TextDecoder,
  Uint8Array,
  Array,
  Map,
  BigInt,
  Error,
  String,
  Number,
  Object,
  JSON,
  atob,
  btoa,
  console,
  localStorage:{setItem(){},getItem(){return null}},
  document:{getElementById(id){
    if(!elements.has(id))elements.set(id,fakeElement());
    return elements.get(id);
  }}
};
context.window=context;
vm.createContext(context);

for(const file of ['bip39-en.js','core.js','wallet-crypto.js']){
  vm.runInContext(await readFile(new URL('../'+file,import.meta.url),'utf8'),context,{filename:file});
}

const walletCrypto=context.FAEWalletCrypto;
// Generate ephemeral test material so the public test suite never embeds a
// reusable wallet recovery phrase or passphrase.
const testEntropy=crypto.getRandomValues(new Uint8Array(32));
const phrase=await walletCrypto.mnemonicFromEntropy(testEntropy);
const testPassphrase=Array.from(
  crypto.getRandomValues(new Uint8Array(16)),
  byte=>byte.toString(16).padStart(2,'0')
).join('');

const blankA=await walletCrypto.deriveAddressRecords(phrase,'');
const blankB=await walletCrypto.deriveAddressRecords(phrase,'');
assert.equal(blankA.addresses.length,5);
assert.deepEqual(blankA.addresses.map(item=>item.address),blankB.addresses.map(item=>item.address));
assert.equal(new Set(blankA.addresses.map(item=>item.address)).size,5);

const entropy=await walletCrypto.entropyFromMnemonic(phrase);
const legacy=await walletCrypto.keyRecordFromSeed(entropy,0);
assert.equal(blankA.addresses[0].address,legacy.address,'blank passphrase must preserve the original FAE v4 address');

const protectedA=await walletCrypto.deriveAddressRecords(phrase,testPassphrase);
const protectedB=await walletCrypto.deriveAddressRecords(phrase,testPassphrase);
const differentPassphrase=await walletCrypto.deriveAddressRecords(phrase,testPassphrase+'-different');
assert.deepEqual(protectedA.addresses.map(item=>item.address),protectedB.addresses.map(item=>item.address));
assert.notEqual(protectedA.addresses[0].address,blankA.addresses[0].address);
assert.notEqual(protectedA.addresses[0].address,differentPassphrase.addresses[0].address);
assert.equal(new Set(protectedA.addresses.map(item=>item.address)).size,5);

const restored=await walletCrypto.restoreRecordFromJwk(
  protectedA.addresses[2].jwk,
  protectedA.addresses[2].address,
  protectedA.addresses[2].pub,
  2
);
assert.equal(restored.address,protectedA.addresses[2].address);

context.testAddress=protectedA.addresses[0].address;
assert.equal(vm.runInContext('validAddr(testAddress)',context),true);

console.log('FAE wallet derivation and legacy compatibility checks passed.');
