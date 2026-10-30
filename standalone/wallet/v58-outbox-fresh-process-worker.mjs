// V58 real fresh-process original Wallet recovery worker (test-only).
// No real funds, node POST, mnemonic, private key or user credentials over IPC.
import {writeIntent,readIntent} from './outbox.mjs';
import {readFile} from 'node:fs/promises';

const PASSWORD='V58-disposable-test-only-password-never-reuse';
const isHex64=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
let dispatched=false;
process.on('message',async msg=>{
  if(dispatched||!msg||!['write','recover','recover-corrupt'].includes(msg.mode)||
     typeof msg.outbox!=='string'||!msg.outbox.includes('v58-original-wallet-')||
     !isHex64(msg.intent?.txid)){
    process.send?.({result:'REJECTED_TEST_JOB'});
    return;
  }
  dispatched=true;
  const {outbox,intent}=msg;
  if(msg.mode==='write'){
    try{
      await writeIntent(outbox,intent,PASSWORD);
      process.send?.({result:'WRITE_ACK'});
    }catch(error){
      if(process.platform==='win32'&&
         String(error?.message).includes('win32_original_outbox_durability_owner_admission_required'))
        process.send?.({result:'WIN32_OWNER_GATE_FAIL_CLOSED'});
      else process.send?.({result:'UNEXPECTED_WRITE_FAILURE'});
    }
  }else if(msg.mode==='recover-corrupt'){
    try{
      let corruptedDenied=false;
      try{await readIntent(outbox,PASSWORD)}
      catch(error){corruptedDenied=String(error?.message).includes('outbox_wrong_password_or_corrupt')}
      if(!corruptedDenied)throw Error('corrupt_original_record_accepted');
      let duplicateDenied=false;
      try{await writeIntent(outbox,intent,PASSWORD)}
      catch(error){duplicateDenied=error?.code==='EEXIST'}
      if(!duplicateDenied)throw Error('corrupt_outbox_retry_allowed');
      process.send?.({result:'CORRUPT_ORIGINAL_OUTBOX_FAIL_CLOSED',
        corrupted_denied:true,single_flight:true});
    }catch{
      process.send?.({result:'UNEXPECTED_CORRUPT_RECOVERY_FAILURE'});
    }
  }else{
    try{
      const recovered=await readIntent(outbox,PASSWORD);
      if(recovered.txid!==intent.txid)throw Error('txid_drift');
      const ciphertext=await readFile(outbox,'utf8');
      if(ciphertext.includes(intent.txid)||ciphertext.includes(PASSWORD))
        throw Error('unprotected_outbox_payload');
      let duplicateDenied=false;
      try{await writeIntent(outbox,intent,PASSWORD)}
      catch(error){duplicateDenied=error?.code==='EEXIST'}
      if(!duplicateDenied)throw Error('duplicate_allowed');
      let wrongPasswordDenied=false;
      try{await readIntent(outbox,'incorrect-v58-test-password')}
      catch(error){wrongPasswordDenied=String(error?.message).includes('outbox_wrong_password_or_corrupt')}
      if(!wrongPasswordDenied)throw Error('wrong_password_accepted');
      process.send?.({result:'FRESH_PROCESS_RECOVERED',encrypted:true,
        single_flight:true,wrong_password_denied:true});
    }catch{
      process.send?.({result:'UNEXPECTED_RECOVERY_FAILURE'});
    }
  }
});
