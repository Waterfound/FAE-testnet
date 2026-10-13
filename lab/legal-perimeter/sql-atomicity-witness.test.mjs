#!/usr/bin/env node
// FAE-LRP-001: REPRODUCIBLE SOURCE COUNTEREXAMPLE ONLY.
// Reads canonical Git migration; never calls a database or changes consensus.
// This is an owner handoff witness, not a fix nor a certification of runtime safety.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const BASE='6d0c3956fdf72cd2e7543eee2539397ed5c0e699';
const MIGRATION='supabase/migrations/20260903_fae_v4_canonical.sql';
function functionBody(sql){
 const m=/create\s+or\s+replace\s+function\s+public\.fae_v4_accept_block_v2\s*\([\s\S]*?\)\s*returns\s+jsonb\s+language\s+plpgsql\s+security\s+definer\s+set\s+search_path\s+to\s+'public'\s+as\s+\$\$([\s\S]*?)\$\$;/i.exec(sql);
 if(!m)throw Error('canonical block acceptor not present; review source manually');
 return m[1];
}
export function findPostInsertRejections(sql){
 const body=functionBody(sql),insert=/\binsert\s+into\s+public\.fae_v4_blocks\s*\(/ig;
 const ins=insert.exec(body);
 if(!ins)return ['MISSING_INSERT_BOUNDARY'];
 const post=body.slice(ins.index+ins[0].length).split(/\nexception\s+when\b/i)[0];
 return [...post.matchAll(/\breturn\s+jsonb_build_object\s*\(\s*'ok'\s*,\s*false\s*,\s*'reason'\s*,\s*'([^']+)'/gi)]
   .map(m=>m[1]);
}
let tests=0;const test=(name,fn)=>{fn();tests++;console.log('PASS '+name)};
const src=execFileSync('git',['show',BASE+':'+MIGRATION],{encoding:'utf8',timeout:15000});
test('exact pinned canonical migration is inspected',()=>assert.match(src,/create or replace function public\.fae_v4_accept_block_v2\(/i));
test('post-insert rejection without SQL exception is an unresolved atomicity risk',()=>{
 const list=findPostInsertRejections(src);
 assert.ok(list.includes('tx_not_pending'),JSON.stringify(list));
 assert.ok(list.includes('reservation_missing'),JSON.stringify(list));
 assert.ok(list.includes('input_already_spent'),JSON.stringify(list));
});
test('detector does not misclassify failure checks that precede INSERT',()=>{
 const fixed=src.replace(
  "  insert into public.fae_v4_blocks(height,hash,previous_hash,timestamp_ms,difficulty_bits,nonce,miner_address,reward_atoms,header_json,txids)",
  "  if not found then return jsonb_build_object('ok',false,'reason','preflight_check'); end if;\n  insert into public.fae_v4_blocks(height,hash,previous_hash,timestamp_ms,difficulty_bits,nonce,miner_address,reward_atoms,header_json,txids)"
 );
 assert.ok(!findPostInsertRejections(fixed).includes('preflight_check'));
});
test('expected corrected source with rollback exception has no normal return-after-insert',()=>{
 const fixed=src.replace(/(if not found then )return jsonb_build_object\('ok',false,'reason','tx_not_pending','txid',v_txid\);/i,
 "$1raise exception using message = 'tx_not_pending';");
 const original=findPostInsertRejections(src),modified=findPostInsertRejections(fixed);
 assert.equal(original.includes('tx_not_pending'),true);
 assert.equal(modified.includes('tx_not_pending'),false);
});

const txBody=(()=>{
 const m=/create\s+or\s+replace\s+function\s+public\.fae_v4_accept_tx\s*\([\s\S]*?\)\s*returns\s+jsonb\s+language\s+plpgsql\s+security\s+definer\s+set\s+search_path\s+to\s+'public'\s+as\s+\$\$([\s\S]*?)\$\$;/i.exec(src);
 assert.ok(m,'canonical transaction RPC source unavailable');return m[1];
})();
test('SQL direct RPC persists caller-supplied signature without verifying it',()=>{
 assert.match(txBody,/v_address\s*<>\s*p_from_address/i);
 assert.match(txBody,/insert\s+into\s+public\.fae_v4_transactions/i);
 assert.equal((txBody.match(/\bp_signature\b/g)||[]).length,1,
   'expected signature to appear only as unverified stored input inside function body');
});
test('real pinned Edge gateway verifies signature before its privileged transaction RPC',()=>{
 const edge=execFileSync('git',['show',BASE+':supabase/functions/fae-public-testnet-v4/index.ts'],
  {encoding:'utf8',timeout:15000});
 assert.match(edge,/crypto\.subtle\.verify\s*\(/);
 assert.match(edge,/async function submitTx\(body\)\{const t=body\?\.tx\|\|body,v=await verifyTx\(t\)/);
 assert.match(edge,/rpc\/fae_v4_accept_tx/);
});
test('SQL migration explicitly revokes PUBLIC RPC execution and grants service_role',()=>{
 assert.match(src,/revoke all on function public\.fae_v4_accept_tx\([^;]+from public;/i);
 assert.match(src,/grant execute on function public\.fae_v4_accept_tx\([^;]+to service_role;/i);
});
console.log(tests+'/'+tests+' canonical SQL boundary and atomicity witnesses passed; findings remain with node/consensus owner');
