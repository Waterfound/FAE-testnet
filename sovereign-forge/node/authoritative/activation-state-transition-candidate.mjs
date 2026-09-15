import {
  acceptTxInto,
  balanceAtoms,
  spendableOutputs,
  verifyTxCrypto
} from './fae-v4-core.mjs';

export const ACTIVATION_STATE_TRANSITION_STATUS='candidate-not-active-consensus';
export const DEFAULT_COINBASE_MATURITY_BLOCKS=200;

function integer(value,label,{min=0}={}){
  const n=Number(value);
  if(!Number.isSafeInteger(n)||n<min)throw new Error(`${label}_invalid`);
  return n;
}
function atom(value,label='amount_atoms'){
  const s=String(value??'');
  if(!/^\d+$/.test(s))throw new Error(`${label}_invalid`);
  return BigInt(s);
}

export function freezeStateTransitionPolicy({activationHeight,coinbaseMaturityBlocks=DEFAULT_COINBASE_MATURITY_BLOCKS}={}){
  const activation=integer(activationHeight,'activation_height',{min:2});
  const maturity=integer(coinbaseMaturityBlocks,'coinbase_maturity_blocks',{min:1});
  return Object.freeze({
    status:ACTIVATION_STATE_TRANSITION_STATUS,
    activation_height:activation,
    coinbase_maturity_blocks:maturity
  });
}

function assertPolicy(policy){
  if(!policy||policy.status!==ACTIVATION_STATE_TRANSITION_STATUS)throw new Error('state_transition_policy_required');
  integer(policy.activation_height,'activation_height',{min:2});
  integer(policy.coinbase_maturity_blocks,'coinbase_maturity_blocks',{min:1});
  return policy;
}

export function coinbaseOutpointIndex(state){
  if(!state||!Array.isArray(state.chain))throw new Error('state_chain_required');
  const index=new Map();
  for(const block of state.chain){
    const height=integer(block?.height,'coinbase_height',{min:1});
    const hash=String(block?.hash??'');
    if(!/^[0-9a-f]{64}$/.test(hash))throw new Error('coinbase_block_hash_invalid');
    const outputs=Array.isArray(block.coinbase_outputs)&&block.coinbase_outputs.length>0?block.coinbase_outputs.length:1;
    for(let outputIndex=0;outputIndex<outputs;outputIndex++)index.set(`${hash}:${outputIndex}`,{height,hash,output_index:outputIndex});
  }
  return index;
}

export function coinbaseMaturityVerdict(state,outpoint,{spendHeight,policy}={}){
  const p=assertPolicy(policy);
  const height=integer(spendHeight,'spend_height',{min:1});
  const key=String(outpoint??'');
  const coinbase=coinbaseOutpointIndex(state).get(key);
  if(!coinbase)return{ok:true,is_coinbase:false,spend_height:height};
  const confirmationsBeforeSpend=height-coinbase.height;
  const required=p.coinbase_maturity_blocks;
  return {
    ok:confirmationsBeforeSpend>=required,
    is_coinbase:true,
    created_height:coinbase.height,
    spend_height:height,
    confirmations_before_spend:confirmationsBeforeSpend,
    required_maturity_blocks:required,
    ...(confirmationsBeforeSpend>=required?{}:{error:'immature_coinbase'})
  };
}

export function spendableOutputsWithMaturity(state,address,{policy,spendHeight=(state?.chain?.length??0)+1}={}){
  assertPolicy(policy);
  const rows=spendableOutputs(state,address);
  return rows.filter(row=>{
    if(row.source!=='confirmed')return true;
    return coinbaseMaturityVerdict(state,row.outpoint,{spendHeight,policy}).ok;
  });
}

export function walletViewWithMaturity(state,address,{policy,spendHeight=(state?.chain?.length??0)+1}={}){
  assertPolicy(policy);
  const all=spendableOutputs(state,address);
  const spendable=spendableOutputsWithMaturity(state,address,{policy,spendHeight});
  const spendableSet=new Set(spendable.map(row=>row.outpoint));
  let confirmedSpendable=0n,pendingSpendable=0n,immatureCoinbase=0n;
  for(const row of spendable){
    const amount=atom(row.amount_atoms);
    if(row.source==='confirmed')confirmedSpendable+=amount;
    else pendingSpendable+=amount;
  }
  for(const row of all){
    if(row.source!=='confirmed'||spendableSet.has(row.outpoint))continue;
    const verdict=coinbaseMaturityVerdict(state,row.outpoint,{spendHeight,policy});
    if(verdict.is_coinbase&&!verdict.ok)immatureCoinbase+=atom(row.amount_atoms);
  }
  return Object.freeze({
    status:ACTIVATION_STATE_TRANSITION_STATUS,
    address:String(address),
    spend_height:Number(spendHeight),
    confirmed_balance_atoms:balanceAtoms(state,address).toString(),
    confirmed_spendable_atoms:confirmedSpendable.toString(),
    pending_spendable_atoms:pendingSpendable.toString(),
    immature_coinbase_atoms:immatureCoinbase.toString(),
    spendable_outputs:spendable.map(row=>structuredClone(row))
  });
}

export function acceptTxIntoWithMaturity(state,raw,{policy,fromFeed=false,spendHeight=(state?.chain?.length??0)+1}={}){
  assertPolicy(policy);
  const verified=verifyTxCrypto(raw);
  if(!verified.ok)throw Object.assign(new Error(verified.error),{code:verified.error});
  for(const outpoint of verified.tx.inputs){
    const verdict=coinbaseMaturityVerdict(state,outpoint,{spendHeight,policy});
    if(!verdict.ok)throw Object.assign(new Error('immature_coinbase'),{code:'immature_coinbase',outpoint,verdict});
  }
  return acceptTxInto(state,raw,{fromFeed});
}

function detachedOrder(a,b){
  const ah=a.confirmed_height===null||a.confirmed_height===undefined?Number.MAX_SAFE_INTEGER:Number(a.confirmed_height);
  const bh=b.confirmed_height===null||b.confirmed_height===undefined?Number.MAX_SAFE_INTEGER:Number(b.confirmed_height);
  if(ah!==bh)return ah-bh;
  const as=Number(a.mempool_seq||0),bs=Number(b.mempool_seq||0);
  if(as!==bs)return as-bs;
  return String(a.txid).localeCompare(String(b.txid));
}
function rawDetached(record){
  return {
    version:2,
    network:String(record.network),
    inputs:[...(record.inputs||[])],
    outputs:(record.outputs||[]).map(output=>({address:String(output.address),amount_atoms:String(output.amount_atoms)})),
    public_key_spki:String(record.public_key_spki),
    signature:String(record.signature),
    txid:String(record.txid),
    from_address:String(record.from_address),
    mempool_seq:Number(record.mempool_seq||0),
    created_at:record.created_at
  };
}

export function reconcileDetachedTransactionsWithMaturity(candidate,previous,{policy,spendHeight=(candidate?.chain?.length??0)+1}={}){
  assertPolicy(policy);
  if(!candidate?.transactions||!previous?.transactions)throw new Error('state_transactions_required');
  const detached=Object.values(previous.transactions)
    .filter(record=>record&&record.txid&&!candidate.transactions[record.txid])
    .sort(detachedOrder);
  const waiting=new Map(detached.map(record=>[String(record.txid),record]));
  const reacceptedRecords=[];
  const rejectedRecords=[];
  let progress=true;
  while(progress&&waiting.size){
    progress=false;
    for(const[txid,record]of[...waiting.entries()]){
      try{
        acceptTxIntoWithMaturity(candidate,rawDetached(record),{policy,fromFeed:true,spendHeight});
        waiting.delete(txid);
        reacceptedRecords.push(candidate.transactions[txid]);
        progress=true;
      }catch(error){
        const code=String(error.code||error.message);
        if(code==='missing_or_spent_input')continue;
        waiting.delete(txid);
        rejectedRecords.push({txid,error:code});
      }
    }
  }
  for(const[txid]of waiting)rejectedRecords.push({txid,error:'missing_or_spent_input'});
  return {
    status:ACTIVATION_STATE_TRANSITION_STATUS,
    state:candidate,
    reacceptedRecords,
    rejectedRecords,
    rejected:rejectedRecords.length
  };
}
