#!/usr/bin/env node
import {isValidAddress} from '../../sovereign-forge/node/authoritative/address.mjs';
import {buildSignedTransaction,deriveRecords,newMnemonic,NETWORK,parseAtoms} from './crypto.mjs';
import {unlockVault,writeVault} from './vault.mjs';

const HELP='FAE Sovereign Wallet (Node 22+)\n'+
  'Commands: create | recover | address | receive | balance | send | history | status\n'+
  'Public options: --vault PATH --node URL --index 0..4 --watch faet1...\n'+
  'Send options: --to faet1... --amount DECIMAL [--fee DECIMAL]\n'+
  'Secrets are accepted ONLY through an interactive no-echo TTY; never via args/env.\n'+
  'No public network default: --node defaults to 127.0.0.1:8787.\n';
const DEFAULT_NODE='http://127.0.0.1:8787';

export function parseCli(argv){
  const [cmd,...tokens]=argv;
  const allowed=new Set(['--vault','--node','--index','--watch','--to','--amount','--fee']);
  const opt={};
  for(let i=0;i<tokens.length;i+=2){
    const key=tokens[i];
    if(!allowed.has(key)||i+1===tokens.length||opt[key]!==undefined)throw Error('invalid_or_duplicate_option');
    opt[key]=tokens[i+1];
  }
  if(!['create','recover','address','receive','balance','send','history','status','help'].includes(cmd))throw Error('unknown_command');
  if(opt['--index']!==undefined&&!/^[0-4]$/.test(opt['--index']))throw Error('index_must_be_0_to_4');
  if(opt['--watch']!==undefined&&!isValidAddress(opt['--watch']))throw Error('invalid_watch_address');
  if(opt['--watch']&&['create','recover','send'].includes(cmd))throw Error('watch_only_cannot_create_recover_or_send');
  if(cmd==='send'&&(!opt['--amount']||!isValidAddress(opt['--to'])))throw Error('send_requires_amount_and_valid_address');
  return{cmd,opt,idx:Number(opt['--index']||0),vault:opt['--vault']||'./fae-wallet.vault.json'};
}
export function normalizeNode(raw){
  const u=new URL(String(raw||DEFAULT_NODE));
  if(u.username||u.password||u.search||u.hash)throw Error('node_url_must_not_include_credentials_or_query');
  if(u.protocol!=='https:'&&!(u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)))throw Error('remote_node_must_use_https');
  return u.href.replace(/\/$/,'');
}
export async function nodeRequest(base,path,method='GET',body=null){
  const response=await fetch(base+path,{method,headers:{'content-type':'application/json'},
    ...(body===null?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(10000)});
  const value=await response.json().catch(()=>null);
  if(!response.ok||value?.ok===false)throw Error('node_rejected_request:'+String(value?.error||value?.reason||response.status));
  if(!value||typeof value!=='object')throw Error('node_response_invalid');
  return value;
}
// A transport error after POST cannot establish that the node did NOT accept
// the transaction. Keep the deterministic local TXID and NEVER auto-resubmit.
export async function submitSignedWithReceipt(base,tx,txid,feeAtoms){
  try{
    const receipt=await nodeRequest(base,'/submit-tx','POST',{tx});
    if(receipt.txid!==txid||String(receipt.fee_atoms)!==String(feeAtoms)){
      return{state:'submission_outcome_unknown',txid,
        reason:'node_receipt_mismatch',next_action:'check_selected_node_history_before_manual_retry'};
    }
    return{state:'accepted_unconfirmed',txid,fee_atoms:String(feeAtoms),
      confirmation:'NOT_CONFIRMED_until_included_in_a_valid_block'};
  }catch(error){
    const message=String(error?.message||error);
    // Explicit validation failures are definitive rejections, except a
    // duplicate TXID may be an earlier successful POST with a lost reply.
    if(message.startsWith('node_rejected_request:')&&!message.includes('duplicate_txid'))throw error;
    return{state:'submission_outcome_unknown',txid,
      reason:'receipt_lost_or_duplicate_unknown',
      next_action:'check_selected_node_history_before_manual_retry'};
  }
}

export async function statusForNode(base){
  const status=await nodeRequest(base,'/status');
  if(status.network!==NETWORK)throw Error('wrong_node_network');
  if(!Number.isSafeInteger(status.height)||status.height<0||!/^[0-9a-f]{64}$/.test(status.tip_hash))throw Error('invalid_node_tip');
  return status;
}
export function assertSameNodeTip(before,after){
  if(before.height!==after.height||before.tip_hash!==after.tip_hash)
    throw Error('node_tip_changed_during_read');
}
export async function outputsForNode(base,address){
  const firstTip=await statusForNode(base);
  const view=await nodeRequest(base,'/balance?address='+encodeURIComponent(address));
  if(view.address!==address||!(/^\d+$/.test(String(view.balance_atoms)))||!Array.isArray(view.utxos))throw Error('node_balance_inconsistent');
  const seen=new Set();
  for(const item of view.utxos){
    if(typeof item.outpoint!=='string'||seen.has(item.outpoint)||!/^\d+$/.test(String(item.amount_atoms))||BigInt(item.amount_atoms)<=0n)throw Error('node_utxo_inconsistent');
    seen.add(item.outpoint);
  }
  assertSameNodeTip(firstTip,await statusForNode(base));
  return {...view,observed_tip:firstTip};
}
export async function historyForNode(base,address,view){
  if(!view.observed_tip)throw Error('missing_verified_node_tip');
  try{
    const history=await nodeRequest(base,'/transactions?address='+encodeURIComponent(address));
    if(!Array.isArray(history.transactions))throw Error('invalid_transaction_history');
    assertSameNodeTip(view.observed_tip,await statusForNode(base));
    const rows=history.transactions.map(tx=>{
      const height=tx.confirmed_height;
      const status=tx.status==='confirmed'&&Number.isSafeInteger(Number(height))&&Number(height)>0
        ?'confirmed':tx.status==='pending'&&height==null?'pending':'unknown_or_reorganized';
      return{txid:tx.txid,state:status,confirmed_height:status==='confirmed'?height:null};
    });
    return{address,node:base,coverage:'recent_node_reported_transfers_not_full_history',
      provenance:'selected_node_untrusted_until_independently_synced',transactions:rows};
  }catch(err){
    if(!/node_rejected_request:(404|not_found)/.test(err.message))throw err;
  }
  assertSameNodeTip(view.observed_tip,await statusForNode(base));
  return{address,node:base,coverage:'unspent_outputs_only_not_transaction_history',
    status:'partial',confirmed_outputs:view.utxos.filter(x=>x.source==='confirmed'),
    pending_outputs:view.utxos.filter(x=>x.source==='pending'),reorg_history:'unavailable_without_indexed_node_history'};
}

export function planSpend(utxos,from,to,amount,fee=0n){
  if(!isValidAddress(from)||!isValidAddress(to)||amount<=0n||fee<0n)throw Error('invalid_payment');
  const inputs=[];let total=0n;
  for(const o of utxos){
    if(o.source!=='confirmed')continue;
    inputs.push(o.outpoint);total+=BigInt(o.amount_atoms);
    if(total>=amount+fee)break;
    if(inputs.length>64)throw Error('too_many_inputs');
  }
  if(total<amount+fee)throw Error('insufficient_confirmed_inputs');
  if(inputs.length>64)throw Error('too_many_inputs');
  const outputs=[{address:to,amount_atoms:String(amount)}];
  if(total>amount+fee)outputs.push({address:from,amount_atoms:String(total-amount-fee)});
  return{inputs,outputs,fee_atoms:String(fee)};
}
async function secretPrompt(label){
  if(!process.stdin.isTTY||!process.stderr.isTTY||typeof process.stdin.setRawMode!=='function')throw Error('interactive_tty_required_for_secrets');
  const stdin=process.stdin,prior=stdin.isRaw;
  return await new Promise((resolve,reject)=>{
    const bytes=[];
    const finish=(err)=>{
      stdin.removeListener('data',handle);
      stdin.setRawMode(prior||false);
      stdin.pause();
      process.stderr.write('\n');
      if(err){reject(err);return}
      try{resolve(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(bytes)));}
      catch{reject(Error('invalid_secret_utf8'))}
    };
    function handle(data){
      for(const byte of data){
        if(byte===3||byte===4){finish(Error('cancelled'));return}
        if(byte===10||byte===13){finish();return}
        if(byte===127||byte===8){
          if(bytes.length){
            bytes.pop();
            while(bytes.length&&(bytes.at(-1)&0xc0)===0x80)bytes.pop();
          }
          continue;
        }
        if(byte<32)continue;
        if(bytes.length>=2048){finish(Error('secret_input_too_long'));return}
        bytes.push(byte);
      }
    }
    // Enter no-echo mode BEFORE publishing the prompt: otherwise a fast
    // terminal/pseudoterminal responder can echo recovery words in the gap.
    stdin.setRawMode(true);stdin.resume();stdin.on('data',handle);
    process.stderr.write(label);
  });
}
async function passwordPrompt({confirm=false}={}){
  const password=await secretPrompt('Vault password (hidden): ');
  if(password.length<12)throw Error('vault_password_minimum_12_characters');
  if(confirm){const again=await secretPrompt('Repeat vault password (hidden): ');if(password!==again)throw Error('passwords_do_not_match')}
  return password;
}
function present(value){process.stdout.write(JSON.stringify(value)+'\n')}
async function main(argv){
  const {cmd,opt,idx,vault}=parseCli(argv);
  if(cmd==='help'){process.stdout.write(HELP);return}
  if(cmd==='create'||cmd==='recover'){
    if(!process.stdin.isTTY||!process.stdout.isTTY)throw Error('interactive_tty_required_for_wallet_creation');
    const mnemonic=cmd==='create'?newMnemonic():await secretPrompt('24-word recovery phrase (hidden): ');
    const passphrase=await secretPrompt('FAE derivation passphrase (optional, hidden): ');
    // Verify mnemonic and mapping BEFORE allocating any vault file.
    deriveRecords(mnemonic,passphrase);
    const password=await passwordPrompt({confirm:true});
    const addresses=await writeVault(vault,mnemonic,passphrase,password);
    if(cmd==='create')process.stdout.write('\nRECOVERY PHRASE — write offline, never photograph/share:\n'+mnemonic+'\n\n');
    present({ok:true,action:cmd,vault,addresses:addresses.map(x=>x.address),encrypted:true});
    return;
  }
  const base=normalizeNode(opt['--node']);
  if(cmd==='status'){present({node:base,...(await statusForNode(base))});return}
  // Metadata stored beside ciphertext is not independently authenticated.
  // Never display or use a saved receive address until its encrypted recovery
  // material is unlocked and re-derived. Explicit --watch is public-only.
  let unlocked=null;
  if(!opt['--watch']){
    const password=await passwordPrompt();
    unlocked=await unlockVault(vault,password);
  }
  const address=opt['--watch']||unlocked[idx].address;
  if(cmd==='address'||cmd==='receive'){present({network:NETWORK,address,watch_only:Boolean(opt['--watch'])});return}
  const view=await outputsForNode(base,address);
  if(cmd==='balance'){present({address,confirmed_balance_atoms:view.balance_atoms,
    available_confirmed_utxos:view.utxos.filter(x=>x.source==='confirmed'),node:base});return}
  if(cmd==='history'){present(await historyForNode(base,address,view));return}
  if(cmd==='send'){
    if(opt['--watch'])throw Error('watch_only_cannot_sign');
    const amount=parseAtoms(opt['--amount']);
    const fee=opt['--fee']===undefined?0n:parseAtoms(opt['--fee']);
    let spendable=view.utxos;
    if(!spendable.some(o=>o.source==='confirmed')){
      try{
        const candidate=await nodeRequest(base,'/spendable?address='+encodeURIComponent(address));
        if(candidate.address!==address||!Array.isArray(candidate.utxos))throw Error('node_spendable_inconsistent');
        spendable=candidate.utxos;
      }catch(err){if(!/node_rejected_request:(404|not_found)/.test(err.message))throw err}
    }
    const plan=planSpend(spendable,address,opt['--to'],amount,fee);
    // Reject a reorg observed between UTXO selection and signing. This does
    // not replace the node's authoritative validation at POST admission.
    assertSameNodeTip(view.observed_tip,await statusForNode(base));
    const record=unlocked[idx];
    if(record.address!==address)throw Error('vault_identity_mismatch');
    const {tx,txid}=buildSignedTransaction(record,plan.inputs,plan.outputs);
    const result=await submitSignedWithReceipt(base,tx,txid,plan.fee_atoms);
    present({...result,address,amount_atoms:String(amount),node:base});
    if(result.state==='submission_outcome_unknown')process.exitCode=2;
    return;
  }
}
const invoked=process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href;
if(invoked)main(process.argv.slice(2)).catch(err=>{process.stderr.write('FAE wallet error: '+err.message+'\n');process.exitCode=1});
