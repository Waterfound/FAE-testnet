// V55 ISOLATED ORIGINAL-OWNER VAULT PROOF. NOT an admitted production signer.
// The worker creates its OWN disposable mnemonic and password INSIDE this OS
// process. Neither can be supplied by the renderer, parent IPC, CLI or env.
// The original Wallet #342 crypto/vault/outbox/coin-selector are imported unchanged.
import {randomBytes} from 'node:crypto';
import {join} from 'node:path';
import {newMnemonic,NETWORK,buildSignedTransaction} from '../../standalone/wallet/crypto.mjs';
import {writeVault,readVault,unlockVault} from '../../standalone/wallet/vault.mjs';
import {writeIntent,readIntent,intentPath} from '../../standalone/wallet/outbox.mjs';
import {planSpend} from '../../standalone/wallet/fae-wallet.mjs';
const MODE='TS_V55_ISOLATED_ORIGINAL_VAULT_ONLY';
const ADDRESS=/^faet1[023456789acdefghjklmnpqrstuvwxyz]{25,85}$/;
const DIGEST=/^[0-9a-f]{64}$/;
const ATOMS=/^(?:0|[1-9][0-9]*)$/;
const OUTPOINT=/^[0-9a-f]{64}:(?:0|[1-9][0-9]*)$/;
if(process.env.TS_V55_ISOLATED_VAULT_OWNER_PROOF!=='isolated-only'||
   typeof process.send!=='function')
  throw Error('Original protected Wallet signer not admitted');
let state='NEW',session=null,password=null,identity=null,vault=null;
const revoke=()=>{state='REVOKED';password=null;identity=null;};
const emit=packet=>{
  if(state==='REVOKED'||!process.connected)return;
  process.send(packet,error=>{if(error)revoke()});
};
function exact(value,names){
  return !!value&&typeof value==='object'&&!Array.isArray(value)&&
    Object.keys(value).sort().join(',')===names.slice().sort().join(',');
}
process.on('disconnect',revoke);
process.on('message',async packet=>{
  if(state==='REVOKED')return;
  // Requests are bounded; the same inherited IPC session cannot be replayed.
  try{
    if(!packet||Buffer.byteLength(JSON.stringify(packet),'utf8')>16384||
       packet.mode!==MODE||packet.network!==NETWORK||
       typeof packet.session!=='string'||!DIGEST.test(packet.session))
      throw Error('invalid_vault_owner_request');
    if(state==='NEW'){
      if(!exact(packet,['mode','network','session','request_id'])||
         packet.request_id!==1)throw Error('invalid_vault_initialization');
      state='PREPARING';session=packet.session;
      // This random disposable password exists only inside this child.
      // It intentionally cannot be recovered after the worker dies.
      password=randomBytes(32).toString('hex');
      vault=join(process.cwd(),'v55-isolated-original.vault.json');
      await writeVault(vault,newMnemonic(),'',password);
      const publicVault=await readVault(vault);
      const records=await unlockVault(vault,password);
      if(records.length!==5||
         records[0].address!==publicVault.public_addresses[0].address)
        throw Error('original_vault_public_identity_mismatch');
      try{await unlockVault(vault,'incorrect_disposable_password')}
      catch(error){
        if(!/incorrect_password_or_corrupt_vault/.test(error.message))throw error;
      }
      identity=records[0].address;
      state='READY';
      return emit({mode:MODE,network:NETWORK,session,request_id:1,
        status:'ORIGINAL_ENCRYPTED_VAULT_READY',from:identity});
    }
    if(state!=='READY'||packet.session!==session||packet.request_id!==2||
       !exact(packet,['mode','network','session','request_id','intent'])||
       !exact(packet.intent,['from','to','outpoint','source_atoms',
         'amount_atoms','fee_atoms','tip_height','tip_hash','node','authorization_id',
         'disposable_test_authorized']))
      throw Error('unapproved_or_replayed_wallet_intent');
    state='SIGNING'; // acquired BEFORE first await
    const intent=packet.intent;
    if(intent.disposable_test_authorized!==true||intent.from!==identity||
       typeof intent.to!=='string'||!ADDRESS.test(intent.to)||intent.to===identity||
       !OUTPOINT.test(intent.outpoint)||!DIGEST.test(intent.tip_hash)||
       !DIGEST.test(intent.authorization_id)||
       !Number.isSafeInteger(intent.tip_height)||intent.tip_height!==1||
       intent.source_atoms!=='1000000000'||
       intent.amount_atoms!=='100000000'||intent.fee_atoms!=='1'||
       typeof intent.node!=='string'||!/^http:\/\/127\.0\.0\.1:[0-9]{1,5}$/.test(intent.node))
      throw Error('invalid_immutable_original_wallet_intent');
    const records=await unlockVault(vault,password);
    const record=records[0];
    if(record.address!==identity)throw Error('original_wallet_vault_identity_changed');
    const plan=planSpend([{outpoint:intent.outpoint,
      address:identity,amount_atoms:intent.source_atoms,source:'confirmed',
      created_height:1}],identity,intent.to,100000000n,1n);
    if(plan.inputs.length!==1||plan.inputs[0]!==intent.outpoint||
       plan.outputs.length!==2||plan.outputs[0].address!==intent.to||
       plan.outputs[0].amount_atoms!=='100000000'||
       plan.outputs[1].address!==identity||
       plan.outputs[1].amount_atoms!=='899999999'||plan.fee_atoms!=='1')
      throw Error('original_wallet_coin_selection_mismatch');
    const {tx,txid}=buildSignedTransaction(record,plan.inputs,plan.outputs);
    // The original encrypted single-flight outbox is fsynced before any
    // signed transaction becomes available to the trusted parent.
    const journal=intentPath(vault);
    await writeIntent(journal,{network:NETWORK,txid,node:intent.node,
      address:identity,recipient:intent.to,
      amount_atoms:intent.amount_atoms,fee_atoms:intent.fee_atoms,
      tip_height:intent.tip_height,tip_hash:intent.tip_hash},password);
    const recovered=await readIntent(journal,password);
    if(recovered.txid!==txid||recovered.address!==identity||
       recovered.recipient!==intent.to||recovered.tip_hash!==intent.tip_hash)
      throw Error('original_encrypted_outbox_recovery_failed');
    password=null;
    state='SIGNED';
    emit({mode:MODE,network:NETWORK,session,request_id:2,
      status:'ORIGINAL_VAULT_SIGNED_OUTBOX_DURABLE',from:identity,to:intent.to,
      authorization_id:intent.authorization_id,tx,txid});
    // The worker never sends a second transaction and never submits itself.
  }catch{
    revoke();
    // No errors, password, mnemonic, key objects or filesystem contents over IPC.
    if(process.connected)process.disconnect();
  }
});
