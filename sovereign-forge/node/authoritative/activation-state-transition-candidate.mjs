import {createHash} from 'node:crypto';
import {stableStringify} from './canonical.mjs';

export const ACTIVATION_STATE_TRANSITION_STATUS='candidate-not-active-consensus';
export const ACTIVATION_STATE_TRANSITION_FORMAT='FAE_ACTIVATION_STATE_TRANSITION_V1';
export const CANDIDATE_COINBASE_MATURITY_BLOCKS=200;

function integer(value,label){const n=Number(value);if(!Number.isSafeInteger(n))throw new Error(`${label}_must_be_safe_integer`);return n}
function positive(value,label){const n=integer(value,label);if(n<=0)throw new Error(`${label}_must_be_positive`);return n}
function nonnegative(value,label){const n=integer(value,label);if(n<0)throw new Error(`${label}_must_be_nonnegative`);return n}
function atoms(value,label='amount_atoms'){const s=String(value??'');if(!/^\d+$/.test(s))throw new Error(`${label}_must_be_nonnegative_integer`);return BigInt(s)}
function clone(value){return structuredClone(value)}
function digest(value){return createHash('sha256').update(stableStringify(value)).digest('hex')}
function txidOf(tx){const id=String(tx?.txid??'');if(!id||id.length>128)throw new Error('invalid_txid');return id}
function outpointOf(txid,index){return `${txid}:${index}`}
function coinbaseOutpoint(blockHash,index){return `${blockHash}:coinbase:${index}`}

export function freezeStateTransitionPolicy({activationHeight,legacyCoinbaseMaturityBlocks=0,candidateCoinbaseMaturityBlocks=CANDIDATE_COINBASE_MATURITY_BLOCKS}={}){
  return Object.freeze({
    status:ACTIVATION_STATE_TRANSITION_STATUS,
    activation_height:positive(activationHeight,'activation_height'),
    legacy_coinbase_maturity_blocks:nonnegative(legacyCoinbaseMaturityBlocks,'legacy_coinbase_maturity_blocks'),
    candidate_coinbase_maturity_blocks:positive(candidateCoinbaseMaturityBlocks,'candidate_coinbase_maturity_blocks')
  });
}

export function coinbaseMaturityForCreationHeight(createdHeight,policy){
  const h=positive(createdHeight,'created_height');if(!policy)throw new Error('transition_policy_required');
  return h<policy.activation_height?policy.legacy_coinbase_maturity_blocks:policy.candidate_coinbase_maturity_blocks;
}

export function emptyTransitionState(policy){
  if(!policy)throw new Error('transition_policy_required');
  return{format:ACTIVATION_STATE_TRANSITION_FORMAT,status:ACTIVATION_STATE_TRANSITION_STATUS,policy:clone(policy),height:0,tip_hash:null,utxos:{},transactions:{},blocks:[]};
}

function matureAtSpendHeight(utxo,spendHeight,policy){
  if(!utxo.coinbase)return true;
  const maturity=coinbaseMaturityForCreationHeight(utxo.created_height,policy);
  return spendHeight>=Number(utxo.created_height)+maturity;
}

function normalizeOutputs(outputs,label){
  if(!Array.isArray(outputs)||outputs.length<1)throw new Error(`${label}_outputs_required`);
  return outputs.map((output,index)=>{const address=String(output?.address??'');if(!address)throw new Error(`${label}_output_address_required`);const amount=atoms(output?.amount_atoms,`${label}_output_${index}`);if(amount<=0n)throw new Error(`${label}_output_must_be_positive`);return{address,amount_atoms:amount.toString()};});
}

function validateTxAgainstView(tx,{utxos,mempoolOutputs=null,reservedInputs=null,spendHeight,policy}){
  const txid=txidOf(tx),inputs=(tx.inputs||[]).map(String);if(inputs.length<1||new Set(inputs).size!==inputs.length)throw new Error(`invalid_inputs:${txid}`);
  const outputs=normalizeOutputs(tx.outputs,`tx_${txid}`);let inputSum=0n;
  for(const outpoint of inputs){
    if(reservedInputs?.has(outpoint))throw new Error(`input_reserved:${txid}:${outpoint}`);
    const u=utxos[outpoint]??mempoolOutputs?.[outpoint];if(!u||u.spent_by)throw new Error(`missing_or_spent_input:${txid}:${outpoint}`);
    if(u.coinbase&&!matureAtSpendHeight(u,spendHeight,policy))throw new Error(`immature_coinbase:${txid}:${outpoint}`);
    inputSum+=BigInt(u.amount_atoms);
  }
  let outputSum=0n;for(const output of outputs)outputSum+=BigInt(output.amount_atoms);if(outputSum>inputSum)throw new Error(`overspend:${txid}`);
  return{txid,inputs,outputs,fee_atoms:(inputSum-outputSum).toString()};
}

export function connectTransitionBlock(source,block,policy){
  const state=clone(source);if(!policy)throw new Error('transition_policy_required');
  const height=positive(block?.height,'block_height');if(height!==state.height+1)throw new Error('noncontiguous_block_height');
  const hash=String(block?.hash??'');if(!hash)throw new Error('block_hash_required');
  const coinbaseOutputs=normalizeOutputs(block?.coinbase_outputs,'coinbase');const txs=Array.isArray(block?.transactions)?block.transactions:[];
  const ids=new Set();for(const raw of txs){const id=txidOf(raw);if(ids.has(id)||state.transactions[id])throw new Error(`duplicate_txid:${id}`);ids.add(id)}
  for(const raw of txs){
    const tx=validateTxAgainstView(raw,{utxos:state.utxos,spendHeight:height,policy});
    for(const input of tx.inputs)state.utxos[input].spent_by=tx.txid;
    tx.outputs.forEach((output,index)=>{state.utxos[outpointOf(tx.txid,index)]={outpoint:outpointOf(tx.txid,index),address:output.address,amount_atoms:output.amount_atoms,created_height:height,coinbase:false,spent_by:null}});
    state.transactions[tx.txid]={...tx,status:'confirmed',confirmed_height:height};
  }
  coinbaseOutputs.forEach((output,index)=>{const outpoint=coinbaseOutpoint(hash,index);if(state.utxos[outpoint])throw new Error('duplicate_coinbase_outpoint');state.utxos[outpoint]={outpoint,address:output.address,amount_atoms:output.amount_atoms,created_height:height,coinbase:true,spent_by:null}});
  state.height=height;state.tip_hash=hash;state.blocks.push({height,hash,coinbase_outputs:coinbaseOutputs,transactions:txs.map(clone)});return state;
}

export function replayTransition(blocks,policy){
  if(!Array.isArray(blocks))throw new Error('blocks_required');let state=emptyTransitionState(policy);for(const block of blocks)state=connectTransitionBlock(state,block,policy);return state;
}

export function transitionStateDigest(state){
  const utxos=Object.values(state.utxos).sort((a,b)=>a.outpoint.localeCompare(b.outpoint));
  const transactions=Object.values(state.transactions).sort((a,b)=>a.txid.localeCompare(b.txid));
  return digest({format:state.format,status:state.status,policy:state.policy,height:state.height,tip_hash:state.tip_hash,utxos,transactions});
}

export function walletTransitionView(state,address,policy,{spendHeight=state.height+1}={}){
  const h=positive(spendHeight,'spend_height');let confirmed=0n,spendable=0n,immature=0n;const rows=[];
  for(const u of Object.values(state.utxos).sort((a,b)=>a.outpoint.localeCompare(b.outpoint))){if(u.address!==address||u.spent_by)continue;const amount=BigInt(u.amount_atoms);confirmed+=amount;const isSpendable=matureAtSpendHeight(u,h,policy);if(isSpendable)spendable+=amount;else immature+=amount;rows.push({...clone(u),spendable_at_height:h,is_spendable:isSpendable});}
  return{address,at_spend_height:h,confirmed_atoms:confirmed.toString(),spendable_atoms:spendable.toString(),immature_coinbase_atoms:immature.toString(),utxos:rows};
}

export function reconcileTransitionMempool(state,candidates,policy,{spendHeight=state.height+1}={}){
  if(!Array.isArray(candidates))throw new Error('mempool_candidates_required');const ordered=candidates.map((tx,index)=>({tx:clone(tx),seq:integer(tx?.mempool_seq??index+1,'mempool_seq')})).sort((a,b)=>a.seq-b.seq||txidOf(a.tx).localeCompare(txidOf(b.tx)));
  const reserved=new Set(),mempoolOutputs={};const accepted=[],dropped=[];const seen=new Set();
  for(const row of ordered){
    let id;try{id=txidOf(row.tx);if(seen.has(id))throw new Error(`duplicate_mempool_txid:${id}`);seen.add(id);const tx=validateTxAgainstView(row.tx,{utxos:state.utxos,mempoolOutputs,reservedInputs:reserved,spendHeight,policy});for(const input of tx.inputs)reserved.add(input);tx.outputs.forEach((output,index)=>{mempoolOutputs[outpointOf(tx.txid,index)]={outpoint:outpointOf(tx.txid,index),address:output.address,amount_atoms:output.amount_atoms,created_height:spendHeight,coinbase:false,spent_by:null}});accepted.push({...tx,mempool_seq:row.seq,status:'pending'});}catch(error){dropped.push({txid:id??String(row.tx?.txid??''),reason:error.message});}
  }
  return{accepted,dropped,reserved_inputs:[...reserved].sort(),mempool_outputs:mempoolOutputs};
}

export function reorgTransition({prefix,oldBranch,newBranch,existingMempool=[]},policy){
  if(!Array.isArray(prefix)||!Array.isArray(oldBranch)||!Array.isArray(newBranch))throw new Error('reorg_branches_required');
  const oldState=replayTransition([...prefix,...oldBranch],policy),newState=replayTransition([...prefix,...newBranch],policy);
  const disconnected=[];for(const block of oldBranch)for(const tx of block.transactions||[])if(!newState.transactions[txidOf(tx)])disconnected.push({...clone(tx),mempool_seq:integer(tx?.mempool_seq??disconnected.length+1,'mempool_seq')});
  const candidates=[...existingMempool.map(clone),...disconnected];const mempool=reconcileTransitionMempool(newState,candidates,policy,{spendHeight:newState.height+1});
  const reentered=new Set(mempool.accepted.map(tx=>tx.txid));return{status:ACTIVATION_STATE_TRANSITION_STATUS,old_digest:transitionStateDigest(oldState),new_digest:transitionStateDigest(newState),state:newState,mempool,disconnected_txids:disconnected.map(tx=>tx.txid),reentered_txids:disconnected.filter(tx=>reentered.has(tx.txid)).map(tx=>tx.txid)};
}
