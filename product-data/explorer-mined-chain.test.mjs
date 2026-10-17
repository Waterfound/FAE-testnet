/**
 * Candidate-only integration: REAL locally mined v4 blocks + Ed25519 transfer,
 * consumed exclusively through the read-only Explorer adapter.
 * Does not use synthetic state injection, external providers, real FAE funds
 * or persistent runtime. No consensus, wallet or mining code is modified.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {createServer} from 'node:net';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {createExplorerReadAdapter,ExplorerDataError} from './explorer-read-adapter.mjs';
import {loadExplorerOverview,loadExplorerTransaction} from './explorer-view-model.mjs';
import {createWalletPublicLedgerObserver} from './wallet-public-ledger-observer.mjs';
import {createVaultBoundPublicObserver} from './wallet-vault-public-bridge.mjs';

const NETWORK='fairyelf-public-testnet-v4';
const CHARSET='qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const HRP='faet';
function canonical(x){
  if(Array.isArray(x))return x.map(canonical);
  if(x&&typeof x==='object')return Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])]));
  return x;
}
function stable(x){return JSON.stringify(canonical(x))}
function doubleHash(x){
  const h=createHash('sha256').update(Buffer.from(stable(x))).digest();
  return createHash('sha256').update(h).digest('hex');
}
function zeros(hash){
  let n=0;
  for(const c of hash){
    const v=parseInt(c,16);
    if(v===0){n+=4;continue;}
    if(v<2)n+=3;else if(v<4)n+=2;else if(v<8)n++;break;
  }
  return n;
}
function polymod(values){
  const g=[0x3b6a57b2,0x26508e6d,0x1ea119fa,0x3d4233dd,0x2a1462b3];
  let c=1;
  for(const value of values){
    const top=c>>>25;
    c=((c&0x1ffffff)<<5)^value;
    for(let i=0;i<5;i++)if((top>>>i)&1)c^=g[i];
  }
  return c>>>0;
}
function convertBits(data,from,to){
  let accum=0,bits=0;const out=[],mask=(1<<to)-1;
  const max=(1<<(from+to-1))-1;
  for(const v of data){
    accum=((accum<<from)|v)&max;bits+=from;
    while(bits>=to){bits-=to;out.push((accum>>>bits)&mask);}
  }
  if(bits)out.push((accum<<(to-bits))&mask);
  return out;
}
function addressFor(spki){
  const data=convertBits(createHash('sha256').update(spki).digest().subarray(0,20),8,5);
  const expand=[...[...HRP].map(c=>c.charCodeAt(0)>>>5),0,...[...HRP].map(c=>c.charCodeAt(0)&31)];
  const mod=polymod([...expand,...data,0,0,0,0,0,0])^0x2bc830a3;
  const check=Array.from({length:6},(_,i)=>(mod>>>(5*(5-i)))&31);
  return HRP+'1'+[...data,...check].map(v=>CHARSET[v]).join('');
}
function key(){
  const {publicKey,privateKey}=generateKeyPairSync('ed25519');
  const spki=publicKey.export({format:'der',type:'spki'});
  return {address:addressFor(spki),spki:spki.toString('base64'),privateKey};
}
async function freePort(){
  const s=createServer();
  await new Promise((ok,fail)=>{s.once('error',fail);s.listen(0,'127.0.0.1',ok);});
  const p=s.address().port;
  await new Promise(ok=>s.close(ok));
  return p;
}
async function delay(ms){return new Promise(ok=>setTimeout(ok,ms))}
async function json(base,path,init){
  const response=await fetch(base+path,init);
  return {status:response.status,data:await response.json()};
}
async function mine(base,address){
  const {status,data}=await json(base,'template?address='+encodeURIComponent(address));
  assert.equal(status,200);
  assert.equal(data.ok,true);
  const {header,txids}=data;
  let nonce=0,hash='';
  for(;nonce<6_000_000;nonce++){
    hash=doubleHash({...header,nonce});
    if(zeros(hash)>=header.difficulty_bits)break;
  }
  assert.ok(nonce<6_000_000,'PoW must be actually solved under bounded test effort');
  const submit=await json(base,'submit-block',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({header,nonce,hash,txids})
  });
  assert.equal(submit.status,200,JSON.stringify(submit.data));
  assert.equal(submit.data.hash,hash);
  return {...submit.data,txids};
}
test('isolated real-work v4 chain: six Explorer GET routes, pending-to-confirmed, tip cursor fencing', {timeout:100000},async t=>{
  const dir=await mkdtemp(join(tmpdir(),'fae-explorer-mined-chain-'));
  const port=await freePort();
  const base='http://127.0.0.1:'+port+'/';
  let stderr='';
  const child=spawn(process.execPath,[resolve('sovereign-forge/node/fae-node.mjs')],{
    cwd:dir,stdio:['ignore','ignore','pipe'],
    env:{...process.env,FAE_PORT:String(port),FAE_HOST:'127.0.0.1',
      FAE_DATA_FILE:join(dir,'node-state.json'),FAE_SYNC:'0',
      FAE_UPSTREAM_API:'',FAE_BOOTSTRAP_FEEDS:'',FAE_PEERS:''}
  });
  child.stderr.on('data',d=>{stderr+=String(d);});
  t.after(async()=>{
    if(child.exitCode===null&&child.signalCode===null){
      child.kill('SIGTERM');
      await Promise.race([new Promise(ok=>child.once('exit',ok)),delay(2000)]);
    }
    await rm(dir,{recursive:true,force:true});
  });
  let ready=false;
  for(let i=0;i<100;i++){
    if(child.exitCode!==null)throw Error('Independent node terminated: '+stderr);
    try{const r=await fetch(base+'explorer/status');if(r.ok){ready=true;break;}}catch{}
    await delay(75);
  }
  assert.ok(ready,'Isolated validating node did not start: '+stderr);
  const adapter=createExplorerReadAdapter({baseUrl:base,timeoutMs:6000});
  const sender=key(),recipient=key();
  const initial=await adapter.status();
  assert.equal(initial.tip.height,0);
  assert.equal((await loadExplorerOverview(adapter)).miningProgressPercent,null);
  const walletView=createWalletPublicLedgerObserver({adapter});
  assert.equal(walletView.getSnapshot().state,'no_wallet');

  const first=await mine(base,sender.address);
  assert.equal(first.height,1);
  const tip1=(await adapter.status()).tip;
  assert.equal(tip1.hash,first.hash);
  assert.equal((await adapter.block({height:1,expectedTip:tip1})).block.confirmations,1);
  const reward=await adapter.address({address:sender.address,expectedTip:tip1});
  assert.equal(reward.balanceAtoms,'1000000000');
  assert.equal(reward.events[0].type,'reward');
  walletView.selectWallet({walletId:'sender-public-context',address:sender.address});
  const senderObserved=await walletView.refresh();
  assert.equal(senderObserved.state,'observed');
  assert.equal(senderObserved.balanceAtoms,'1000000000');
  assert.equal(senderObserved.tip.hash,tip1.hash);
  walletView.selectWallet({walletId:'recipient-public-context',address:recipient.address});
  const recipientBefore=await walletView.refresh();
  assert.equal(recipientBefore.balanceAtoms,'0');
  assert.equal(recipientBefore.tip.hash,tip1.hash);
  assert.equal(recipientBefore.walletId,'recipient-public-context');
  assert.equal(walletView.getSnapshot().address,recipient.address);
  assert.equal((await adapter.search({query:first.hash,expectedTip:tip1})).matches[0].type,'block');
  assert.equal((await adapter.search({query:'1',expectedTip:tip1})).matches[0].height,1);

  const unsigned={
    version:2,network:NETWORK,inputs:[first.hash+':0'],
    outputs:[{address:recipient.address,amount_atoms:'999999900'}],
    public_key_spki:sender.spki
  };
  const payload={domain:'FAIRYELF_TX_V2',network:unsigned.network,inputs:unsigned.inputs,
    outputs:unsigned.outputs,public_key_spki:unsigned.public_key_spki};
  const signed={...unsigned,signature:sign(null,Buffer.from(stable(payload)),sender.privateKey).toString('base64')};
  const accepted=await json(base,'submit-tx',{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({tx:signed})
  });
  assert.equal(accepted.status,200,JSON.stringify(accepted.data));
  const txid=accepted.data.txid;
  assert.match(txid,/^[0-9a-f]{64}$/);
  const pending=await loadExplorerTransaction(adapter,{txid,expectedTip:tip1});
  assert.equal(pending.status,'pending');
  assert.equal(pending.confirmations,null);
  const sending=await adapter.address({address:sender.address,limit:1,expectedTip:tip1});
  assert.match(sending.nextCursor,new RegExp('^'+tip1.hash+':1$'));
  const receivedPending=await adapter.address({address:recipient.address,expectedTip:tip1});
  assert.equal(receivedPending.balanceAtoms,'0');
  assert.equal(receivedPending.events[0].status,'pending');
  assert.equal((await adapter.status()).data.mempool_size,1);
  assert.equal((await adapter.search({query:txid,expectedTip:tip1})).matches[0].type,'transaction');

  let second;
  try{second=await mine(base,sender.address);}
  catch(error){
    throw new Error('second-block phase failed: child exit='+child.exitCode+
      ' signal='+child.signalCode+' stderr_tail='+stderr.slice(-1500)+
      ' original='+String(error?.stack||error),{cause:error});
  }
  assert.equal(second.height,2);
  assert.deepEqual(second.txids,[txid]);
  const tip2=(await adapter.status()).tip;
  assert.notEqual(tip2.hash,tip1.hash);
  const overview=await loadExplorerOverview(adapter);
  assert.equal(overview.latestAcceptedHeight,2);
  assert.equal(overview.nextPossibleHeight,3);
  assert.equal(overview.miningProgressPercent,null);
  assert.equal(overview.hasGlobalTransactionLedger,false);
  assert.deepEqual(overview.indexedBlocks.map(b=>b.height),[2,1]);
  const byHash=await adapter.block({hash:second.hash,expectedTip:tip2});
  assert.equal(byHash.block.confirmations,1);
  assert.equal((await adapter.block({height:1,expectedTip:tip2})).block.confirmations,2);
  const single=await adapter.blocks({limit:1,expectedTip:tip2});
  assert.deepEqual(single.blocks.map(b=>b.height),[2]);
  assert.equal(single.nextBeforeHeight,2);
  assert.equal((await adapter.blocks({limit:1,beforeHeight:2,expectedTip:tip2})).blocks[0].height,1);
  const confirmed=await loadExplorerTransaction(adapter,{txid,expectedTip:tip2});
  assert.equal(confirmed.status,'confirmed');
  assert.equal(confirmed.confirmedHeight,2);
  assert.equal(confirmed.confirmations,1);
  assert.equal(confirmed.blockHash,second.hash);
  assert.equal(confirmed.feeAtoms,'100');
  const received=await adapter.address({address:recipient.address,expectedTip:tip2});
  assert.equal(received.balanceAtoms,'999999900');
  assert.equal(received.events[0].status,'confirmed');
  // In the candidate, the real encrypted vault (PR #266) exposes exactly
  // readState + listWallets public metadata. Exercise this contract-shaped
  // port against actual node-validated chain records, not invented balances.
  const thirdReal=key();
  const record=(walletId,address)=>({
    walletId,network:NETWORK,activeIndex:0,
    addresses:[{index:0,address,pub:'ephemeral-public-test'}]
  });
  const persistent=[
    record('wallet-'+'a'.repeat(64),sender.address),
    record('wallet-'+'b'.repeat(64),recipient.address),
    record('wallet-'+'c'.repeat(64),thirdReal.address)
  ];
  const persisted={activeWalletId:persistent[0].walletId};
  const vaultPublic={
    readState:async()=>({...persisted}),
    listWallets:async()=>persistent.map(item=>({...item})),
    loadAccount:async()=>{throw Error('Public bridge must not decrypt private vault')}
  };
  const realVaultBridge=createVaultBoundPublicObserver({vault:vaultPublic,adapter});
  const seenFromSender=await realVaultBridge.refresh();
  assert.equal(seenFromSender.balanceAtoms,'1000000000');
  assert.equal(seenFromSender.tip.hash,tip2.hash);
  persisted.activeWalletId=persistent[1].walletId;
  const seenFromRecipient=await realVaultBridge.refresh();
  assert.equal(seenFromRecipient.balanceAtoms,'999999900');
  assert.equal(seenFromRecipient.tip.hash,tip2.hash);
  persisted.activeWalletId=persistent[2].walletId;
  const emptyThird=await realVaultBridge.refresh();
  assert.equal(emptyThird.state,'observed');
  assert.equal(emptyThird.balanceAtoms,'0');
  persisted.activeWalletId=null;
  const invalidActive=await realVaultBridge.refresh();
  assert.equal(invalidActive.state,'vault_unavailable');
  assert.equal(invalidActive.balanceAtoms,null);

  const recipientAfter=await walletView.refresh();
  assert.equal(recipientAfter.state,'observed');
  assert.equal(recipientAfter.balanceAtoms,'999999900');
  assert.equal(recipientAfter.walletId,'recipient-public-context');
  assert.equal(recipientAfter.tip.hash,tip2.hash);
  walletView.selectWallet({walletId:'sender-public-context',address:sender.address});
  const newSender=await walletView.refresh();
  assert.equal(newSender.balanceAtoms,'1000000000');
  assert.equal(newSender.tip.hash,tip2.hash);
  const third=key();
  walletView.selectWallet({walletId:'unfunded-third-context',address:third.address});
  const thirdResult=await walletView.refresh();
  assert.equal(thirdResult.balanceAtoms,'0');
  assert.equal(thirdResult.walletId,'unfunded-third-context');
  walletView.setVaultLocked(true);
  assert.equal(walletView.getSnapshot().state,'locked');
  assert.equal(walletView.getSnapshot().address,null);
  assert.equal(walletView.getSnapshot().balanceAtoms,null);
  walletView.setVaultLocked(false);
  assert.equal(walletView.getSnapshot().state,'unknown');
  assert.equal(walletView.getSnapshot().balanceAtoms,null);
  const sendAfter=await adapter.address({address:sender.address,limit:1,expectedTip:tip2});
  assert.equal(sendAfter.balanceAtoms,'1000000000');
  assert.match(sendAfter.nextCursor,new RegExp('^'+tip2.hash+':1$'));
  const next=await adapter.address({address:sender.address,limit:1,cursor:sendAfter.nextCursor,expectedTip:tip2});
  assert.equal(next.events.length,1);

  await assert.rejects(adapter.address({
    address:sender.address,limit:1,cursor:sending.nextCursor
  }),e=>e instanceof ExplorerDataError&&e.code==='TIP_CHANGED'&&e.status===503);
  await assert.rejects(adapter.blocks({expectedTip:tip1}),
    e=>e instanceof ExplorerDataError&&e.code==='TIP_CHANGED');
  await assert.rejects(adapter.transaction({txid:'a'.repeat(64),expectedTip:tip2}),
    e=>e instanceof ExplorerDataError&&e.code==='NODE_HTTP_ERROR'&&e.status===404);
  const writeForbidden=await json(base,'explorer/status',{method:'POST'});
  assert.equal(writeForbidden.status,405);
  assert.equal(writeForbidden.data.error,'read_only');
  const cors=await fetch(base+'explorer/status',{method:'OPTIONS'});
  assert.equal(cors.status,204);
  assert.equal(cors.headers.get('access-control-allow-methods'),'GET,OPTIONS');
});