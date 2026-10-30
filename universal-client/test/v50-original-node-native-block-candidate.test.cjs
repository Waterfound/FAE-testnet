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
const {ProcessController}=require('../src/controller.cjs');
const {FILES:ORIGINAL_NODE_FILES,MINER_FILES:ORIGINAL_MINER_FILES}=require('../src/pinned-node-source.cjs');
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

test('V51 actual native parent bridge drives ORIGINAL OS miner into candidate original consensus and cold restart',
  {skip:process.env.TS_V50_NATIVE_BLOCK_OWNER_CANDIDATE!=='1',timeout:120000},
  async()=>{
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),'trium-v51-owner-parent-'));
    const stateFile=path.join(dir,'state.json');
    let node=null,minerChild=null,ipc=null;
    try{
      await stageSource(dir);
      const nodePort=await port(),endpoint='http://127.0.0.1:'+nodePort;
      node=await startOwnerCandidate(dir,stateFile,nodePort);
      ipc=new OwnedNodeIpc(node,{allowBlockMutation:true,timeoutMs:5000});
      assert.equal((await ipc.read('status')).height,0);
      const workerScript=path.join(dir,'universal-client','src',
        'v34-original-miner-owned-worker.mjs');
      minerChild=fork(workerScript,[],{cwd:dir,execArgv:[],env:envFor(nodePort,stateFile),
        stdio:['ignore','pipe','pipe','ipc'],windowsHide:true});
      let progress=0;
      // Drive the actual ProcessController owner-gated native worker method.
      // This original-node copy lives only in a disposable test root; its
      // checksums grant no admission outside this local test process.
      const nodePins={};
      for(const file of ORIGINAL_NODE_FILES){
        nodePins[file]=createHash('sha256').update(
          await fs.readFile(path.join(dir,...file.split('/')))).digest('hex');
      }
      const controller=new ProcessController({
        repoRoot:dir,dataDir:dir,port:nodePort,nativeIpcCandidate:true,
        nativeNodeSourcePins:nodePins
      });
      controller.node=node;
      controller.nodeIpc=ipc;
      const minerPins={};
      for(const file of ORIGINAL_MINER_FILES){
        minerPins[file]=createHash('sha256').update(
          await fs.readFile(path.join(dir,...file.split('/')))).digest('hex');
      }
      await assert.rejects(controller.runAdmittedOriginalMinerWorkerOnce({
        minerChild,address:ADDRESS,
        minerSourcePins:{...minerPins,[ORIGINAL_MINER_FILES[0]]:'0'.repeat(64)}
      }),/Native original-miner source verification failed/);
      assert.equal(controller.miner,null,'mismatched source pin never admits original worker');
      const done=await controller.runAdmittedOriginalMinerWorkerOnce({
        minerChild,address:ADDRESS,minerSourcePins:minerPins,
        onTelemetry:()=>{progress++}
      });
      assert.equal(controller.nativeMinerBridge,null);
      assert.equal(controller.snapshot().miner,'stopped');
      assert.equal(controller.snapshot().telemetry.accepted,1,
        'only a genuine durable original-node block increments accepted count');
      assert.equal(controller.snapshot().telemetry.hashrate_hs,null,
        'original worker does not supply measured rate; do not fabricate one');
      assert.equal(done.block_count,1);
      assert.equal(done.status,'STOPPED');
      assert.equal(done.receipt.durable,true);
      assert.equal(done.receipt.height,1);
      assert.ok(/^[0-9a-f]{64}$/.test(done.receipt.hash));
      assert.ok(progress>0,'original worker progress passed through trusted client parent');
      const accepted=await ipc.read('status');
      assert.equal(accepted.tip_hash,done.receipt.hash);
      assert.equal(accepted.height,1);
      const written=JSON.parse(await fs.readFile(stateFile,'utf8'));
      assert.equal(written.chain.length,1);
      assert.equal(written.chain[0].hash,done.receipt.hash);
      ipc.revoke();ipc=null;
      await stop(minerChild);minerChild=null;
      await stop(node);node=null;
      const restartPort=await port();
      node=await startOwnerCandidate(dir,stateFile,restartPort);
      ipc=new OwnedNodeIpc(node,{allowBlockMutation:true,timeoutMs:5000});
      const recovered=await ipc.read('status');
      assert.equal(recovered.height,1);
      assert.equal(recovered.tip_hash,done.receipt.hash);
      const denied=await fetch('http://127.0.0.1:'+restartPort+'/submit-block',{
        method:'POST',headers:{'content-type':'application/json'},body:'{}'});
      assert.equal(denied.status,403);
      console.log('TS_V51_REAL_CLIENT_PARENT_MINER_BRIDGE_PASS '+JSON.stringify({
        original_miner_owner:MINER_HEAD,original_node_owner:NODE_HEAD,
        actual_client_process_controller:true,genuine_os_miner_child:true,
        genuine_os_node_child:true,original_consensus:true,durable_block:true,
        cold_restart:true,no_managed_http_mutation:true,
        protected_owner_branch_unchanged:true,owner_admission:'NOT_GRANTED',
        installed_gui_mining:false,gate_a:'CANDIDATE_ONLY'
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


const {OwnedDisposableWalletSignerBridge}=require('../src/owned-disposable-wallet-signer-bridge.cjs');

test('V52 genuine OS-disposable original Wallet signer -> original node signed A-to-B, confirmation and recovery', {
  skip:process.env.TS_V50_NATIVE_BLOCK_OWNER_CANDIDATE!=='1',timeout:120000
},async()=>{
  // This proof has no user vault, no renderer, no wallet password and no
  // production signing admission. The protected crypto files are original
  // exact PR #342 bytes; only test keys and source-only temp node copies exist.
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'trium-v52-owned-signer-'));
  const stateFile=path.join(dir,'state.json');
  let node=null,ipc=null;
  try{
    const {miner,core}=await stageSource(dir);
    const wallet=await stageExactOriginalWalletCrypto(dir);
    const a=wallet.deriveRecords(wallet.entropyToMnemonic(Buffer.alloc(32,0x11)))[0];
    const b=wallet.deriveRecords(wallet.entropyToMnemonic(Buffer.alloc(32,0xab)))[0];
    const signerScript=path.join(dir,'universal-client','src',
      'v52-disposable-original-wallet-signer.mjs');
    // Windows checkout may normalize CRLF in the worktree. Read the exact
    // committed Git blob instead of potentially transformed worktree bytes.
    const signerBytes=execFileSync('git',[
      'show','HEAD:universal-client/src/v52-disposable-original-wallet-signer.mjs'
    ],{cwd:ROOT,maxBuffer:100000});
    // Fix the candidate worker identity independently of the fork command
    // line. Original Wallet imports above are also owner-blob pinned.
    assert.equal(blobHash(signerBytes),'e3a194618e13cdb95766e6cc8faa309d57b78f96',
      'Reviewed disposable signer OS worker source changed');
    await fs.writeFile(signerScript,signerBytes,{flag:'wx',mode:0o400});
    const p=await port();
    let endpoint='http://127.0.0.1:'+p;
    node=await startOwnerCandidate(dir,stateFile,p,{signedTx:true});
    ipc=new OwnedNodeIpc(node,{allowBlockMutation:true,
      allowSignedTxMutation:true,timeoutMs:5000});
    const mine=async()=>{
      const options=miner.resolveOptions({node:endpoint,address:a.address,
        once:true,json:true,'chunk-size':'4096','yield-ms':'0'},{});
      let genuine=null;
      const result=await miner.runMiner(options,{emit:()=>{},
        submitMinedBlock:async submission=>{
          assert.deepEqual(core.buildSubmission({
            header:submission.header,txids:submission.txids
          },submission.nonce,submission.hash),submission);
          genuine=await ipc.submitMinedBlock(submission);
          return genuine;
        }
      });
      assert.equal(result.accepted,1);
      assert.equal(genuine.durable,true);
      return genuine;
    };
    const funded=await mine();
    assert.equal(funded.height,1);
    assert.equal((await ipc.read('balance',{address:a.address})).balance_atoms,'1000000000');
    // The V54 ProcessController performs the source-pinned OS fork itself.
    const nodePins={};
    for(const item of ORIGINAL_NODE_FILES)
      nodePins[item]=createHash('sha256').update(
        await fs.readFile(path.join(dir,...item.split('/')))).digest('hex');
    const actualController=new ProcessController({
      repoRoot:dir,dataDir:dir,port:p,nativeIpcCandidate:true,
      nativeNodeSourcePins:nodePins
    });
    actualController.node=node;actualController.nodeIpc=ipc;
    // No ambient test/CLI/renderer flag: default must deny the candidate.
    await assert.rejects(actualController.runIsolatedOriginalWalletSignerCandidateOnce({
      
      signerSourceSha256:createHash('sha256').update(signerBytes).digest('hex'),
      from:a.address,to:b.address,outpoint:funded.hash+':0'
    }),/product admission not granted/);
    const before=process.env.TS_V54_ISOLATED_SIGNER_OWNER_PROOF;
    let receipt;
    try{
      process.env.TS_V54_ISOLATED_SIGNER_OWNER_PROOF='1';
      await assert.rejects(
        actualController.runIsolatedOriginalWalletSignerCandidateOnce({
          signerSourceSha256:'0'.repeat(64),from:a.address,to:b.address,
          outpoint:funded.hash+':0'
        }),/Independently pinned disposable Wallet signer source mismatch/);
      assert.equal(actualController.signer,null,'tampered source denied before OS spawn');
      receipt=await actualController.runIsolatedOriginalWalletSignerCandidateOnce({
        
        signerSourceSha256:createHash('sha256').update(signerBytes).digest('hex'),
        from:a.address,to:b.address,outpoint:funded.hash+':0'
      });
    }finally{
      if(before===undefined)delete process.env.TS_V54_ISOLATED_SIGNER_OWNER_PROOF;
      else process.env.TS_V54_ISOLATED_SIGNER_OWNER_PROOF=before;
    }
    assert.equal(actualController.signer,null,'controller must never retain finished signer');
    assert.equal(receipt.status,'pending');
    assert.equal(receipt.fee_atoms,'1');
    assert.equal(receipt.confirmation_finality,'NOT_PROVEN');
    assert.match(receipt.txid,/^[0-9a-f]{64}$/);
    assert.equal(actualController.signer,null,
      'controller must release the finished signer OS child');
    let observed=await ipc.read('transaction-lookup',{txid:receipt.txid});
    assert.equal(observed.status,'pending');
    assert.equal(observed.confirmed_height,null);
    const second=await mine();
    assert.equal(second.height,2);
    observed=await ipc.read('transaction-lookup',{txid:receipt.txid});
    assert.equal(observed.status,'confirmed');
    assert.equal(observed.confirmed_height,2);
    assert.equal((await ipc.read('balance',{address:b.address})).balance_atoms,'100000000');
    const saved=JSON.parse(await fs.readFile(stateFile,'utf8'));
    assert.equal(saved.transactions[receipt.txid].fee_atoms,'1');
    assert.equal(saved.transactions[receipt.txid].status,'confirmed');
    ipc.revoke();ipc=null;

    await stop(node);node=null;
    const cold=await port();
    endpoint='http://127.0.0.1:'+cold;
    node=await startOwnerCandidate(dir,stateFile,cold,{signedTx:true});
    ipc=new OwnedNodeIpc(node,{allowBlockMutation:true,
      allowSignedTxMutation:true,timeoutMs:5000});
    observed=await ipc.read('transaction-lookup',{txid:receipt.txid});
    assert.equal(observed.status,'confirmed');
    assert.equal(observed.confirmed_height,2);
    assert.equal((await ipc.read('balance',{address:b.address})).balance_atoms,'100000000');
    console.log('TS_V52_ORIGINAL_WALLET_OS_DISPOSABLE_SIGNER_AB_PASS '+JSON.stringify({
      original_wallet_owner:WALLET_HEAD,original_node_owner:NODE_HEAD,
      original_miner_owner:MINER_HEAD,actual_os_signer_child:true,
      deterministic_disposable_keys_only:true,no_vault_or_password:true,
      original_cryptography:true,original_consensus:true,
      v54_actual_process_controller_wallet_lifecycle:true,
      v54_actual_source_pinned_os_fork:true,
      v54_invalid_signer_hash_denied_before_spawn:true,
      no_renderer_wallet_signing:true,
      one_shot_native_signed_tx:true,pending_then_mined:true,
      fee_atoms:'1',recipient_atoms:'100000000',cold_restart:true,
      protected_owner_branch_unchanged:true,
      real_wallet_signer_admitted:false,installed_gui_signed_send:false,
      gate_b:'CANDIDATE_ONLY',gate_c:'CANDIDATE_ONLY',gate_d:'OPEN'
    }));
  }finally{
    ipc?.revoke();
    await stop(node);
    await fs.rm(dir,{recursive:true,force:true});
  }
});

test('V55 true original encrypted Wallet vault + outbox in owned OS child -> original consensus native A-to-B', {
  skip:process.env.TS_V50_NATIVE_BLOCK_OWNER_CANDIDATE!=='1',timeout:160000
},async()=>{
  // The original Wallet #342 owner checks exact realpath identity. On
  // Windows the default temp alias can be a junction; canonicalize FIRST.
  const tempParent=await fs.realpath(os.tmpdir());
  const dir=await fs.mkdtemp(path.join(tempParent,'trium-v55-vault-'));
  const stateFile=path.join(dir,'state.json');
  let node=null,ipc=null;
  try{
    const {miner,core}=await stageSource(dir);
    const wallet=await stageExactOriginalWalletCrypto(dir);
    const b=wallet.deriveRecords(wallet.entropyToMnemonic(Buffer.alloc(32,0xab)))[0];
    // Stage the exact original Wallet #342 protected source closure; never
    // copy tests' own vault/signing implementation in its place.
    const originals={
      'standalone/wallet/fae-wallet.mjs':'cc31ca36621c6f08054e93f38ef1d7b9fc06a8f6',
      'standalone/wallet/vault.mjs':'04f138b90d9b6883ba78efe05e96e2fe63e14091',
      'standalone/wallet/outbox.mjs':'5d4708f64237af428bbba52aea2ee741b06f06ff'
    };
    for(const [relative,expected] of Object.entries(originals)){
      const bytes=execFileSync('git',['show',WALLET_HEAD+':'+relative],
        {cwd:ROOT,maxBuffer:1000000});
      assert.equal(blobHash(bytes),expected,'Original Wallet owner source mismatch: '+relative);
      const full=path.join(dir,...relative.split('/'));
      await fs.mkdir(path.dirname(full),{recursive:true,mode:0o700});
      await fs.writeFile(full,bytes,{flag:'wx',mode:0o400});
    }
    const workerPath='universal-client/src/v55-isolated-original-vault-signer.mjs';
    const bytes=execFileSync('git',['show','HEAD:'+workerPath],
      {cwd:ROOT,maxBuffer:1000000});
    assert.equal(blobHash(bytes),'662de47aa567b222debac9eed8b6cb4db84ca157',
      'Reviewed V55 Wallet worker changed');
    const workerFile=path.join(dir,...workerPath.split('/'));
    await fs.mkdir(path.dirname(workerFile),{recursive:true,mode:0o700});
    await fs.writeFile(workerFile,bytes,{flag:'wx',mode:0o400});
    const p=await port();
    let endpoint='http://127.0.0.1:'+p;
    node=await startOwnerCandidate(dir,stateFile,p,{signedTx:true});
    ipc=new OwnedNodeIpc(node,{allowBlockMutation:true,
      allowSignedTxMutation:true,timeoutMs:5000});
    const nodePins={};
    for(const name of ORIGINAL_NODE_FILES)
      nodePins[name]=createHash('sha256').update(
        await fs.readFile(path.join(dir,...name.split('/')))).digest('hex');
    const controller=new ProcessController({
      repoRoot:dir,dataDir:dir,port:p,nativeIpcCandidate:true,
      nativeNodeSourcePins:nodePins
    });
    controller.node=node;controller.nodeIpc=ipc;
    await assert.rejects(controller.runIsolatedOriginalVaultCandidateOnce({
      to:b.address,prepareFunding:()=>{throw Error('SHOULD_NOT_MINE')}
    }),/user-signing admission not granted/);
    // An invalid source must be rejected before any process, vault or TX.
    const prior=process.env.TS_V55_ISOLATED_VAULT_OWNER_PROOF;
    let result;
    try{
      process.env.TS_V55_ISOLATED_VAULT_OWNER_PROOF='1';
      await fs.chmod(workerFile,0o600);
      await fs.appendFile(workerFile,'\n// injected source mutation\n');
      await assert.rejects(controller.runIsolatedOriginalVaultCandidateOnce({
        to:b.address,prepareFunding:()=>{throw Error('SHOULD_NOT_MINE')}
      }),/isolated-vault-worker source verification failed/);
      await fs.writeFile(workerFile,bytes,{mode:0o400});
      assert.equal(controller.signer,null,'untrusted worker may not spawn');
      const mine=async(address)=>{
        const opts=miner.resolveOptions({node:endpoint,address,once:true,json:true,
          'chunk-size':'4096','yield-ms':'0'},{});
        let ack=null;
        const proof=await miner.runMiner(opts,{emit:()=>{},
          submitMinedBlock:async submission=>{
            assert.deepEqual(core.buildSubmission({
              header:submission.header,txids:submission.txids
            },submission.nonce,submission.hash),submission);
            ack=await ipc.submitMinedBlock(submission);
            return ack;
          }
        });
        assert.equal(proof.accepted,1);
        assert.equal(ack.durable,true);
        return ack;
      };
      result=await controller.runIsolatedOriginalVaultCandidateOnce({
        to:b.address,
        prepareFunding:async from=>{
          const first=await mine(from);
          assert.equal(first.height,1);
          const balance=await ipc.read('balance',{address:from});
          assert.equal(balance.balance_atoms,'1000000000');
          const tip=await ipc.read('status');
          return {outpoint:first.hash+':0',source_atoms:'1000000000',
            tip_height:tip.height,tip_hash:tip.tip_hash};
        }
      });
      assert.equal(result.authority,'ISOLATED_DISPOSABLE_ORIGINAL_VAULT_ONLY');
      assert.equal(result.user_authorization,'TEST_FIXTURE_NOT_REAL_USER');
      assert.equal(result.receipt.status,'pending');
      assert.equal(result.receipt.fee_atoms,'1');
      assert.equal(controller.signer,null,'owned signer OS child must terminate');
      const vault=JSON.parse(await fs.readFile(result.vault_path,'utf8'));
      const outbox=JSON.parse(await fs.readFile(result.outbox_path,'utf8'));
      assert.equal(vault.format,'FAE_STANDALONE_VAULT_V1');
      assert.equal(outbox.format,'FAE_STANDALONE_OUTBOX_V1');
      assert.equal(vault.encryption.cipher,'aes-256-gcm');
      assert.equal(outbox.encryption.cipher,'aes-256-gcm');
      assert.equal(outbox.encryption.kdf,'scrypt');
      assert.equal(vault.public_addresses[0].address,result.from);
      const rawOutbox=await fs.readFile(result.outbox_path,'utf8');
      assert.ok(!rawOutbox.includes(result.txid),
        'TXID is encrypted in original owner outbox');
      assert.ok(!rawOutbox.includes(result.from),
        'no plaintext address in original owner outbox');
      const pending=await ipc.read('transaction-lookup',{txid:result.txid});
      assert.equal(pending.status,'pending');
      // A new signer process cannot overwrite an unresolved outbox/vault.
      await assert.rejects(controller.runIsolatedOriginalVaultCandidateOnce({
        to:b.address,prepareFunding:()=>{throw Error('NO_SECOND_MINING')}
      }),/outcome unknown|original wallet|wallet signer|vault/i);
      assert.equal(controller.signer,null);
      const confirmed=await mine(result.from);
      assert.equal(confirmed.height,2);
      assert.equal((await ipc.read('transaction-lookup',{
        txid:result.txid})).status,'confirmed');
      assert.equal((await ipc.read('balance',{address:b.address})).balance_atoms,
        '100000000');
      ipc.revoke();ipc=null;
      await stop(node);node=null;
      const cold=await port();
      endpoint='http://127.0.0.1:'+cold;
      node=await startOwnerCandidate(dir,stateFile,cold,{signedTx:true});
      ipc=new OwnedNodeIpc(node,{allowBlockMutation:true,
        allowSignedTxMutation:true,timeoutMs:5000});
      const recovered=await ipc.read('transaction-lookup',{txid:result.txid});
      assert.equal(recovered.status,'confirmed');
      assert.equal(recovered.confirmed_height,2);
      assert.equal((await ipc.read('balance',{address:b.address})).balance_atoms,
        '100000000');
      assert.equal((await fs.readFile(result.outbox_path,'utf8')),rawOutbox,
        'encrypted outbox remains unchanged and blocks automatic retry');
      console.log('TS_V55_ORIGINAL_ENCRYPTED_VAULT_NATIVE_AB_PASS '+JSON.stringify({
        original_wallet_owner:WALLET_HEAD,original_node_owner:NODE_HEAD,
        original_miner_owner:MINER_HEAD,original_encrypted_vault:true,
        random_disposable_secrets_only_inside_child:true,
        original_source_pinned_snapshot:true,original_coin_selection:true,
        real_os_child_under_controller:true,outbox_fsynced_before_submission:true,
        encrypted_unresolved_outbox_persisted:true,
        original_native_signed_tx:true,pending_then_mined:true,
        cold_node_restart:true,double_request_denied:true,
        no_user_credential_ipc:true,real_user_approval:false,
        production_signer_admitted:false,installed_gui_payment:false
      }));
    }finally{
      if(prior===undefined)delete process.env.TS_V55_ISOLATED_VAULT_OWNER_PROOF;
      else process.env.TS_V55_ISOLATED_VAULT_OWNER_PROOF=prior;
    }
  }finally{
    ipc?.revoke();await stop(node);
    await fs.rm(dir,{recursive:true,force:true});
  }
});
