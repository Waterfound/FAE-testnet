import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const file=process.argv[2];
if(!file)throw new Error('usage: node verify-genesis-zero-hidden-issuance.mjs <manifest.json>');
const manifest=JSON.parse(await readFile(file,'utf8'));

function atoms(value,label){
  assert.equal(typeof value,'string',label+' must be decimal string');
  assert.match(value,/^\d+$/,label+' must be unsigned decimal atoms');
  return BigInt(value);
}
function array(value,label){
  assert.ok(Array.isArray(value),label+' must be array');
  return value;
}

assert.equal(manifest.schema,'FAE_PRODUCTION_GENESIS_MANIFEST_V1');
assert.equal(typeof manifest.network_id,'string');
assert.ok(manifest.network_id.length>0);
assert.match(String(manifest.genesis_hash||''),/^[0-9a-f]{64}$/);
assert.equal(atoms(manifest.expected_initial_spendable_atoms,'expected_initial_spendable_atoms'),0n,'FAE production genesis must begin with zero spendable premine');

const genesisUtxos=array(manifest.genesis_utxos,'genesis_utxos');
const imported=array(manifest.imported_utxos,'imported_utxos');
const specialMintPaths=array(manifest.special_mint_paths,'special_mint_paths');

let spendable=0n;
for(const [index,row] of genesisUtxos.entries()){
  assert.equal(typeof row,'object','genesis_utxo_'+index);
  const amount=atoms(row.amount_atoms,'genesis_utxo_'+index+'_amount');
  assert.ok(amount>=0n);
  spendable+=amount;
}

assert.equal(spendable,0n,'genesis UTXO set creates spendable value');
assert.equal(imported.length,0,'production genesis must not import spendable UTXOs');
assert.equal(specialMintPaths.length,0,'production genesis must not contain special mint paths');
assert.equal(atoms(manifest.premine_atoms,'premine_atoms'),0n);
assert.equal(atoms(manifest.treasury_atoms,'treasury_atoms'),0n);
assert.equal(atoms(manifest.administrative_mint_atoms,'administrative_mint_atoms'),0n);
assert.equal(manifest.issuance_only_via_frozen_block_rules,true);
assert.match(String(manifest.monetary_rules_digest||''),/^[0-9a-f]{64}$/);

console.log(JSON.stringify({
  schema:'FAE_PRODUCTION_GENESIS_ZERO_HIDDEN_ISSUANCE_RESULT_V1',
  status:'PASS_MANIFEST_ZERO_HIDDEN_ISSUANCE',
  network_id:manifest.network_id,
  genesis_hash:manifest.genesis_hash,
  initial_spendable_atoms:spendable.toString(),
  imported_utxo_count:imported.length,
  special_mint_path_count:specialMintPaths.length,
  non_claims:[
    'Manifest validation does not replace replay of the executable final consensus from genesis.',
    'The final genesis bytes/hash and monetary-rules digest must be bound to the launch-state freeze.'
  ],
  authority:'VERIFICATION_ONLY'
},null,2));
