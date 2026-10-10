import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

const verifier=resolve('lab/pow-historical-assurance/verify-genesis-zero-hidden-issuance.mjs');

function baseManifest(){
  return{
    schema:'FAE_PRODUCTION_GENESIS_MANIFEST_V1',
    network_id:'fae-mainnet-candidate-test',
    genesis_hash:'1'.repeat(64),
    expected_initial_spendable_atoms:'0',
    genesis_utxos:[],
    imported_utxos:[],
    special_mint_paths:[],
    premine_atoms:'0',
    treasury_atoms:'0',
    administrative_mint_atoms:'0',
    issuance_only_via_frozen_block_rules:true,
    monetary_rules_digest:'2'.repeat(64)
  };
}

async function runManifest(manifest){
  const dir=await mkdtemp(join(tmpdir(),'fae-genesis-assurance-'));
  const file=join(dir,'manifest.json');
  try{
    await writeFile(file,JSON.stringify(manifest));
    return spawnSync(process.execPath,[verifier,file],{encoding:'utf8'});
  }finally{
    await rm(dir,{recursive:true,force:true});
  }
}

test('PF-04/BTCP valid zero-hidden-issuance manifest passes',async()=>{
  const run=await runManifest(baseManifest());
  assert.equal(run.status,0,run.stderr);
  const result=JSON.parse(run.stdout);
  assert.equal(result.status,'PASS_MANIFEST_ZERO_HIDDEN_ISSUANCE');
  assert.equal(result.initial_spendable_atoms,'0');
  assert.equal(result.imported_utxo_count,0);
  assert.equal(result.special_mint_path_count,0);
});

for(const [name,mutate,pattern] of[
  ['genesis UTXO value',m=>m.genesis_utxos=[{amount_atoms:'1'}],/genesis UTXO set creates spendable value/],
  ['imported UTXO',m=>m.imported_utxos=[{outpoint:'legacy:0',amount_atoms:'1'}],/must not import spendable UTXOs/],
  ['special mint path',m=>m.special_mint_paths=['bootstrap_mint'],/must not contain special mint paths/],
  ['premine',m=>m.premine_atoms='1',/Expected values to be strictly equal/],
  ['treasury mint',m=>m.treasury_atoms='1',/Expected values to be strictly equal/],
  ['administrative mint',m=>m.administrative_mint_atoms='1',/Expected values to be strictly equal/]
]){
  test('PF-04/BTCP rejects '+name,async()=>{
    const manifest=baseManifest();
    mutate(manifest);
    const run=await runManifest(manifest);
    assert.notEqual(run.status,0,'invalid manifest unexpectedly passed');
    assert.match(run.stderr,pattern);
  });
}

console.log(JSON.stringify({
  status:'PASS_IF_NODE_TESTS_COMPLETE',
  scope:'PF-04 production-genesis zero-hidden-issuance verifier regressions',
  authority:'VERIFICATION_ONLY'
}));
