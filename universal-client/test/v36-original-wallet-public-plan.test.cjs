'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,mkdir,writeFile,realpath,rm}=require('node:fs/promises');
const {execFileSync}=require('node:child_process');
const {tmpdir}=require('node:os');
const {join,dirname}=require('node:path');
const {planWithOriginalWallet}=require('../src/v36-original-wallet-public-plan.cjs');
const {WALLET_OWNER_HEAD}=require('../src/native-wallet-terminal-handoff.cjs');
const NETWORK='fairyelf-public-testnet-v4';
const A='faet1z5g4r8qgv29jcy350mvxgr3hpk35vjhdk3s6fn';
const H=x=>x.repeat(64);
const excluded=['PROCESS_IDENTITY_UNAUTHENTICATED','KEY_OWNERSHIP_UNVERIFIED','SOURCE_PROVENANCE_UNVERIFIED','MATURITY_POLICY_UNVERIFIED'];
const review=Object.freeze({network:NETWORK,from:A,to:A,
  amount_fae:'1',fee_fae:'0.00000001',state:'UNSIGNED_PUBLIC_REVIEW_ONLY',
  signing:'UNAVAILABLE',submission:'NOT_SUBMITTED'});
function candidates(){
  return {ok:true,network:NETWORK,address:A,authority:'SELECTED_NODE_UNTRUSTED_UTXO_CLAIM',
    funding_authorization:'DENIED_UNVERIFIED',eligible_candidate_count:0,
    eligible_candidate_atoms:'0',ownership:'NOT_VERIFIED',maturity:'NOT_VERIFIED',
    signer:'UNAVAILABLE',submission:'NOT_PERFORMED',observed_tip_height:250,
    observed_tip_hash:H('c'),confirmed_candidate_atoms:'150000000',
    candidate_atoms:'1150000000',outputs:[
      {outpoint:H('a')+':0',source:'confirmed',amount_atoms:'150000000',
        created_height:1,spend_eligibility:'UNVERIFIED',exclusion_reasons:excluded},
      {outpoint:H('b')+':1',source:'pending',amount_atoms:'1000000000',
        parent_txid:H('b'),spend_eligibility:'UNVERIFIED',
        exclusion_reasons:[...excluded,'UNCONFIRMED_PARENT']}
    ]};
}
test('V36 no owner-authenticated original Wallet bundle implies no plan, no signer, no submit',async()=>{
  const r=await planWithOriginalWallet({walletScript:null,review,candidates:candidates()});
  assert.equal(r.state,'ORIGINAL_WALLET_SOURCE_UNAVAILABLE');
  assert.equal(r.signing,'NOT_ADMITTED');assert.equal(r.submission,'NOT_SUBMITTED');
  assert.equal(r.input_authorization,'DENIED_UNVERIFIED');
  assert.ok(!Object.hasOwn(r,'selected_inputs'));
});
test('V36 forged authority, modified network and fake key ownership are rejected',async()=>{
  const wrong=candidates();wrong.network='attacker-mainnet';
  await assert.rejects(planWithOriginalWallet({walletScript:null,review,candidates:wrong}),/Untrusted/);
  const admitted=candidates();admitted.eligible_candidate_count=1;
  await assert.rejects(planWithOriginalWallet({walletScript:null,review,candidates:admitted}),/Untrusted/);
  const forged=candidates();forged.outputs[0].spend_eligibility='APPROVED';
  await assert.rejects(planWithOriginalWallet({walletScript:null,review,candidates:forged}),/unverified|forged/);
  const repl=candidates();repl.outputs[1].outpoint=repl.outputs[0].outpoint;
  await assert.rejects(planWithOriginalWallet({walletScript:null,review,candidates:repl}),/unverified|forged/);
  await assert.rejects(planWithOriginalWallet({walletScript:null,review:{...review,signing:'ADMITTED'},candidates:candidates()}),/Untrusted/);
});
const SOURCE=[
  'standalone/wallet/fae-wallet.mjs','standalone/wallet/crypto.mjs',
  'standalone/wallet/vault.mjs','standalone/wallet/outbox.mjs',
  'sovereign-forge/node/authoritative/address.mjs',
  'sovereign-forge/node/authoritative/crypto.mjs',
  'sovereign-forge/node/authoritative/canonical.mjs','bip39-en.js'
];
async function stageOriginalOwner(){
  const folder=await realpath(await mkdtemp(join(tmpdir(),'ts-v36-real-original-wallet-')));
  for(const file of SOURCE){
    const bytes=execFileSync('git',['show',WALLET_OWNER_HEAD+':'+file],{maxBuffer:100000});
    const target=join(folder,...file.split('/'));
    await mkdir(dirname(target),{recursive:true});
    await writeFile(target,bytes,{flag:'wx',mode:0o600});
  }
  return{folder,script:join(folder,'standalone','wallet','fae-wallet.mjs')};
}
test('V36 ACTUAL source-owner Wallet #342 planSpend selects original confirmed inputs, exact original change, never signs', {
  skip:process.env.TS_V36_REAL_ORIGINAL_WALLET!=='1',timeout:60000
},async()=>{
  const stage=await stageOriginalOwner();
  try{
    const r=await planWithOriginalWallet({
      walletScript:stage.script,review,candidates:candidates()});
    assert.equal(r.origin,'ORIGINAL_WALLET_342_SOURCE_PINNED');
    assert.equal(r.state,'ORIGINAL_WALLET_UNVERIFIED_PUBLIC_PLAN');
    assert.equal(r.input_count,1,'original selector must ignore pending UTXO');
    assert.equal(r.selected_inputs[0],H('a')+':0');
    assert.equal(r.outputs.length,2);
    assert.equal(r.outputs[0].address,A);
    assert.equal(r.outputs[0].amount_atoms,'100000000');
    assert.equal(r.outputs[1].amount_atoms,'49999999');
    assert.equal(r.selected_atoms,'150000000');
    assert.equal(r.fee_atoms,'1');
    assert.equal(r.input_authorization,'DENIED_UNVERIFIED');
    assert.equal(r.signing,'NOT_ADMITTED');
    assert.equal(r.submission,'NOT_SUBMITTED');
    for(const name of ['signature','privateKey','mnemonic','tx','signed_tx'])
      assert.equal(Object.hasOwn(r,name),false);
    const noFunds=candidates();
    noFunds.outputs[0].amount_atoms='1';
    noFunds.candidate_atoms='1000000001';
    noFunds.confirmed_candidate_atoms='1';
    const insufficient=await planWithOriginalWallet({
      walletScript:stage.script,review,candidates:noFunds});
    assert.equal(insufficient.state,'INSUFFICIENT_UNVERIFIED_CONFIRMED_CANDIDATES');
    assert.ok(!Object.hasOwn(insufficient,'selected_inputs'));
    await writeFile(stage.script,'\n// tampered wallet original', {flag:'a'});
    await assert.rejects(planWithOriginalWallet({
      walletScript:stage.script,review,candidates:candidates()}),/digest mismatch|unsafe|mismatch/);
  }finally{await rm(stage.folder,{recursive:true,force:true})}
});
