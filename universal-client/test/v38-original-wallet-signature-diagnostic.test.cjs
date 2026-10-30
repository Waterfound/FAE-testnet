'use strict';
// V38: READ-ONLY original Wallet #342 cryptographic root-cause falsification.
// This is NOT a replacement of the protected Wallet regression and does NOT
// report the original owner's test or full Desktop workflow as passing.
// Original signer and original node consensus verification are both imported
// from the exact protected owner Git head, unchanged.
const test=require('node:test');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {mkdtemp,mkdir,writeFile,realpath,rm}=require('node:fs/promises');
const {join,dirname}=require('node:path');
const {tmpdir}=require('node:os');
const {pathToFileURL}=require('node:url');
const OWNER='17c90ffc313fd11de17396437436e4429472f616';
const SOURCE=[
  'standalone/wallet/crypto.mjs','bip39-en.js',
  'sovereign-forge/node/authoritative/address.mjs',
  'sovereign-forge/node/authoritative/crypto.mjs',
  'sovereign-forge/node/authoritative/canonical.mjs',
  'sovereign-forge/node/authoritative/fae-v4-core.mjs',
  'sovereign-forge/node/authoritative/share-coordinator.mjs',
  'sovereign-forge/node/authoritative/pplns-activation.mjs',
  'sovereign-forge/node/authoritative/node-identity.mjs'
];
async function originalSource(){
  assert.equal(execFileSync('git',['rev-parse',OWNER],{encoding:'utf8'}).trim(),OWNER);
  const dir=await realpath(await mkdtemp(join(tmpdir(),'ts-v38-owner-readonly-')));
  try{
    for(const name of SOURCE){
      const bytes=execFileSync('git',['show',OWNER+':'+name],{maxBuffer:2_000_000});
      const p=join(dir,...name.split('/'));
      await mkdir(dirname(p),{recursive:true});
      await writeFile(p,bytes,{flag:'wx',mode:0o600});
    }
    return dir;
  }catch(e){await rm(dir,{recursive:true,force:true});throw e}
}
test('V38 source-owner exact Ed25519: old first-A tamper has a genuine NO-OP, corrected mutation fails original FAE verifier', {
  skip:process.env.TS_V38_ORIGINAL_SIGNATURE_DIAGNOSTIC!=='1',
  timeout:60000
},async()=>{
  const dir=await originalSource();
  try{
    const wallet=await import(pathToFileURL(join(dir,'standalone/wallet/crypto.mjs')).href);
    const node=await import(pathToFileURL(join(dir,'sovereign-forge/node/authoritative/fae-v4-core.mjs')).href);
    const sender=wallet.deriveRecords(wallet.entropyToMnemonic(Buffer.alloc(32)))[0];
    const receiver=wallet.deriveRecords(wallet.entropyToMnemonic(Buffer.alloc(32,0xab)))[0];
    assert.equal(typeof wallet.buildSignedTransaction,'function');
    assert.equal(typeof node.verifyTxCrypto,'function');
    let beginsA=null,beginsOther=null;
    // Deterministic disposable original-source signature search. This does not
    // mine, transmit, sign through Desktop, unlock a vault or spend funds.
    for(let i=0;i<2048&&(!beginsA||!beginsOther);i++){
      const outpoint=Buffer.from('v38-test-only-'+i.toString()).toString('hex').padEnd(64,'0').slice(0,64)+':0';
      const tx=wallet.buildSignedTransaction(sender,[outpoint],
        [{address:receiver.address,amount_atoms:String(100000000+i)}]).tx;
      if(tx.signature.startsWith('A'))beginsA??=tx;
      else beginsOther??=tx;
    }
    assert.ok(beginsA,'deterministic original Ed25519 witness beginning with A required');
    assert.ok(beginsOther,'non-A original Ed25519 witness required');
    assert.equal(node.verifyTxCrypto(beginsA).ok,true);
    // Exact source-owner regression line 489 behavior, no protected test edited:
    const oldCorruption='A'+beginsA.signature.slice(1);
    assert.equal(oldCorruption,beginsA.signature,'original test may submit EXACT unchanged signature');
    assert.equal(node.verifyTxCrypto({...beginsA,signature:oldCorruption}).ok,true,
      'original node correctly verifies the unchanged authentic signature');
    // Proposed correction must actually alter signed bytes, and original node
    // core (the same validator invoked before UTXO lookup) must reject.
    for(const tx of [beginsA,beginsOther]){
      assert.equal(node.verifyTxCrypto(tx).ok,true);
      const first=tx.signature[0]==='A'?'B':'A';
      const modified=first+tx.signature.slice(1);
      assert.notEqual(modified,tx.signature,'tamper must never be NO-OP');
      const verified=node.verifyTxCrypto({...tx,signature:modified});
      assert.equal(verified.ok,false,'original consensus must reject actually corrupted Ed25519');
      assert.equal(verified.error,'invalid_signature');
      assert.throws(()=>node.acceptTxInto({}, {...tx,signature:modified}),/invalid_signature/,
        'original node mutation entry must reject invalid signature before state access');
    }
    // Do not claim that original owner Wallet test or desktop CI is fixed:
    // source file tests/sovereign-standalone-wallet.test.mjs is UNMODIFIED.
  }finally{await rm(dir,{recursive:true,force:true})}
});
