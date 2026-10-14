import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,webcrypto} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {chmod,mkdtemp,readFile,writeFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import vm from 'node:vm';
import {encodeAddress} from '../sovereign-forge/node/authoritative/address.mjs';
import {verifyTxCrypto} from '../sovereign-forge/node/authoritative/fae-v4-core.mjs';
import {entropyToMnemonic,mnemonicToEntropy,deriveRecords,buildSignedTransaction,parseAtoms,NETWORK} from '../standalone/wallet/crypto.mjs';
import {readVault,unlockVault,writeVault} from '../standalone/wallet/vault.mjs';
import {normalizeNode,parseCli,planSpend,nodeRequest,statusForNode,outputsForNode} from '../standalone/wallet/fae-wallet.mjs';

const root=resolve(new URL('..',import.meta.url).pathname);
const mnemonic=entropyToMnemonic(Buffer.alloc(32));
const phrase2=entropyToMnemonic(Buffer.alloc(32,0xab));
function browserWallet(){
  const context={window:{},crypto:webcrypto,Uint8Array,TextEncoder,
    E:new TextEncoder(),
    sh:async bytes=>new Uint8Array(await webcrypto.subtle.digest('SHA-256',bytes)),
    b64:bytes=>Buffer.from(bytes).toString('base64'),
    fb:value=>Uint8Array.from(Buffer.from(value,'base64')),
    address:payload=>encodeAddress(Buffer.from(payload),'faet')};
  vm.runInNewContext(readFileSync(join(root,'bip39-en.js'),'utf8'),context,{timeout:1000});
  vm.runInNewContext(readFileSync(join(root,'wallet-crypto.js'),'utf8'),context,{timeout:1000});
  return context.window.FAEWalletCrypto;
}
const web=browserWallet();

test('AUTHENTIC WEB parity: same BIP39 checksum, legacy no-passphrase, indices and passphrase',async()=>{
  assert.equal(mnemonic.split(' ').length,24);
  assert.equal(mnemonic,'abandon '.repeat(23)+'art');
  assert.deepEqual(mnemonicToEntropy(mnemonic),Buffer.alloc(32));
  for(const [phrase,passphrase] of [[mnemonic,''],[mnemonic,'Tést 123'],[phrase2,''],[phrase2,'custom pass']]){
    const native=deriveRecords(phrase,passphrase);
    const browser=await web.deriveAddressRecords(phrase,passphrase,5);
    assert.equal(browser.mnemonic,phrase);
    assert.equal(browser.passphraseProtected,Boolean(passphrase));
    for(let index=0;index<5;index++){
      assert.equal(native[index].address,browser.addresses[index].address);
      assert.equal(native[index].public_key_spki,browser.addresses[index].pub);
    }
  }
  assert.notEqual(deriveRecords(mnemonic,'')[0].address,deriveRecords(mnemonic,'different')[0].address);
  assert.throws(()=>mnemonicToEntropy(mnemonic.replace('art','zoo')),/invalid_recovery_checksum/);
  assert.throws(()=>mnemonicToEntropy('abandon '.repeat(23)+'nonsense'),/unknown_recovery_word/);
});

test('transaction signing is exact FAIRYELF_TX_V2, valid to canonical node and rejects tampering',()=>{
  const a=deriveRecords(mnemonic)[0],b=deriveRecords(phrase2)[0];
  const raw={inputs:['independent-fixture:0'],outputs:[{address:b.address,amount_atoms:'100000000'}]};
  const {tx,txid}=buildSignedTransaction(a,raw.inputs,raw.outputs);
  const checked=verifyTxCrypto(tx);
  assert.equal(checked.ok,true,JSON.stringify(checked));
  assert.equal(checked.from,a.address);
  assert.equal(checked.txid,txid);
  assert.equal(verifyTxCrypto({...tx,network:'another-chain'}).ok,false);
  assert.equal(verifyTxCrypto({...tx,signature:'A'+tx.signature.slice(1)}).ok,false);
  assert.equal(verifyTxCrypto({...tx,outputs:[{...tx.outputs[0],amount_atoms:'100000001'}]}).ok,false);
  assert.equal(verifyTxCrypto({...tx,public_key_spki:b.public_key_spki}).ok,false);
  assert.throws(()=>buildSignedTransaction({address:a.address,public_key_spki:a.public_key_spki},raw.inputs,raw.outputs),/watch_only/);
  assert.throws(()=>parseAtoms('1.123456789'),/invalid_amount_precision/);
  const selected=planSpend([{source:'pending',outpoint:'fake:0',amount_atoms:'1000000000'},
    {source:'confirmed',outpoint:'real:0',amount_atoms:'200000000'}],
    a.address,b.address,parseAtoms('1'),parseAtoms('0.1'));
  assert.deepEqual(selected.inputs,['real:0']);
  assert.equal(selected.outputs[1].amount_atoms,'90000000');
});

test('encrypted vault create/read/recover, corruption, wrong password, permissions, no plaintext',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'fae-vault-'));
  const p=join(dir,'local.vault.json');
  const password='correct horse battery staple';
  try{
    const created=await writeVault(p,mnemonic,'Tést 123',password);
    assert.equal(created.length,5);
    assert.equal((await stat(p)).mode&0o777,0o600);
    const bytes=await readFile(p,'utf8');
    assert.ok(!bytes.includes('abandon'));
    assert.ok(!bytes.includes('Tést'));
    assert.ok(!bytes.includes('correct horse battery staple'));
    assert.equal((await readVault(p)).public_addresses[0].address,created[0].address);
    assert.equal((await unlockVault(p,password))[2].address,created[2].address);
    await assert.rejects(unlockVault(p,'wrong password'),/incorrect_password_or_corrupt_vault/);
    await assert.rejects(writeVault(p,mnemonic,'',password),/EEXIST/);
    await chmod(p,0o644);
    await assert.rejects(readVault(p),/private_0600/);
    await chmod(p,0o600);
    const redirected=JSON.parse(bytes);
    redirected.public_addresses[0].address=deriveRecords(phrase2)[0].address;
    await writeFile(p,JSON.stringify(redirected)+'\n',{mode:0o600});
    await assert.rejects(unlockVault(p,password),/incorrect_password_or_corrupt_vault/);
    await writeFile(p,bytes,{mode:0o600});
    const corrupted=JSON.parse(bytes);
    corrupted.encryption.tag='AAAAAAAAAAAAAAAAAAAAAA==';
    await writeFile(p,JSON.stringify(corrupted)+'\n',{mode:0o600});
    await assert.rejects(unlockVault(p,password),/incorrect_password_or_corrupt_vault/);
  }finally{await rm(dir,{recursive:true,force:true})}
});

test('CLI fails closed on secret argv, watch-only spend, wrong endpoint and no TTY',()=>{
  assert.throws(()=>parseCli(['send','--watch',deriveRecords(mnemonic)[0].address,'--amount','1','--to',deriveRecords(phrase2)[0].address]),/watch_only/);
  assert.throws(()=>parseCli(['recover','--mnemonic',mnemonic]),/invalid_or_duplicate_option/);
  assert.throws(()=>normalizeNode('http://example.com:8787'),/remote_node_must_use_https/);
  assert.throws(()=>normalizeNode('https://user:password@example.com'),/credentials/);
  assert.equal(normalizeNode('http://127.0.0.1:8787'),'http://127.0.0.1:8787');
  const out=execFileSync(process.execPath,[join(root,'standalone','wallet','fae-wallet.mjs'),'help'],{encoding:'utf8'});
  assert.match(out,/FAE Sovereign Wallet/);
});

async function waitNode(base){
  for(let i=0;i<160;i++){try{let r=await fetch(base+'/status');if(r.ok)return await r.json()}catch{}await new Promise(y=>setTimeout(y,50))}
  throw Error('isolated_node_failed_to_start');
}
function spawnNode(port,file){
  return spawn(process.execPath,[join(root,'sovereign-forge','node','fae-node.mjs')],{
    env:{...process.env,FAE_PORT:String(port),FAE_HOST:'127.0.0.1',FAE_DATA_FILE:file,
      FAE_SYNC:'0',FAE_UPSTREAM_API:'',FAE_PEERS:'',FAE_BOOTSTRAP_FEEDS:''},
    stdio:['ignore','pipe','pipe']});
}
async function killNode(child){
  if(!child)return;
  if(child.exitCode!==null)return;
  await new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGTERM');setTimeout(resolve,1200)});
}
async function mineOne(base,address){
  const script=join(root,'standalone','fae-miner.mjs');
  const child=spawn(process.execPath,[script,'--node',base,'--address',address,
    '--once','--nonce-start','0','--chunk-size','4096','--tip-poll-ms','1000','--json'],
    {stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';
  child.stdout.on('data',x=>stdout+=x.toString());
  child.stderr.on('data',x=>stderr+=x.toString());
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{child.kill('SIGTERM');reject(Error('miner_timeout'))},100_000);
    child.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error('miner_'+code+' '+stderr.slice(0,500)))});
  });
  assert.match(stdout,/WORK_ACCEPTED/);
}


async function actualInteractiveCli(args,promptsAndAnswers){
  const cmd=[process.execPath,join(root,'standalone','wallet','fae-wallet.mjs'),...args];
  const child=spawn('script',['-q','-e','-c',cmd.join(' '),'/dev/null'],{stdio:['pipe','pipe','pipe']});
  let output='',step=0;
  child.stdout.on('data',chunk=>{
    output+=chunk.toString();
    if(step<promptsAndAnswers.length&&output.includes(promptsAndAnswers[step][0])){
      const answer=promptsAndAnswers[step][1];
      step++;
      child.stdin.write(answer+'\n');
      if(step===promptsAndAnswers.length)child.stdin.end();
    }
  });
  const code=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('interactive_CLI_timeout'))},20000);
    child.once('exit',n=>{clearTimeout(timer);resolve(n)});
    child.once('error',reject);
  });
  assert.equal(code,0,'interactive CLI execution failed (secret output redacted)');
  assert.equal(step,promptsAndAnswers.length,'interactive CLI missed required private prompts');
  const json=output.split(/\r?\n/).find(line=>line.trim().startsWith('{"'));
  assert.ok(json,'interactive CLI must return a public receipt');
  return{receipt:JSON.parse(json.trim()),output};
}
test('actual interactive create -> 24-word backup -> recover creates identical encrypted independent address identities',{timeout:90000},async()=>{
  const dir=await mkdtemp(join(tmpdir(),'fae-wallet-creation-'));
  const a=join(dir,'a.vault.json'),b=join(dir,'b.vault.json');
  const password='correct horse battery staple';
  try{
    const created=await actualInteractiveCli(['create','--vault',a],[
      ['FAE derivation passphrase (optional, hidden): ','Tést 123'],
      ['Vault password (hidden): ',password],
      ['Repeat vault password (hidden): ',password]
    ]);
    const match=/RECOVERY PHRASE[^\r\n]*\r?\n([a-z ]+)\r?\n/.exec(created.output);
    assert.ok(match,'create must display 24 words only on interactive terminal');
    const generated=match[1].trim();
    assert.equal(generated.split(' ').length,24);
    assert.equal((await stat(a)).mode&0o777,0o600);
    const restored=await actualInteractiveCli(['recover','--vault',b],[
      ['24-word recovery phrase (hidden): ',generated],
      ['FAE derivation passphrase (optional, hidden): ','Tést 123'],
      ['Vault password (hidden): ',password],
      ['Repeat vault password (hidden): ',password]
    ]);
    assert.deepEqual(restored.receipt.addresses,created.receipt.addresses);
    assert.equal(restored.output.includes(generated),false,'recovery must never echo input mnemonic');
    assert.equal((await unlockVault(a,password))[0].address,(await unlockVault(b,password))[0].address);
    const checked=await actualInteractiveCli(['address','--vault',b],[
      ['Vault password (hidden): ',password]
    ]);
    assert.equal(checked.receipt.address,created.receipt.addresses[0]);
    assert.equal(checked.output.includes(password),false,'verified receive address must never echo password');
  }finally{await rm(dir,{recursive:true,force:true})}
});

async function sendViaActualCliPty(base,vault,destination,password){
  // util-linux "script" gives the real Node CLI a controlling interactive TTY;
  // only synthetic, disposable test passwords flow over this local pipe.
  const args=[
    process.execPath,join(root,'standalone','wallet','fae-wallet.mjs'),
    'send','--vault',vault,'--node',base,'--to',destination,'--amount','1'
  ];
  const child=spawn('script',['-q','-e','-c',args.join(' '),'/dev/null'],{stdio:['pipe','pipe','pipe']});
  let output='',stderr='',answered=false;
  child.stdout.on('data',chunk=>{
    output+=chunk.toString();
    if(!answered&&output.includes('Vault password (hidden): ')){
      answered=true;child.stdin.write(password+'\n');child.stdin.end();
    }
  });
  child.stderr.on('data',chunk=>stderr+=chunk.toString());
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('CLI PTY timeout'))},15000);
    child.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error('CLI PTY rejected '+code+' '+stderr+' '+output.slice(-700)))});
    child.once('error',reject);
  });
  assert.equal(answered,true,'actual CLI had to ask for hidden password');
  assert.ok(!output.includes(password),'CLI must not echo vault password');
  const line=output.split(/\r?\n/).find(line=>line.trim().startsWith('{"state":"accepted_unconfirmed"'));
  assert.ok(line,'actual standalone CLI must emit accepted-but-unconfirmed receipt');
  return JSON.parse(line.trim());
}

test('REAL isolated independent node: mine to A, signed A->B, reject mutation and double spend, mine and restart',{timeout:240000},async()=>{
  const dir=await mkdtemp(join(tmpdir(),'fae-wallet-node-'));
  const port=18000+Math.floor(Math.random()*1000),base='http://127.0.0.1:'+port,stateFile=join(dir,'node.json');
  const a=deriveRecords(mnemonic)[0],b=deriveRecords(phrase2)[0];
  let node=null;
  try{
    node=spawnNode(port,stateFile);
    assert.equal((await waitNode(base)).height,0);
    await mineOne(base,a.address);
    assert.equal((await statusForNode(base)).height,1);
    const available=await nodeRequest(base,'/spendable?address='+encodeURIComponent(a.address));
    const plan=planSpend(available.utxos,a.address,b.address,100000000n);
    const {tx,txid}=buildSignedTransaction(a,plan.inputs,plan.outputs);
    assert.equal(verifyTxCrypto(tx).ok,true);
    await assert.rejects(nodeRequest(base,'/submit-tx','POST',{tx:{...tx,signature:'A'+tx.signature.slice(1)}}),/node_rejected_request/);
    const vault=join(dir,'a.vault.json'),password='correct horse battery staple';
    await writeVault(vault,mnemonic,'',password);
    const accepted=await sendViaActualCliPty(base,vault,b.address,password);
    assert.equal(accepted.txid,txid);
    assert.equal(accepted.fee_atoms,'0');
    assert.equal(accepted.state,'accepted_unconfirmed');
    const historyBefore=await nodeRequest(base,'/transactions?address='+encodeURIComponent(b.address));
    assert.equal(historyBefore.transactions.find(x=>x.txid===txid).status,'pending');
    // Crash/restart AFTER accepted receipt but BEFORE mining: persisted mempool
    // must not become a fictitious confirmation or allow the same spend again.
    await killNode(node);node=null;
    node=spawnNode(port,stateFile);
    assert.equal((await waitNode(base)).height,1);
    const restoredPending=await nodeRequest(base,'/transactions?address='+encodeURIComponent(b.address));
    assert.equal(restoredPending.transactions.find(x=>x.txid===txid).status,'pending');
    assert.equal((await outputsForNode(base,b.address)).balance_atoms,'0');
    await assert.rejects(nodeRequest(base,'/submit-tx','POST',{tx}),/node_rejected_request/);
    const double={...buildSignedTransaction(a,plan.inputs,[{address:b.address,amount_atoms:'90000000'},
      {address:a.address,amount_atoms:'910000000'}]).tx};
    await assert.rejects(nodeRequest(base,'/submit-tx','POST',{tx:double}),/node_rejected_request/);
    await mineOne(base,a.address);
    assert.equal((await statusForNode(base)).height,2);
    const historyAfter=await nodeRequest(base,'/transactions?address='+encodeURIComponent(b.address));
    const confirmed=historyAfter.transactions.find(x=>x.txid===txid);
    assert.equal(confirmed.status,'confirmed');
    assert.equal(Number(confirmed.confirmed_height),2);
    const bBalance=await outputsForNode(base,b.address);
    assert.equal(bBalance.balance_atoms,'100000000');
    await killNode(node);node=null;
    node=spawnNode(port,stateFile);
    assert.equal((await waitNode(base)).height,2);
    assert.equal((await outputsForNode(base,b.address)).balance_atoms,'100000000');
    assert.equal((await nodeRequest(base,'/transactions?address='+encodeURIComponent(b.address)))
      .transactions.find(x=>x.txid===txid).status,'confirmed');
  }finally{await killNode(node);await rm(dir,{recursive:true,force:true})}
});
