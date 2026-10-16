import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,webcrypto} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {chmod,mkdtemp,readFile,writeFile,rm,stat,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import vm from 'node:vm';
import {createServer} from 'node:http';
import {encodeAddress} from '../sovereign-forge/node/authoritative/address.mjs';
import {verifyTxCrypto} from '../sovereign-forge/node/authoritative/fae-v4-core.mjs';
import {entropyToMnemonic,mnemonicToEntropy,deriveRecords,buildSignedTransaction,parseAtoms,NETWORK} from '../standalone/wallet/crypto.mjs';
import {readVault,unlockVault,writeVault} from '../standalone/wallet/vault.mjs';
import {normalizeNode,parseCli,planSpend,nodeRequest,statusForNode,outputsForNode,historyForNode,assertSameNodeTip,submitSignedWithReceipt,reconcileIntent} from '../standalone/wallet/fae-wallet.mjs';
import {intentPath,writeIntent,readIntent,acknowledgeConfirmedIntent} from '../standalone/wallet/outbox.mjs';

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

test('real HTTP drop AFTER accepting signed payload returns deterministic submission-outcome-unknown, never auto-retries',async()=>{
  const from=deriveRecords(mnemonic)[0],to=deriveRecords(phrase2)[0];
  const {tx,txid}=buildSignedTransaction(from,['synthetic-disposable:0'],[
    {address:to.address,amount_atoms:'100000000'}]);
  const deliveries=[];
  let mode='drop_after_read';
  const server=createServer(async(req,res)=>{
    const chunks=[];
    for await(const chunk of req)chunks.push(chunk);
    deliveries.push(JSON.parse(Buffer.concat(chunks).toString('utf8')).tx);
    if(mode==='drop_after_read'){req.socket.destroy();return}
    res.writeHead(mode==='reject'?409:mode==='duplicate'?409:200,
      {'content-type':'application/json'});
    if(mode==='reject')res.end(JSON.stringify({ok:false,error:'invalid_signature'}));
    else if(mode==='duplicate')res.end(JSON.stringify({ok:false,error:'duplicate_txid'}));
    else res.end(JSON.stringify({ok:true,txid:'f'.repeat(64),fee_atoms:'0'}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  try{
    const uncertain=await submitSignedWithReceipt(base,tx,txid,'0');
    assert.equal(uncertain.state,'submission_outcome_unknown');
    assert.equal(uncertain.txid,txid);
    assert.equal(uncertain.reason,'receipt_lost_or_duplicate_unknown');
    assert.equal(deliveries.length,1,'never retry transport-unknown automatically');
    assert.deepEqual(deliveries[0],tx,'original signed transaction retained without exposing keys');
    mode='duplicate';
    const duplicate=await submitSignedWithReceipt(base,tx,txid,'0');
    assert.equal(duplicate.state,'submission_outcome_unknown');
    assert.equal(duplicate.txid,txid);
    mode='wrong_receipt';
    const falseAck=await submitSignedWithReceipt(base,tx,txid,'0');
    assert.equal(falseAck.state,'submission_outcome_unknown');
    assert.equal(falseAck.reason,'node_receipt_mismatch');
    mode='reject';
    await assert.rejects(submitSignedWithReceipt(base,tx,txid,'0'),/node_rejected_request:invalid_signature/);
  }finally{
    await new Promise(resolve=>server.close(resolve));
  }
});

test('real HTTP reorg between node status and balance/history fails closed without a stale confirmation',async()=>{
  const address=deriveRecords(phrase2)[0].address;
  let statusReads=0,moveOnStatus=2;
  const node=createServer((req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1');
    res.setHeader('content-type','application/json');
    if(url.pathname==='/status'){
      statusReads++;
      return res.end(JSON.stringify({ok:true,network:NETWORK,height:statusReads>=moveOnStatus?2:1,
        tip_hash:(statusReads>=moveOnStatus?'b':'a').repeat(64)}));
    }
    if(url.pathname==='/balance')return res.end(JSON.stringify({
      ok:true,address,balance_atoms:'100000000',utxos:[{source:'confirmed',outpoint:'valid:0',amount_atoms:'100000000'}]
    }));
    if(url.pathname==='/transactions')return res.end(JSON.stringify({ok:true,transactions:[{
      txid:'f'.repeat(64),status:'confirmed',confirmed_height:1
    }]}));
    res.statusCode=404;res.end(JSON.stringify({ok:false,error:'not_found'}));
  });
  await new Promise(resolve=>node.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+node.address().port;
  try{
    await assert.rejects(outputsForNode(base,address),/node_tip_changed_during_read/);
    statusReads=0;moveOnStatus=3;
    const view=await outputsForNode(base,address);
    assert.equal(view.observed_tip.tip_hash,'a'.repeat(64));
    await assert.rejects(historyForNode(base,address,view),/node_tip_changed_during_read/);
    statusReads=0;moveOnStatus=100;
    const stable=await outputsForNode(base,address);
    const history=await historyForNode(base,address,stable);
    assert.equal(history.transactions[0].state,'confirmed');
    assert.equal(history.provenance,'selected_node_untrusted_until_independently_synced');
    assert.throws(()=>assertSameNodeTip({height:1,tip_hash:'a'.repeat(64)},
      {height:1,tip_hash:'b'.repeat(64)}),/node_tip_changed_during_read/);
  }finally{await new Promise(resolve=>node.close(resolve))}
});

test('encrypted outbox fsyncs before send; one-flight exclusivity, corruption fail-closed and explicit settlement',{timeout:45000},async()=>{
  const dir=await mkdtemp(join(tmpdir(),'fae-outbox-unit-')),file=join(dir,'account.outbox.json');
  const a=deriveRecords(mnemonic)[0],password='correct horse battery staple';
  const intent={network:NETWORK,txid:'a'.repeat(64),node:'http://127.0.0.1:8787',
    address:a.address,recipient:deriveRecords(phrase2)[0].address,
    amount_atoms:'100000000',fee_atoms:'0',tip_height:1,tip_hash:'b'.repeat(64)};
  try{
    await writeIntent(file,intent,password);
    assert.equal((await stat(file)).mode&0o777,0o600);
    const disk=await readFile(file,'utf8');
    assert.ok(!disk.includes(intent.txid)&&!disk.includes(a.address)&&!disk.includes(intent.recipient),
      'outbox sender, recipient and TXID details must remain ciphertext');
    assert.ok(!disk.includes(password));
    assert.deepEqual(await readIntent(file,password),intent);
    await assert.rejects(writeIntent(join(dir,'invalid.outbox.json'),{...intent,recipient:'faet1invalid'},password),
      /invalid_outbox_intent/,'corrupt recipient address must fail closed before disk allocation');
    const legacy=join(dir,'legacy.outbox.json');
    const legacyRecord={...intent};delete legacyRecord.recipient;
    await writeIntent(legacy,legacyRecord,password);
    assert.deepEqual(await readIntent(legacy,password),legacyRecord,
      'old encrypted outbox records without recipient must remain recoverable');
    await assert.rejects(writeIntent(file,{...intent,txid:'c'.repeat(64)},password),/EEXIST/);
    await assert.rejects(readIntent(file,'incorrect password'),/outbox_wrong_password_or_corrupt/);
    await assert.rejects(acknowledgeConfirmedIntent(file,password,intent.txid,
      {state:'pending_node_reported',txid:intent.txid}),/outbox_not_confirmed/);
    const tampered=JSON.parse(disk);tampered.encryption.tag='AAAAAAAAAAAAAAAAAAAAAA==';
    await writeFile(file,JSON.stringify(tampered)+'\n');
    await assert.rejects(readIntent(file,password),/outbox_wrong_password_or_corrupt/);
    await writeFile(file,disk);
    await chmod(file,0o644);
    await assert.rejects(readIntent(file,password),/outbox_requires_private_0600_file/);
    await chmod(file,0o600);
    await acknowledgeConfirmedIntent(file,password,intent.txid,
      {state:'confirmed_node_reported',txid:intent.txid});
    await assert.rejects(access(file),/ENOENT/);
  }finally{await rm(dir,{recursive:true,force:true})}
});

test('real CLI process SIGKILL after POST preserves encrypted TXID; later process reads outbox without retry',{timeout:65000},async()=>{
  const dir=await mkdtemp(join(tmpdir(),'fae-outbox-process-'));
  const vault=join(dir,'sender.vault.json'),pidFile=join(dir,'sender.pid'),scriptPath=join(dir,'killable-sender.sh');
  const sender=deriveRecords(mnemonic)[0],recipient=deriveRecords(phrase2)[0];
  const password='correct horse battery staple';
  let calls=0,receivedTx=null,child=null,nodeState='pending',receiptTxid=null;
  const server=createServer(async(req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1');
    res.setHeader('content-type','application/json');
    if(url.pathname==='/status')return res.end(JSON.stringify({ok:true,network:NETWORK,height:1,tip_hash:'a'.repeat(64)}));
    if(url.pathname==='/balance')return res.end(JSON.stringify({ok:true,address:sender.address,
      balance_atoms:'1000000000',utxos:[{outpoint:'isolated-fixture:0',amount_atoms:'1000000000',source:'confirmed'}]}));
    if(url.pathname==='/transactions')return res.end(JSON.stringify({ok:true,transactions:receiptTxid?[{
      txid:receiptTxid,status:nodeState,confirmed_height:nodeState==='confirmed'?1:null
    }]:[]}));
    if(url.pathname==='/submit-tx'){
      calls++;
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      receivedTx=JSON.parse(Buffer.concat(chunks).toString('utf8')).tx;
      assert.equal(verifyTxCrypto(receivedTx).ok,true);
      receiptTxid=buildSignedTransaction(sender,receivedTx.inputs,receivedTx.outputs).txid;
      // Kill the REAL signed-transaction CLI process after its network payload
      // arrived, but before any acceptance response is returned.
      const pid=Number((await readFile(pidFile,'utf8')).trim());
      assert.ok(Number.isSafeInteger(pid)&&pid>1);
      process.kill(pid,'SIGKILL');
      req.socket.destroy();
      return;
    }
    res.statusCode=404;res.end(JSON.stringify({ok:false,error:'not_found'}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  try{
    await writeVault(vault,mnemonic,'',password);
    const cli=join(root,'standalone','wallet','fae-wallet.mjs');
    // Test-only executable contains no secret, just our disposable vault path.
    await writeFile(scriptPath,'#!/bin/sh\necho $$ > '+pidFile+'\nexec '+process.execPath+
      ' '+cli+' send --vault '+vault+' --node '+base+' --to '+recipient.address+' --amount 1\n',{mode:0o700});
    child=spawn('script',['-q','-e','-c',scriptPath,'/dev/null'],{stdio:['pipe','pipe','pipe']});
    let output='',answered=false;
    child.stdout.on('data',chunk=>{
      output+=chunk.toString();
      if(!answered&&output.includes('Vault password (hidden): ')){
        answered=true;child.stdin.write(password+'\n');child.stdin.end()
      }
    });
    const exit=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('sender_process_kill_timeout'))},20000);
      child.once('exit',code=>{clearTimeout(timer);resolve(code)});
      child.once('error',reject);
    });
    assert.notEqual(exit,0,'sender process must be killed mid-send');
    assert.equal(answered,true);
    assert.equal(calls,1);
    assert.ok(receivedTx);
    assert.ok(!output.includes(password),'TTY must not echo signing password');
    const record=await readIntent(intentPath(vault),password);
    assert.equal(record.txid,receiptTxid);
    assert.equal(record.address,sender.address);
    assert.equal(record.recipient,recipient.address,'recovered intent must identify the actual recipient');
    assert.equal((await readFile(intentPath(vault),'utf8')).includes(recipient.address),false,
      'recipient provenance must remain encrypted at rest');
    assert.equal(record.node,base);
    assert.equal((await stat(intentPath(vault))).mode&0o777,0o600);
    assert.equal((await reconcileIntent(record)).state,'pending_node_reported');
    assert.equal(calls,1,'read-only reconciliation must never resubmit');
    // Another actual CLI SEND must fail before touching the network, because
    // the single-flight outbox already exists.
    const duplicate=spawn('script',['-q','-e','-c',scriptPath,'/dev/null'],{stdio:['pipe','pipe','pipe']});
    let duplicateOut='',secondAnswered=false;
    duplicate.stdout.on('data',x=>{duplicateOut+=x.toString();if(!secondAnswered&&duplicateOut.includes('Vault password (hidden): ')){
      secondAnswered=true;duplicate.stdin.write(password+'\n');duplicate.stdin.end()
    }});
    const duplicateExit=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{duplicate.kill('SIGKILL');reject(Error('duplicate_cli_timeout'))},16000);
      duplicate.once('exit',code=>{clearTimeout(timer);resolve(code)});
      duplicate.once('error',reject);
    });
    assert.notEqual(duplicateExit,0);
    assert.match(duplicateOut,/EEXIST|file already exists/);
    assert.equal(calls,1,'duplicate send blocked by existing durable journal');
    nodeState='confirmed';
    const confirmation=await reconcileIntent(record);
    assert.equal(confirmation.state,'confirmed_node_reported');
    await acknowledgeConfirmedIntent(intentPath(vault),password,receiptTxid,confirmation);
    await assert.rejects(access(intentPath(vault)),/ENOENT/);
  }finally{
    if(child?.exitCode===null)child.kill('SIGKILL');
    await new Promise(resolve=>server.close(resolve));
    await rm(dir,{recursive:true,force:true});
  }
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
