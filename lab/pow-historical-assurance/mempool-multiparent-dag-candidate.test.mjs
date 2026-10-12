/** HPA W2: signed multi-parent dependency negative regressions, candidate only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {NETWORK,emptyState,acceptTxInto,txPayload} from '../../sovereign-forge/node/authoritative/fae-v4-core.mjs';
import {stableStringify} from '../../sovereign-forge/node/authoritative/canonical.mjs';
import {sha256} from '../../sovereign-forge/node/authoritative/crypto.mjs';
import {encodeAddress} from '../../sovereign-forge/node/authoritative/address.mjs';
import {assertPendingIndexes,removeDescendantPackageOnClone,selectFeeSensitiveTemplateCandidate} from './mempool-fee-aware-shadow-candidate.mjs';
function wallet(){
 const {privateKey,publicKey}=generateKeyPairSync('ed25519');
 const spki=publicKey.export({format:'der',type:'spki'});
 return {privateKey,pub:spki.toString('base64'),address:encodeAddress(sha256(spki).subarray(0,20),'faet')};
}
function signed(w,inputs,total,fee=0n){
 const u={version:2,network:NETWORK,inputs,outputs:[{address:w.address,amount_atoms:(BigInt(total)-fee).toString()}],public_key_spki:w.pub};
 return {...u,signature:sign(null,Buffer.from(stableStringify(txPayload({...u,signature:''}))),w.privateKey).toString('base64')};
}
function dag(){
 const a=wallet(),b=wallet(),s=emptyState(),amount='1000000000';
 for(const id of ['left:0','right:0'])s.utxos[id]={outpoint:id,address:a.address,amount_atoms:amount,created_height:0,spent:false,spent_by:null};
 s.utxos['other:0']={outpoint:'other:0',address:b.address,amount_atoms:amount,created_height:0,spent:false,spent_by:null};
 const left=acceptTxInto(s,signed(a,['left:0'],amount));
 const right=acceptTxInto(s,signed(a,['right:0'],amount));
 const child=acceptTxInto(s,signed(a,[left.txid+':0',right.txid+':0'],2000000000n,500000n));
 const other=acceptTxInto(s,signed(b,['other:0'],amount,10000n));
 assertPendingIndexes(s,{cap:4});
 return {s,left,right,child,other};
}
test('PF-12U signed multi-parent fee package preserves both ancestors and deterministic order',()=>{
 const {s,left,right,child,other}=dag(),before=stableStringify(s);
 const selected=selectFeeSensitiveTemplateCandidate(s,{limit:3});
 assert.deepEqual(selected.txids,[left.txid,right.txid,child.txid]);
 assert.equal(selected.fee_atoms,'500000');
 assert.ok(!selected.txids.includes(other.txid));
 assert.deepEqual(selectFeeSensitiveTemplateCandidate(s,{limit:3}),selected);
 assert.equal(stableStringify(s),before);
});
test('PF-12V signed multi-parent descendant closure retains unspent sibling parent',()=>{
 const {s,left,right,child,other}=dag(),before=stableStringify(s);
 const removed=removeDescendantPackageOnClone(s,[left.txid],{cap:4});
 assert.deepEqual(removed.evicted,[left.txid,child.txid]);
 assert.deepEqual(removed.state.mempoolOrder,[right.txid,other.txid]);
 assert.equal(removed.state.mempoolSpends[right.txid+':0'],undefined);
 assert.equal(removed.state.mempoolOutputs[right.txid+':0'].txid,right.txid);
 assertPendingIndexes(removed.state,{cap:4});
 assert.equal(stableStringify(s),before);
 const invalid=structuredClone(removed.state);
 invalid.mempoolSpends[right.txid+':0']='invalid-id';
 assert.throws(()=>assertPendingIndexes(invalid,{cap:4}),e=>e.code==='orphan_reserved_input');
});
