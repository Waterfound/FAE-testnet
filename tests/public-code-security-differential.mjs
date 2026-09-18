import assert from 'node:assert/strict';
import test from 'node:test';
import {spawn} from 'node:child_process';
import {generateKeyPairSync,sign as nodeSign} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

import {
  NETWORK,emptyState,createMiningTemplate,appendBlockFromSubmission,
  acceptTxInto,verifyTxCrypto,txPayload,balanceAtoms,spendableOutputs,
  chainWork,nextDifficulty
} from '../sovereign-forge/node/authoritative/fae-v4-core.mjs';
import {stableStringify} from '../sovereign-forge/node/authoritative/canonical.mjs';
import {hashHex,leadingZeroBits,sha256} from '../sovereign-forge/node/authoritative/crypto.mjs';
import {encodeAddress} from '../sovereign-forge/node/authoritative/address.mjs';

const root=resolve(new URL('../sovereign-forge',import.meta.url).pathname);
const independentNodeFile=join(root,'node','fae-node.mjs');
const NO_PPLNS_ACTIVATION=Number.MAX_SAFE_INTEGER;

function wallet(){
  const {privateKey,publicKey}=generateKeyPairSync('ed25519');
  const spki=publicKey.export({type:'spki',format:'der'});
  return{
    privateKey,
    pub:spki.toString('base64'),
    address:encodeAddress(sha256(spki).subarray(0,20),'faet')
  };
}

function signedTx(owner,inputs,outputs,{network=NETWORK,version=2}={}){
  const unsigned={version,network,inputs:[...inputs],outputs:outputs.map(row=>({...row})),public_key_spki:owner.pub};
  const signature=nodeSign(
    null,
    Buffer.from(stableStringify(txPayload({...unsigned,signature:''}))),
    owner.privateKey
  ).toString('base64');
  return{...unsigned,signature};
}

function mine(template,{maxNonce=8_000_000}={}){
  for(let nonce=0;nonce<=maxNonce;nonce++){
    const hash=hashHex({...template.header,nonce});
    if(leadingZeroBits(hash)>=Number(template.header.difficulty_bits)){
      return{
        header:structuredClone(template.header),
        nonce,
        hash,
        txids:[...(template.txids||[])],
        ...(template.coinbase_outputs?{coinbase_outputs:structuredClone(template.coinbase_outputs)}:{})
      };
    }
  }
  throw new Error('PSR-11 PoW search exhausted');
}

async function json(url,options={}){
  const response=await fetch(url,options);
  const payload=await response.json().catch(()=>({}));
  return{response,payload};
}

async function waitForNode(base){
  for(let i=0;i<120;i++){
    try{
      const {response,payload}=await json(base+'/status');
      if(response.ok)return payload;
    }catch{}
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  throw new Error('independent node did not start');
}

function coreBlockError(state,candidate){
  try{
    appendBlockFromSubmission(state,candidate,{activationHeight:NO_PPLNS_ACTIVATION});
    return null;
  }catch(error){
    return String(error.message||error).split(':')[0];
  }
}

function coreTxError(state,tx){
  try{
    acceptTxInto(structuredClone(state),tx);
    return null;
  }catch(error){
    return String(error.code||error.message||error).split(':')[0];
  }
}

test('PSR-11 independent node remains implementation-independent from authoritative core',async()=>{
  const source=await readFile(independentNodeFile,'utf8');
  const forbidden=[
    "fae-v4-core.mjs",
    "consensus-v3-shadow",
    "activation-reorg-candidate",
    "activation-state-transition-candidate"
  ];
  for(const token of forbidden){
    assert.equal(source.includes(token),false,'independent node must not import/reference '+token);
  }
  for(const required of[
    "function verifyTxCrypto",
    "function validateBlockEnvelope",
    "function appendBlockFromSubmission",
    "function preferred",
    "function reconcileDetachedTransactions"
  ]) assert.ok(source.includes(required),'independent node lost standalone implementation: '+required);
});

test('PSR-11 authoritative core and standalone node agree on active-v4 acceptance, state and rejection classes',async()=>{
  const temp=await mkdtemp(join(tmpdir(),'fae-psr11-diff-'));
  const dataFile=join(temp,'state.json');
  const port=19000+(process.pid%1000);
  const base='http://127.0.0.1:'+port;
  const child=spawn(process.execPath,[independentNodeFile],{
    env:{
      ...process.env,
      FAE_PORT:String(port),
      FAE_HOST:'127.0.0.1',
      FAE_DATA_FILE:dataFile,
      FAE_SYNC:'0',
      FAE_UPSTREAM_API:'',
      FAE_PEERS:'',
      FAE_BOOTSTRAP_FEEDS:''
    },
    stdio:['ignore','pipe','pipe']
  });
  let stderr='';
  child.stderr.on('data',chunk=>stderr+=chunk);

  let core=emptyState();
  const miner=wallet();
  const recipient=wallet();

  try{
    const initial=await waitForNode(base);
    assert.equal(initial.network,NETWORK);
    assert.equal(initial.height,0);
    assert.equal(initial.difficulty_bits,nextDifficulty(core.chain));
    assert.equal(initial.chain_work,chainWork(core.chain).toString());

    const independentTemplate=(await json(base+'/template?address='+encodeURIComponent(miner.address))).payload;
    const authoritativeTemplate=createMiningTemplate(core,miner.address,{activationHeight:NO_PPLNS_ACTIVATION});
    for(const field of['network','height','previous_hash','difficulty_bits','miner_address','reward_atoms','tx_root','tx_count']){
      assert.equal(independentTemplate.header[field],authoritativeTemplate.header[field],'genesis template parity: '+field);
    }
    assert.deepEqual(independentTemplate.txids,authoritativeTemplate.txids);

    const block1=mine(independentTemplate);
    core=appendBlockFromSubmission(core,block1,{activationHeight:NO_PPLNS_ACTIVATION});
    const accepted1=await json(base+'/submit-block',{
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(block1)
    });
    assert.equal(accepted1.response.ok,true,JSON.stringify(accepted1.payload));

    let remoteStatus=(await json(base+'/status')).payload;
    assert.equal(remoteStatus.height,core.chain.length);
    assert.equal(remoteStatus.tip_hash,core.chain.at(-1).hash);
    assert.equal(remoteStatus.issued_atoms,core.chain.reduce((sum,b)=>sum+BigInt(b.reward_atoms),0n).toString());
    assert.equal(remoteStatus.chain_work,chainWork(core.chain).toString());

    let remoteBalance=(await json(base+'/balance?address='+encodeURIComponent(miner.address))).payload;
    assert.equal(remoteBalance.balance_atoms,balanceAtoms(core,miner.address).toString());
    assert.equal(
      (await json(base+'/spendable?address='+encodeURIComponent(miner.address))).payload.spendable_atoms,
      spendableOutputs(core,miner.address).reduce((sum,row)=>sum+BigInt(row.amount_atoms),0n).toString()
    );

    const input=core.chain.at(-1).hash+':0';
    const tx=signedTx(miner,[input],[
      {address:recipient.address,amount_atoms:'100000000'},
      {address:miner.address,amount_atoms:'899999000'}
    ]);
    const localAccepted=acceptTxInto(core,tx);
    const remoteTx=await json(base+'/submit-tx',{
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({tx})
    });
    assert.equal(remoteTx.response.ok,true,JSON.stringify(remoteTx.payload));
    assert.equal(remoteTx.payload.txid,localAccepted.txid);
    assert.equal(remoteTx.payload.fee_atoms,localAccepted.fee_atoms);

    const independentTemplate2=(await json(base+'/template?address='+encodeURIComponent(miner.address))).payload;
    const authoritativeTemplate2=createMiningTemplate(core,miner.address,{activationHeight:NO_PPLNS_ACTIVATION});
    for(const field of['network','height','previous_hash','difficulty_bits','miner_address','reward_atoms','tx_root','tx_count']){
      assert.equal(independentTemplate2.header[field],authoritativeTemplate2.header[field],'post-tx template parity: '+field);
    }
    assert.deepEqual(independentTemplate2.txids,authoritativeTemplate2.txids);

    const block2=mine(independentTemplate2);
    core=appendBlockFromSubmission(core,block2,{activationHeight:NO_PPLNS_ACTIVATION});
    const accepted2=await json(base+'/submit-block',{
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(block2)
    });
    assert.equal(accepted2.response.ok,true,JSON.stringify(accepted2.payload));

    remoteStatus=(await json(base+'/status')).payload;
    assert.equal(remoteStatus.height,core.chain.length);
    assert.equal(remoteStatus.tip_hash,core.chain.at(-1).hash);
    assert.equal(remoteStatus.chain_work,chainWork(core.chain).toString());

    for(const account of[miner,recipient]){
      remoteBalance=(await json(base+'/balance?address='+encodeURIComponent(account.address))).payload;
      assert.equal(remoteBalance.balance_atoms,balanceAtoms(core,account.address).toString(),'balance parity '+account.address);
    }

    const txRows=(await json(base+'/transactions?address='+encodeURIComponent(miner.address))).payload.transactions;
    assert.equal(txRows.length,1);
    assert.equal(txRows[0].txid,localAccepted.txid);
    assert.equal(txRows[0].status,core.transactions[localAccepted.txid].status);
    assert.equal(Number(txRows[0].confirmed_height),Number(core.transactions[localAccepted.txid].confirmed_height));

    const rejectionTxCases=[];
    const tampered=structuredClone(tx);
    const sig=Buffer.from(tampered.signature,'base64');sig[0]^=1;tampered.signature=sig.toString('base64');
    rejectionTxCases.push(['invalid_signature',tampered]);

    const wrongNetwork=signedTx(miner,[core.chain.at(-1).hash+':0'],[
      {address:recipient.address,amount_atoms:'1'}
    ],{network:'attacker-network'});
    rejectionTxCases.push(['malformed_transaction',wrongNetwork]);

    for(const [expected,attack] of rejectionTxCases){
      const local=verifyTxCrypto(attack);
      assert.equal(local.ok,false);
      assert.equal(local.error,expected);
      const remote=await json(base+'/submit-tx',{
        method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({tx:attack})
      });
      assert.equal(remote.response.ok,false);
      assert.equal(remote.payload.error,expected);
    }

    const staleLocal=coreBlockError(core,block1);
    const staleRemote=await json(base+'/submit-block',{
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(block1)
    });
    assert.equal(staleLocal,'stale_tip');
    assert.equal(staleRemote.response.ok,false);
    assert.equal(staleRemote.payload.error,'stale_tip');

    const fresh=(await json(base+'/template?address='+encodeURIComponent(miner.address))).payload;
    const wrongReward={
      header:{...fresh.header,reward_atoms:(BigInt(fresh.header.reward_atoms)+1n).toString()},
      nonce:0,hash:'0'.repeat(64),txids:[...fresh.txids]
    };
    assert.equal(coreBlockError(core,wrongReward),'invalid_consensus_fields');
    const wrongRewardRemote=await json(base+'/submit-block',{
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(wrongReward)
    });
    assert.equal(wrongRewardRemote.response.ok,false);
    assert.equal(wrongRewardRemote.payload.error,'invalid_consensus_fields');

    const replayTxError=coreTxError(core,tx);
    const replayRemote=await json(base+'/submit-tx',{
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({tx})
    });
    assert.equal(replayTxError,'duplicate_txid');
    assert.equal(replayRemote.response.ok,false);
    assert.equal(replayRemote.payload.error,'duplicate_txid');

    const finalStatus=(await json(base+'/status')).payload;
    assert.equal(finalStatus.height,core.chain.length,'rejected differential cases must not mutate remote chain');
    assert.equal(finalStatus.tip_hash,core.chain.at(-1).hash);
  } finally {
    child.kill('SIGTERM');
    await new Promise(resolve=>{
      let settled=false;
      const done=()=>{if(!settled){settled=true;resolve();}};
      child.once('exit',done);
      setTimeout(done,700);
    });
    await rm(temp,{recursive:true,force:true});
    if(stderr)process.stderr.write(stderr);
  }
});

console.log(JSON.stringify({
  status:'PASS',
  psr:'PSR-11',
  active_v4_independent_process:true,
  independence_fence:true,
  divergence_policy:'FAIL_CLOSED',
  runtime_or_consensus_change:false
}));
