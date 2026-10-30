'use strict';
// V50 isolated ORIGINAL-SOURCE OWNER PATCH CANDIDATE. No protected owner PR
// is modified. This test stages exact PR #358 original node bytes into a
// disposable directory, applies an explicit minimal adapter locally, and
// verifies genuine original consensus + disk recovery via inherited OS IPC.
// A PASS is CANDIDATE evidence only; it does NOT confer source-owner admission.
const test=require('node:test');
const assert=require('node:assert/strict');
const {fork,execFileSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const {createServer}=require('node:net');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {OwnedNodeIpc}=require('../src/owned-node-ipc.cjs');
const ROOT=path.resolve(__dirname,'..','..');
const NODE_HEAD='dd331bb57e8718caa45e030633a4ff4bc64f47c6';
const MINER_HEAD='f85b483f88a5fb2b797a224596c23a7b505094d7';
const PINNED=Object.freeze({
  'sovereign-forge/node/fae-node.mjs':['08077143bfa586762a1a9b538b72cfa9021bac26',NODE_HEAD],
  'sovereign-forge/node/node-parent-port.mjs':['993aba068bb98a5d036ffda4786ef95550a6cdb0',NODE_HEAD],
  'sovereign-forge/node/explorer-read.mjs':['1f872c5cc1fadedcc05230276f5b0c3ed109c75d',NODE_HEAD],
  'sovereign-forge/node/managed-http-guard.mjs':['2efcf24d0b91ce7796e7a46822076ed017e72a03',NODE_HEAD],
  'standalone/fae-miner.mjs':['0ab1643c1ff1bf2991a2e56512a3b1746c62122b',MINER_HEAD],
  'standalone/mining-core.mjs':['42c392ad54a3e3c2f446ab79f67948d30b82a73e',MINER_HEAD],
  'universal-client/src/v34-original-miner-owned-worker.mjs':
    ['102ccc04ad1feb51b20196bab0ad23f63bca6755',MINER_HEAD]
});
const ADDRESS='faet1z5g4r8qgv29jcy350mvxgr3hpk35vjhdk3s6fn';
function replaceExact(source,oldValue,newValue,label){
  if(source.split(oldValue).length!==2)
    throw Error('Original node source-owner patch anchor mismatch: '+label);
  return source.replace(oldValue,newValue);
}
function blobHash(bytes){
  return createHash('sha1').update('blob '+bytes.length+String.fromCharCode(0))
    .update(bytes).digest('hex');
}
async function stageSource(dir){
  for(const [relative,[blob,head]] of Object.entries(PINNED)){
    const bytes=execFileSync('git',['show',head+':'+relative],
      {cwd:ROOT,maxBuffer:2000000});
    assert.equal(blobHash(bytes),blob,'original source must be exact: '+relative);
    const file=path.join(dir,...relative.split('/'));
    await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});
    await fs.writeFile(file,bytes,{flag:'wx',mode:0o600});
  }
  const portFile=path.join(dir,'sovereign-forge','node','node-parent-port.mjs');
  let parent=await fs.readFile(portFile,'utf8');
  parent=replaceExact(parent,
    "const MUTATION='submit-signed-tx';",
    "const MUTATION='submit-signed-tx';\nconst BLOCK='submit-mined-block';",'op');
  parent=replaceExact(parent,
    '  readTransaction,submitSignedTx,allowSignedMutation=false}){',
    '  readTransaction,submitSignedTx,allowSignedMutation=false,\n'+
    '  submitMinedBlock,allowBlockMutation=false}){','contract');
  parent=replaceExact(parent,
    "     typeof allowSignedMutation!=='boolean'||",
    "     typeof allowSignedMutation!=='boolean'||\n"+
    "     typeof allowBlockMutation!=='boolean'||\n"+
    "     (allowBlockMutation&&typeof submitMinedBlock!=='function')||",'owner gate');
  parent=replaceExact(parent,
    '!(READS.has(packet.op)||packet.op===MUTATION&&allowSignedMutation)||busy||',
    '!(READS.has(packet.op)||packet.op===MUTATION&&allowSignedMutation||'+
    'packet.op===BLOCK&&allowBlockMutation)||busy||','allowlist');
  parent=replaceExact(parent,
    '         packet.op===MUTATION?\n',
    "         packet.op===BLOCK?\n"+
    "           Object.keys(packet.params).length===1&&\n"+
    "           packet.params.submission&&typeof packet.params.submission==='object'&&\n"+
    "           !Array.isArray(packet.params.submission)&&\n"+
    "           Object.keys(packet.params.submission).sort().join(',')===\n"+
    "             'hash,header,nonce,txids'&&\n"+
    "           packet.params.submission.header?.network===network&&\n"+
    "           Number.isSafeInteger(packet.params.submission.nonce)&&\n"+
    "           packet.params.submission.nonce>=0&&\n"+
    "           typeof packet.params.submission.hash==='string'&&\n"+
    "           HEX64.test(packet.params.submission.hash)&&\n"+
    "           Array.isArray(packet.params.submission.txids)&&\n"+
    "           packet.params.submission.txids.length<=20:\n"+
    "         packet.op===MUTATION?\n",'shape');
  parent=replaceExact(parent,
    '          submitSignedTx(packet.params.tx));',
    '          packet.op===BLOCK?submitMinedBlock(packet.params.submission):\n'+
    '          submitSignedTx(packet.params.tx));','dispatch');
  parent=replaceExact(parent,
    'operations:[...READS,...(allowSignedMutation?[MUTATION]:[])]',
    'operations:[...READS,...(allowSignedMutation?[MUTATION]:[]),'+
    '...(allowBlockMutation?[BLOCK]:[])]','operations');
  await fs.writeFile(portFile,parent);
  const nodeFile=path.join(dir,'sovereign-forge','node','fae-node.mjs');
  let node=await fs.readFile(nodeFile,'utf8');
  node=replaceExact(node,
    "  process.env.FAE_TRIUM_SIGNED_TX_IPC_CANDIDATE==='1';",
    "  process.env.FAE_TRIUM_SIGNED_TX_IPC_CANDIDATE==='1';\n"+
    "const BLOCK_IPC_CANDIDATE=MANAGED_MODE&&\n"+
    "  process.env.FAE_TRIUM_BLOCK_IPC_CANDIDATE==='1';",'environment');
  node=replaceExact(node,
    "  if(MANAGED_MODE&&url.pathname==='/submit-tx'&&req.method==='POST')",
    "  if(MANAGED_MODE&&url.pathname==='/submit-block'&&req.method==='POST')"+
    "return send(res,403,{ok:false,error:'managed_block_ingress_requires_native_owner'});\n"+
    "  if(MANAGED_MODE&&url.pathname==='/submit-tx'&&req.method==='POST')",
    'http denial');
  node=replaceExact(node,
    '    allowSignedMutation:SIGNED_TX_IPC_CANDIDATE,',
    "    allowBlockMutation:BLOCK_IPC_CANDIDATE,\n"+
    "    submitMinedBlock:async submission=>{\n"+
    "      if(!BLOCK_IPC_CANDIDATE)throw Error('native_block_admission_not_granted');\n"+
    "      let accepted;\n"+
    "      await serial(async()=>{\n"+
    "        const next=appendBlockFromSubmission(state,{\n"+
    "          header:submission.header,nonce:submission.nonce,\n"+
    "          hash:submission.hash,txids:submission.txids\n"+
    "        });\n"+
    "        const previous=state;state=next;\n"+
    "        try{await persist()}catch(error){state=previous;throw error}\n"+
    "        accepted=tip(state);\n"+
    "      });\n"+
    "      return {ok:true,network:NETWORK,durable:true,\n"+
    "        height:accepted.height,hash:accepted.hash,\n"+
    "        tx_count:accepted.txids.length};\n"+
    "    },\n"+
    '    allowSignedMutation:SIGNED_TX_IPC_CANDIDATE,','original consensus adapter');
  await fs.writeFile(nodeFile,node);
  return {
    miner:await import(pathToFileURL(path.join(dir,'standalone','fae-miner.mjs')).href),
    core:await import(pathToFileURL(path.join(dir,'standalone','mining-core.mjs')).href)
  };
}
const WALLET_HEAD='17c90ffc313fd11de17396437436e4429472f616';
const WALLET_SOURCE_PINS=Object.freeze({
  'standalone/wallet/crypto.mjs':'1297bf2c268d865634a6f57da5f6b95557c633ac',
  'sovereign-forge/node/authoritative/address.mjs':'67143968791d85a51c09f0f9d0c0bfe8cb460e32',
  'sovereign-forge/node/authoritative/crypto.mjs':'beaa9a9ae5c65c0e97e9f3c5755a8e6b9ce8090c',
  'sovereign-forge/node/authoritative/canonical.mjs':'607a44f08865dc441556bad81d29984fda726c96',
  'bip39-en.js':'b6d65f9a3a662823516d033e6ecb2a6fbf2aadad'
});
async function stageExactOriginalWalletCrypto(dir){
  for(const [relative,blob] of Object.entries(WALLET_SOURCE_PINS)){
    const bytes=execFileSync('git',['show',WALLET_HEAD+':'+relative],
      {cwd:ROOT,maxBuffer:2000000});
    assert.equal(blobHash(bytes),blob,'exact protected Wallet source changed: '+relative);
    const dest=path.join(dir,...relative.split('/'));
    await fs.mkdir(path.dirname(dest),{recursive:true,mode:0o700});
    await fs.writeFile(dest,bytes,{flag:'wx',mode:0o400});
  }
  return import(pathToFileURL(path.join(dir,'standalone','wallet','crypto.mjs')).href);
}
async function port(){
  return await new Promise((resolve,reject)=>{
    const s=createServer();
    s.once('error',reject);
    s.listen(0,'127.0.0.1',()=>{
      const p=s.address()?.port;
      s.close(e=>e?reject(e):resolve(p));
    });
  });
}
function envFor(port,state,{signedTx=false}={}){
  const env={};
  for(const k of ['PATH','SystemRoot','WINDIR','HOME','USERPROFILE','TMP','TEMP','TMPDIR'])
    if(process.env[k])env[k]=process.env[k];
  return {...env,FAE_HOST:'127.0.0.1',FAE_PORT:String(port),
    FAE_SYNC:'0',FAE_UPSTREAM_API:'',FAE_PEERS:'',FAE_BOOTSTRAP_FEEDS:'',
    FAE_DATA_FILE:state,FAE_TRIUM_IPC:'1',FAE_TRIUM_BLOCK_IPC_CANDIDATE:'1',
    FAE_TRIUM_SIGNED_TX_IPC_CANDIDATE:signedTx?'1':'0'};
}
async function startOwnerCandidate(dir,state,portNum,{signedTx=false}={}){
  const script=path.join(dir,'sovereign-forge','node','fae-node.mjs');
  const child=fork(script,[],{cwd:dir,execArgv:[],
    env:envFor(portNum,state,{signedTx}),stdio:['ignore','pipe','pipe','ipc'],windowsHide:true});
  try{
    const target=' listening on http://127.0.0.1:'+portNum+' height=';
    await new Promise((resolve,reject)=>{
      let done=false,buf='';
      const finish=e=>{
        if(done)return;
        done=true;clearTimeout(timer);
        child.stdout.off('data',onData);child.off('exit',onExit);
        e?reject(e):resolve();
      };
      const onData=data=>{
        buf=(buf+String(data)).slice(-8192);
        if(buf.includes(target))finish();
      };
      const onExit=()=>finish(Error('Disposable original node exited before listen'));
      const timer=setTimeout(()=>finish(Error('Disposable original node listen timeout')),20000);
      child.stdout.on('data',onData);child.once('exit',onExit);
    });
    return child;
  }catch(e){
    child.kill();
    throw e;
  }
}
async function stop(child){
  if(!child)return;
  if(child.connected)child.disconnect();
  if(child.exitCode!==null||child.signalCode!==null)return;
  try{child.kill('SIGTERM')}catch{}
  await new Promise(resolve=>{
    if(child.exitCode!==null||child.signalCode!==null)return resolve();
    const t=setTimeout(()=>{try{child.kill('SIGKILL')}catch{}resolve()},2000);
    child.once('exit',()=>{clearTimeout(t);resolve()});
  });
}
test('V50 disposable original-node owner patch accepts REAL mined block on inherited IPC and recovers',
  {skip:process.env.TS_V50_NATIVE_BLOCK_OWNER_CANDIDATE!=='1',timeout:120000},
  async()=>{
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),'trium-v50-original-node-'));
    const stateFile=path.join(dir,'state.json');
    let child=null,ipc=null;
    try{
      const {miner,core}=await stageSource(dir);
      const p=await port();
      const url='http://127.0.0.1:'+p;
      child=await startOwnerCandidate(dir,stateFile,p);
      ipc=new OwnedNodeIpc(child,{allowBlockMutation:true,timeoutMs:5000});
      const initial=await ipc.read('status');
      assert.equal(initial.height,0);
      // Managed-node HTTP mutation must be denied even to another loopback process.
      let denied=await fetch(url+'/submit-block',{
        method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({})});
      assert.equal(denied.status,403,'no managed block HTTP fallback');
      const originalMiner=miner.resolveOptions({
        node:url,address:ADDRESS,once:true,json:true,'chunk-size':'4096',
        'yield-ms':'0'
      },{});
      let originalProof=null,actualReceipt=null;
      const mined=await miner.runMiner(originalMiner,{
        emit:()=>{},
        submitMinedBlock:async submission=>{
          const actual=core.buildSubmission(
            {header:submission.header,txids:submission.txids},
            submission.nonce,submission.hash);
          assert.deepEqual(actual,submission,'proof must come from original miner core');
          originalProof=submission;
          actualReceipt=await ipc.submitMinedBlock(submission);
          return actualReceipt;
        }
      });
      assert.equal(mined.accepted,1);
      assert.ok(mined.totalHashes>0);
      assert.ok(originalProof);
      assert.equal(actualReceipt.durable,true);
      assert.equal(actualReceipt.height,1);
      assert.equal(actualReceipt.hash,originalProof.hash);
      assert.equal((await ipc.read('status')).height,1);
      assert.equal((await ipc.read('status')).tip_hash,originalProof.hash);
      const saved=JSON.parse(await fs.readFile(stateFile,'utf8'));
      assert.equal(saved.chain.length,1,'original consensus chain persisted to disk');
      assert.equal(saved.chain[0].hash,originalProof.hash);
      ipc.revoke();ipc=null;
      await stop(child);child=null;
      const secondPort=await port();
      child=await startOwnerCandidate(dir,stateFile,secondPort);
      ipc=new OwnedNodeIpc(child,{allowBlockMutation:true,timeoutMs:5000});
      const recovered=await ipc.read('status');
      assert.equal(recovered.height,1);
      assert.equal(recovered.tip_hash,originalProof.hash);
      denied=await fetch('http://127.0.0.1:'+secondPort+'/submit-block',{
        method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({})});
      assert.equal(denied.status,403);
      console.log('TS_V50_OWNER_CANDIDATE_REAL_BLOCK_PASS '+JSON.stringify({
        node_owner_head:NODE_HEAD,miner_owner_head:MINER_HEAD,
        original_pow:true,original_node_consensus:true,
        process_inherited_ipc:true,private_mutation:true,
        durable_block:true,cold_restart:true,http_mutation_denied:true,
        protected_owner_branch_unchanged:true,
        protected_owner_admission:'NOT_GRANTED',gate_a:'CANDIDATE_ONLY'
      }));
    }finally{
      ipc?.revoke();
      await stop(child);
      await fs.rm(dir,{recursive:true,force:true});
    }
  });

test('V50 real original OS miner child -> trusted parent -> original node IPC -> durable block',
  {skip:process.env.TS_V50_NATIVE_BLOCK_OWNER_CANDIDATE!=='1',timeout:120000},
  async()=>{
    const {randomBytes}=require('node:crypto');
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),'trium-v50-original-worker-'));
    const stateFile=path.join(dir,'state.json');
    let node=null,minerChild=null,ipc=null;
    try{
      const {core}=await stageSource(dir);
      const nodePort=await port(),endpoint='http://127.0.0.1:'+nodePort;
      node=await startOwnerCandidate(dir,stateFile,nodePort);
      ipc=new OwnedNodeIpc(node,{allowBlockMutation:true,timeoutMs:5000});
      assert.equal((await ipc.read('status')).height,0);
      const session=randomBytes(32).toString('hex'),network='fairyelf-public-testnet-v4';
      const workerScript=path.join(dir,'universal-client','src','v34-original-miner-owned-worker.mjs');
      minerChild=fork(workerScript,[],{cwd:dir,execArgv:[],env:envFor(nodePort,stateFile),
        stdio:['ignore','pipe','pipe','ipc'],windowsHide:true});
      let phase='WAIT_READY',requests=0,proof=null,receipt=null;
      const done=await new Promise((resolve,reject)=>{
        let settled=false;
        const timeout=setTimeout(()=>fail(Error('Actual original miner child IPC timed out')),80000);
        const finish=(error,value)=>{
          if(settled)return;
          settled=true;clearTimeout(timeout);
          error?reject(error):resolve(value);
        };
        const fail=error=>{
          if(minerChild?.connected)minerChild.disconnect();
          finish(error);
        };
        minerChild.on('error',()=>fail(Error('Actual original miner OS worker failed')));
        minerChild.on('message',message=>{
          if(settled)return;
          try{
            if(!message||typeof message!=='object'||Array.isArray(message)||
              Buffer.byteLength(JSON.stringify(message),'utf8')>65536||
              message.session!==session||message.network!==network)
              throw Error('Forged original OS miner message');
            if(message.type==='fae-v34-ready'){
              if(phase!=='WAIT_READY')throw Error('Replayed miner ready');
              phase='READY';return;
            }
            if(message.type==='fae-v34-telemetry'){
              if(phase==='WAIT_READY'||phase==='FINISHED')throw Error('Invalid miner telemetry sequence');
              return;
            }
            if(message.type==='fae-v34-proposal'){
              if(phase!=='READY'||message.request_id!==1||requests!==0)
                throw Error('Repeated or unauthorized mined-block proposal');
              const submission=message.submission;
              const canonical=core.buildSubmission({
                header:submission?.header,txids:submission?.txids
              },submission?.nonce,submission?.hash);
              assert.deepEqual(canonical,submission,
                'Original miner child must submit exact genuine original PoW proof');
              assert.equal(core.workMeetsTarget(submission.hash,submission.header.difficulty_bits),true);
              phase='SUBMITTING';requests=1;proof=submission;
              void ipc.submitMinedBlock(submission).then(result=>{
                if(settled)return;
                receipt=result;
                phase='ACKED';
                minerChild.send({type:'fae-v34-submit-result',session,network,
                  request_id:message.request_id,ok:true,receipt:result},
                error=>{if(error)fail(Error('Miner child result transport failed'))});
              }).catch(()=>fail(Error('Original node private block submission failed')));
              return;
            }
            if(message.type==='fae-v34-finish'){
              if(phase!=='ACKED'||message.status!=='STOPPED')
                throw Error('Original miner OS child completion not authenticated');
              phase='FINISHED';
              if(minerChild.connected)minerChild.disconnect();
              return;
            }
            throw Error('Unexpected original miner OS child opcode');
          }catch(error){fail(error)}
        });
        minerChild.once('exit',(code,signal)=>{
          if(settled)return;
          if(phase!=='FINISHED'||code!==0||signal!==null||requests!==1||
            !proof||!receipt||receipt.durable!==true)
            return finish(Error('Original OS miner child did not complete a valid authenticated block'));
          finish(null,{proof,receipt});
        });
        minerChild.send({type:'fae-v34-start',session,network,
          node:endpoint,address:ADDRESS},error=>{
          if(error)fail(Error('Original miner OS child startup failed'));
        });
      });
      assert.equal(done.receipt.hash,done.proof.hash);
      assert.equal(done.receipt.height,1);
      assert.equal((await ipc.read('status')).tip_hash,done.proof.hash);
      const written=JSON.parse(await fs.readFile(stateFile,'utf8'));
      assert.equal(written.chain.length,1);
      assert.equal(written.chain[0].hash,done.proof.hash);
      ipc.revoke();ipc=null;
      await stop(minerChild);minerChild=null;
      await stop(node);node=null;
      const restartPort=await port();
      node=await startOwnerCandidate(dir,stateFile,restartPort);
      ipc=new OwnedNodeIpc(node,{allowBlockMutation:true,timeoutMs:5000});
      const recovered=await ipc.read('status');
      assert.equal(recovered.height,1);
      assert.equal(recovered.tip_hash,done.proof.hash);
      const denied=await fetch('http://127.0.0.1:'+restartPort+'/submit-block',{
        method:'POST',headers:{'content-type':'application/json'},body:'{}'});
      assert.equal(denied.status,403);
      console.log('TS_V50_REAL_OS_MINER_TO_ORIGINAL_NODE_IPC_PASS '+JSON.stringify({
        original_miner_owner:MINER_HEAD,original_node_owner:NODE_HEAD,
        genuine_os_miner_child:true,trusted_parent:true,genuine_os_node_child:true,
        original_consensus:true,durable_block:true,cold_restart:true,
        no_managed_http_mutation:true,protected_owner_branch_unchanged:true,
        owner_admission:'NOT_GRANTED',gate_a:'CANDIDATE_ONLY'
      }));
    }finally{
      ipc?.revoke();
      await stop(minerChild);
      await stop(node);
      await fs.rm(dir,{recursive:true,force:true});
    }
  });

test('V50 isolated original Wallet owner A-to-B through actual signed original-node IPC, mined confirmation and cold restart',
  {skip:process.env.TS_V50_NATIVE_BLOCK_OWNER_CANDIDATE!=='1',timeout:120000},
  async()=>{
    // This disposable integration uses original Wallet #342 cryptography from
    // exact owner bytes. It does NOT use a user vault, renderer, or admitted
    // original Wallet signing process: Gate B/C/D remain OPEN.
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),'trium-v50-wallet-ab-'));
    const stateFile=path.join(dir,'state.json');
    let node=null,ipc=null;
    try{
      const {miner,core}=await stageSource(dir);
      const wallet=await stageExactOriginalWalletCrypto(dir);
      const a=wallet.deriveRecords(wallet.entropyToMnemonic(Buffer.alloc(32,0x11)))[0];
      const b=wallet.deriveRecords(wallet.entropyToMnemonic(Buffer.alloc(32,0xab)))[0];
      assert.notEqual(a.address,b.address);
      const initialPort=await port();
      let endpoint='http://127.0.0.1:'+initialPort;
      node=await startOwnerCandidate(dir,stateFile,initialPort,{signedTx:true});
      ipc=new OwnedNodeIpc(node,{allowBlockMutation:true,
        allowSignedTxMutation:true,timeoutMs:5000});
      assert.equal((await ipc.read('status')).height,0);
      async function mineOne(address){
        const options=miner.resolveOptions({node:endpoint,address,once:true,json:true,
          'chunk-size':'4096','yield-ms':'0'},{});
        let nativeReceipt=null;
        const mined=await miner.runMiner(options,{emit:()=>{},
          submitMinedBlock:async submission=>{
            const checked=core.buildSubmission({
              header:submission.header,txids:submission.txids
            },submission.nonce,submission.hash);
            assert.deepEqual(submission,checked,'original mining-core must validate each proof');
            nativeReceipt=await ipc.submitMinedBlock(submission);
            return nativeReceipt;
          }
        });
        assert.equal(mined.accepted,1);
        assert.ok(mined.totalHashes>0);
        assert.equal(nativeReceipt.durable,true);
        return nativeReceipt;
      }
      const funded=await mineOne(a.address);
      assert.equal(funded.height,1);
      const fundedBalance=await ipc.read('balance',{address:a.address});
      assert.equal(fundedBalance.balance_atoms,'1000000000');
      const originalSpend=wallet.buildSignedTransaction(a,[funded.hash+':0'],[
        {address:b.address,amount_atoms:'100000000'},
        {address:a.address,amount_atoms:'899999999'}
      ]);
      assert.equal(originalSpend.tx.network,'fairyelf-public-testnet-v4');
      const accepted=await ipc.submitSignedTx(originalSpend.tx,originalSpend.txid);
      assert.equal(accepted.txid,originalSpend.txid);
      assert.equal(accepted.fee_atoms,'1');
      assert.equal(accepted.status,'pending');
      assert.equal(accepted.confirmation_finality,'NOT_PROVEN');
      const pending=await ipc.read('transaction-lookup',{txid:originalSpend.txid});
      assert.equal(pending.found,true);
      assert.equal(pending.status,'pending');
      assert.equal(pending.confirmed_height,null);
      const confirmedBlock=await mineOne(a.address);
      assert.equal(confirmedBlock.height,2);
      const confirmed=await ipc.read('transaction-lookup',{txid:originalSpend.txid});
      assert.equal(confirmed.found,true);
      assert.equal(confirmed.status,'confirmed');
      assert.equal(confirmed.confirmed_height,2);
      const bBalance=await ipc.read('balance',{address:b.address});
      assert.equal(bBalance.balance_atoms,'100000000');
      const persisted=JSON.parse(await fs.readFile(stateFile,'utf8'));
      assert.equal(persisted.chain.length,2);
      assert.equal(persisted.transactions[originalSpend.txid].status,'confirmed');
      assert.equal(persisted.transactions[originalSpend.txid].fee_atoms,'1');
      assert.equal(persisted.utxos[funded.hash+':0'].spent,true);
      ipc.revoke();ipc=null;
      await stop(node);node=null;
      const coldPort=await port();
      endpoint='http://127.0.0.1:'+coldPort;
      node=await startOwnerCandidate(dir,stateFile,coldPort,{signedTx:true});
      ipc=new OwnedNodeIpc(node,{allowBlockMutation:true,
        allowSignedTxMutation:true,timeoutMs:5000});
      const recovered=await ipc.read('transaction-lookup',{txid:originalSpend.txid});
      assert.equal(recovered.status,'confirmed');
      assert.equal(recovered.confirmed_height,2);
      assert.equal((await ipc.read('status')).tip_hash,confirmedBlock.hash);
      assert.equal((await ipc.read('balance',{address:b.address})).balance_atoms,'100000000');
      const denied=await fetch(endpoint+'/submit-tx',{
        method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({tx:originalSpend.tx})});
      assert.equal(denied.status,403,'managed original-node HTTP signing path must remain denied');
      console.log('TS_V50_REAL_ORIGINAL_WALLET_NATIVE_AB_CANDIDATE_PASS '+JSON.stringify({
        original_wallet_owner:WALLET_HEAD,original_node_owner:NODE_HEAD,
        original_miner_owner:MINER_HEAD,disposable_keys_only:true,
        original_crypto:true,original_consensus:true,original_fee_atoms:'1',
        real_signed_tx:true,authenticated_node_ipc:true,
        mempool_accepted:true,mined_confirmation:true,b_received:true,
        cold_restart_recovered:true,no_managed_http_tx_mutation:true,
        protected_owner_branches_unchanged:true,
        original_wallet_signer_process_admitted:false,
        source_owner_admission:'NOT_GRANTED',native_GUI_A_to_B:false,
        gate_b:'OPEN',gate_c:'CANDIDATE_ONLY',gate_d:'OPEN'
      }));
    }finally{
      ipc?.revoke();
      await stop(node);
      await fs.rm(dir,{recursive:true,force:true});
    }
  });
