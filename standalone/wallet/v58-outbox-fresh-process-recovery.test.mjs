// V58 original Wallet real process-stop and fresh-process recovery.
// Real OS child processes, real AES-GCM original outbox. Testnet identities only.
// Parent terminates AFTER the child reports an actual write result or owner
// gate. This is NOT a mid-write crash, OS reboot, or power-loss experiment.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {mkdtemp,rm,readFile,writeFile,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {newMnemonic,NETWORK} from './crypto.mjs';
import {writeVault} from './vault.mjs';
import {intentPath} from './outbox.mjs';

const WORKER=fileURLToPath(new URL('./v58-outbox-fresh-process-worker.mjs',import.meta.url));
const TEST_PASSWORD='V58-disposable-test-only-password-never-reuse';
function launch(){
  // No secrets in argv, env, stdout or stderr. Worker receives only public
  // addresses and file location through test-only private Node IPC.
  return fork(WORKER,[],{execArgv:[],stdio:['ignore','ignore','ignore','ipc']});
}
function request(child,command){
  return new Promise((resolve,reject)=>{
    const deadline=setTimeout(()=>finish(Error('V58 original Wallet child timed out')),50000);
    const onExit=(code,signal)=>finish(Error('V58 child exited early '+String(code)+' '+String(signal)));
    const onError=(error)=>finish(error);
    const onMsg=(response)=>finish(null,response);
    function finish(err,result){
      clearTimeout(deadline);
      child.off('exit',onExit);
      child.off('error',onError);
      child.off('message',onMsg);
      if(err)reject(err);else resolve(result);
    }
    child.once('exit',onExit);
    child.once('error',onError);
    child.once('message',onMsg);
    child.send(command,error=>{if(error)finish(error)});
  });
}
async function terminate(child){
  if(child.exitCode!==null||child.signalCode!==null)return;
  const complete=new Promise(resolve=>child.once('exit',resolve));
  assert.equal(child.kill('SIGKILL'),true,'test child termination requested');
  await Promise.race([complete,new Promise((_,reject)=>
    setTimeout(()=>reject(Error('V58 test child failed to terminate')),20000))]);
}
test('V58 original encrypted outbox survives real worker termination, fresh recovery, and tamper denial',
  {timeout:160000},async()=>{
  const root=await realpath(tmpdir());
  const dir=await mkdtemp(join(root,'v58-original-wallet-'));
  const vault=join(dir,'disposable-vault.json'),outbox=intentPath(vault);
  const children=[];
  try{
    const publicRows=await writeVault(vault,newMnemonic(),'',TEST_PASSWORD);
    const record={network:NETWORK,txid:'d'.repeat(64),
      node:'http://127.0.0.1:8025',address:publicRows[0].address,
      recipient:publicRows[1].address,amount_atoms:'100000000',
      fee_atoms:'1',tip_height:2,tip_hash:'e'.repeat(64)};
    const writeChild=launch();children.push(writeChild);
    const writeReply=await request(writeChild,{mode:'write',outbox,intent:record});
    assert.equal(writeReply.result,process.platform==='win32'?
      'WIN32_OWNER_GATE_FAIL_CLOSED':'WRITE_ACK');
    // Terminate a real independent process after its observed result.
    await terminate(writeChild);
    const recoveryChild=launch();children.push(recoveryChild);
    const recovery=await request(recoveryChild,{mode:'recover',outbox,intent:record});
    assert.deepEqual(recovery,{result:'FRESH_PROCESS_RECOVERED',
      encrypted:true,single_flight:true,wrong_password_denied:true});
    await terminate(recoveryChild);
    // Deterministic *synthetic disk corruption* of the real encrypted
    // original Wallet outbox, not a fabricated sudden-power-loss event.
    const blob=JSON.parse(await readFile(outbox,'utf8'));
    const previous=blob.encryption.payload;
    assert.ok(typeof previous==='string'&&previous.length>10);
    blob.encryption.payload=(previous[0]==='A'?'B':'A')+previous.slice(1);
    await writeFile(outbox,JSON.stringify(blob)+'\n',{encoding:'utf8'});
    const corruptChild=launch();children.push(corruptChild);
    const corrupted=await request(corruptChild,
      {mode:'recover-corrupt',outbox,intent:record});
    assert.deepEqual(corrupted,{result:'CORRUPT_ORIGINAL_OUTBOX_FAIL_CLOSED',
      corrupted_denied:true,single_flight:true});
    await terminate(corruptChild);
    console.log('TS_V58_ORIGINAL_OUTBOX_FRESH_PROCESS_RECOVERY_PASS '+JSON.stringify({
      operating_system:process.platform,
      post_result_real_worker_termination:true,
      fresh_process_recovered_encrypted_original_intent:true,
      original_single_flight_duplicate_rejected:true,
      original_wrong_password_rejected:true,
      synthetic_ciphertext_corruption_denied:true,
      corrupt_intent_still_blocks_duplicate:true,
      win32_owner_durability_gate_kept:process.platform==='win32',
      during_write_forced_kill_tested:false,
      os_crash_tested:false,
      sudden_power_loss_tested:false,
      installed_gui_payment_tested:false
    }));
  }finally{
    for(const child of children){
      if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');
    }
    await rm(dir,{recursive:true,force:true});
  }
});
