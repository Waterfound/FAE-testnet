/**
 * PCC-001 main versus candidate SOURCE-RUNTIME differential.
 * GitHub Actions provides a detached main worktree via PCC_CANONICAL_MAIN_WORKTREE.
 * Both modules load from their own real import graphs. No live runtime writes.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {generateKeyPairSync,sign as edSign} from 'node:crypto';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';

const mainRoot=process.env.PCC_CANONICAL_MAIN_WORKTREE;
if(!mainRoot)throw new Error('PCC_CANONICAL_MAIN_WORKTREE missing: run only in the canonical-admission isolated job');
const source='sovereign-forge/node/authoritative/';
async function modules(root){
  const base=resolve(root);
  const file=name=>pathToFileURL(join(base,source,name)).href;
  const [core,canonical,address,activation,peer]=await Promise.all([
    import(file('fae-v4-core.mjs')),
    import(file('canonical.mjs')),
    import(file('address.mjs')),
    import(file('pplns-activation.mjs')),
    import(file('fae-v4-peer-node.mjs'))
  ]);
  return {core,canonical,address,activation,peer};
}
const [main,candidate]=await Promise.all([modules(mainRoot),modules(process.cwd())]);
const {privateKey,publicKey}=generateKeyPairSync('ed25519');
const spki=publicKey.export({format:'der',type:'spki'});
const pub=spki.toString('base64');
const owner=candidate.core.deriveFromAddress(spki);
const createdAt='2026-10-13T00:00:00.000Z';
function initial(mod){
  const state=mod.core.emptyState();
  state.utxos['pcc-diff:0']={
    outpoint:'pcc-diff:0',address:owner,amount_atoms:'1000000',
    created_height:0,spent:false,spent_by:null
  };
  return state;
}
function signed(mod,input,amount){
  const unsigned={version:2,network:mod.core.NETWORK,inputs:[input],
    outputs:[{address:owner,amount_atoms:String(amount)}],
    public_key_spki:pub};
  const msg=mod.canonical.stableStringify(mod.core.txPayload({...unsigned,signature:''}));
  return {...unsigned,signature:edSign(null,Buffer.from(msg),privateKey).toString('base64'),created_at:createdAt};
}
function snapshot(mod,s){
  return mod.canonical.stableStringify(s);
}
function semTemplate(template){
  const h=template.header;
  return {txids:template.txids,mode:template.template_policy,header:{
    network:h.network,height:h.height,previous_hash:h.previous_hash,
    difficulty_bits:h.difficulty_bits,reward_atoms:h.reward_atoms,
    fee_atoms:h.fee_atoms??null,miner_address:h.miner_address,
    tx_root:h.tx_root,tx_count:h.tx_count,
    coinbase_mode:h.coinbase_mode??null
  }};
}
test('PCC-DIFF-01: exact valid Ed25519 signatures, UTXO fee chain and inactive canonical mining template agree across main and candidate',()=>{
  assert.equal(owner,main.core.deriveFromAddress(spki));
  const states={main:initial(main),candidate:initial(candidate)};
  const first=signed(main,'pcc-diff:0','750000');
  assert.deepEqual(main.core.txPayload(first),candidate.core.txPayload(first));
  for(const m of [main,candidate]){
    const verified=m.core.verifyTxCrypto(first);
    assert.equal(verified.ok,true);
    assert.equal(verified.from,owner);
  }
  const firstMain=main.core.acceptTxInto(states.main,first);
  const firstCandidate=candidate.core.acceptTxInto(states.candidate,first);
  assert.equal(firstMain.txid,firstCandidate.txid);
  const second=signed(main,firstMain.txid+':0','600000');
  const secondMain=main.core.acceptTxInto(states.main,second);
  const secondCandidate=candidate.core.acceptTxInto(states.candidate,second);
  assert.equal(secondMain.txid,secondCandidate.txid);
  assert.equal(main.core.transactionFees(states.main,[firstMain.txid,secondMain.txid]),400000n);
  assert.equal(candidate.core.transactionFees(states.candidate,[firstMain.txid,secondMain.txid]),400000n);
  assert.equal(snapshot(main,states.main),snapshot(candidate,states.candidate),
    'signed accepted transaction state must match canonical main exactly');
  assert.deepEqual(semTemplate(main.core.createMiningTemplate(states.main,owner)),
    semTemplate(candidate.core.createMiningTemplate(states.candidate,owner)));
  assert.deepEqual(main.core.spendableOutputs(states.main,owner),
    candidate.core.spendableOutputs(states.candidate,owner));
});
test('PCC-DIFF-02: invalid Ed25519 signature preserves state and fails equivalently',()=>{
  const valid=signed(main,'pcc-diff:0','750000');
  const tampered={...valid,outputs:[{address:owner,amount_atoms:'749999'}]};
  let errorCodes=[];
  for(const m of [main,candidate]){
    const state=initial(m),before=snapshot(m,state);
    const verified=m.core.verifyTxCrypto(tampered);
    assert.equal(verified.ok,false);
    let code=null;
    assert.throws(()=>m.core.acceptTxInto(state,tampered),e=>{code=e.code??e.message;return true});
    errorCodes.push(code);
    assert.equal(snapshot(m,state),before);
  }
  assert.deepEqual(errorCodes,['invalid_signature','invalid_signature']);
});
test('PCC-DIFF-03: PPLNS remains frozen by default; no spontaneous fee or payout policy activation',()=>{
  assert.equal(main.activation.PPLNS_COINBASE_ACTIVATION_HEIGHT,null);
  assert.equal(candidate.activation.PPLNS_COINBASE_ACTIVATION_HEIGHT,null);
  for(const m of [main,candidate]){
    assert.equal(m.activation.isPplnsCoinbaseActive(1000000),false);
    assert.throws(()=>m.core.createDistributedTemplate(m.core.emptyState(),
      [{address:owner,weight:'1'}]),/pplns_coinbase_activation_required/);
    const template=m.core.createMiningTemplate(m.core.emptyState(),owner);
    assert.equal(template.header.coinbase_mode,undefined);
    assert.equal(template.coinbase_outputs,undefined);
  }
});
test('PCC-DIFF-04: candidate source-only bounded admission changes are explicit and main remains the frozen control',()=>{
  assert.equal(main.core.MAX_MEMPOOL_TXS,undefined);
  assert.equal(main.core.MAX_TRANSACTION_BYTES,undefined);
  assert.equal(candidate.core.MAX_MEMPOOL_TXS,4096);
  assert.equal(candidate.core.MAX_TRANSACTION_BYTES,16*1024);
  assert.equal(typeof main.peer.createAuthoritativeV4PeerNode,'function');
  assert.equal(typeof candidate.peer.createAuthoritativeV4PeerNode,'function');
  // Real 4096-transaction signed-saturation and authenticated hooks were already
  // exercised by source-owned W2 tests; do not substitute synthetic invalid state.
});

test('PCC-DIFF-05: genuine loopback FAE peer default status/template and invalid remote transaction agree across canonical main and candidate',async()=>{
  const seen=[];
  for(const m of [main,candidate]){
    const node=m.peer.createAuthoritativeV4PeerNode({
      host:'127.0.0.1',port:0,syncIntervalMs:0
    });
    try{
      await node.start();
      const base=node.baseUrl();
      const statusResp=await fetch(base+'/status');
      assert.equal(statusResp.status,200);
      const status=await statusResp.json();
      const templateResp=await fetch(base+'/template?address='+encodeURIComponent(owner));
      assert.equal(templateResp.status,200);
      const template=await templateResp.json();
      const badResp=await fetch(base+'/submit-tx',{
        method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({network:m.core.NETWORK,inputs:[],outputs:[],signature:'AA=='})
      });
      const bad=await badResp.json();
      assert.equal(badResp.status,400);
      seen.push({
        network:status.network,height:status.height,tip_hash:status.tip_hash,
        pplns_coinbase_activation_height:status.pplns_coinbase_activation_height,
        template:semTemplate(template),denied:{status:badResp.status,error:bad.error}
      });
    }finally{
      await node.close();
    }
  }
  assert.deepEqual(seen[0],seen[1]);
  assert.equal(seen[1].pplns_coinbase_activation_height,null);
});
