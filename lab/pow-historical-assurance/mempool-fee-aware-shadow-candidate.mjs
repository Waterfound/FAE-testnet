/**
 * HPA-UC-001 / Element 2: ISOLATED fee-aware package-admission research.
 *
 * Runs entirely against a cloned FAE state. This is NOT a production mempool
 * policy, consensus rule, relay handler, block-template selector or deployment.
 * Fee/size comparison is a bounded research policy, pending final fee economics.
 */
import {acceptTxInto,cloneState,MAX_MEMPOOL_TXS,MAX_TXS_PER_BLOCK,normalizeTx,verifyTxCrypto} from '../../sovereign-forge/node/authoritative/fae-v4-core.mjs';
import {stableStringify} from '../../sovereign-forge/node/authoritative/canonical.mjs';

const fail=(code)=>{throw Object.assign(new Error(code),{code})};
const sizeOf=(rec)=>Buffer.byteLength(stableStringify(normalizeTx(rec)),'utf8');
const validFee=(rec)=>{
  if(rec?.status!=='pending'||!/^\d+$/.test(String(rec.fee_atoms)))fail('invalid_pending_fee');
  return BigInt(rec.fee_atoms);
};

/** Fail closed on an inconsistent source snapshot; never repair silently. */
export function assertPendingIndexes(state,{cap=MAX_MEMPOOL_TXS}={}){
  if(!Number.isSafeInteger(cap)||cap<1||cap>MAX_MEMPOOL_TXS)fail('invalid_cap');
  if(!Array.isArray(state.mempoolOrder)||state.mempoolOrder.length>cap)fail('invalid_mempool_order');
  const active=new Set(state.mempoolOrder);
  if(active.size!==state.mempoolOrder.length)fail('duplicate_mempool_order');
  for(const txid of active){
    const rec=state.transactions[txid];
    if(!rec||rec.txid!==txid||rec.status!=='pending')fail('invalid_pending_record');
    validFee(rec);
    for(const input of rec.inputs){
      if(state.mempoolSpends[input]!==txid)fail('missing_input_reservation');
      if(!state.utxos[input]&&!state.mempoolOutputs[input])fail('missing_input_source');
    }
    for(let j=0;j<rec.outputs.length;j++){
      const outpoint=txid+':'+j, indexed=state.mempoolOutputs[outpoint];
      if(!indexed||indexed.txid!==txid||String(indexed.amount_atoms)!==String(rec.outputs[j].amount_atoms)||indexed.address!==rec.outputs[j].address)fail('missing_pending_output');
    }
  }
  for(const [outpoint,id] of Object.entries(state.mempoolSpends)){
    if(!active.has(id)||!state.transactions[id].inputs.includes(outpoint))fail('orphan_reserved_input');
  }
  for(const [outpoint,output] of Object.entries(state.mempoolOutputs)){
    if(!active.has(output.txid)||!state.transactions[output.txid].outputs[output.output_index]||outpoint!==output.txid+':'+output.output_index)fail('orphan_pending_output');
  }
  return true;
}
function graph(state){
  const active=new Set(state.mempoolOrder),children=new Map(state.mempoolOrder.map(x=>[x,new Set()]));
  for(const id of state.mempoolOrder){
    const rec=state.transactions[id];
    for(const input of rec.inputs){
      const parent=state.mempoolOutputs[input]?.txid;
      if(parent&&active.has(parent))children.get(parent).add(id);
    }
  }
  return children;
}
function packageIds(root,children,{maxPackageSize}){
  const seen=new Set([root]),queue=[root];
  for(let i=0;i<queue.length;i++){
    for(const child of children.get(queue[i])||[]){
      if(seen.has(child))continue;
      seen.add(child);queue.push(child);
      if(seen.size>maxPackageSize)return null;
    }
  }
  return seen;
}
function compare(a,b){
  // Minimize evicted aggregate fee-rate first; avoid gratuitous eviction on ties.
  const density=a.fee*BigInt(b.bytes)-b.fee*BigInt(a.bytes);
  if(density!==0n)return density<0n?-1:1;
  if(a.fee!==b.fee)return a.fee<b.fee?-1:1;
  if(a.ids.size!==b.ids.size)return a.ids.size-b.ids.size;
  return a.root<b.root?-1:a.root>b.root?1:0;
}
/** For adversarial tests of descendant-closure and index integrity. */
export function removeDescendantPackageOnClone(source,roots,{cap=MAX_MEMPOOL_TXS,maxPackageSize=128}={}){
  assertPendingIndexes(source,{cap});
  if(!Array.isArray(roots)||!roots.length||roots.some(x=>!source.mempoolOrder.includes(x)))fail('invalid_package_roots');
  const children=graph(source),ids=new Set();
  for(const root of roots){
    const closure=packageIds(root,children,{maxPackageSize});
    if(!closure)fail('package_limit');
    for(const id of closure)ids.add(id);
    if(ids.size>maxPackageSize)fail('package_limit');
  }
  const cloned=cloneState(source);
  for(const id of ids){
    const rec=cloned.transactions[id];
    for(const outpoint of rec.inputs){
      if(cloned.mempoolSpends[outpoint]!==id)fail('spend_index_corrupt');
      delete cloned.mempoolSpends[outpoint];
    }
    for(let i=0;i<rec.outputs.length;i++){
      const outpoint=id+':'+i,spender=cloned.mempoolSpends[outpoint];
      if(spender&&!ids.has(spender))fail('descendant_not_closed');
      delete cloned.mempoolOutputs[outpoint];
    }
    delete cloned.transactions[id];
  }
  cloned.mempoolOrder=cloned.mempoolOrder.filter(id=>!ids.has(id));
  assertPendingIndexes(cloned,{cap});
  return {state:cloned,evicted:[...source.mempoolOrder].filter(id=>ids.has(id))};
}
/**
 * Bounded full-pool candidate on an isolated clone.
 * Incoming signature and source-owned inputs are checked before considering
 * any eviction. Candidate target uses the unchanged authoritative acceptTxInto.
 * Returns a new state; NEVER mutates source.
 */
export function simulateFeeAwareAdmission(source,raw,{
  cap=MAX_MEMPOOL_TXS,minFeeIncrementAtoms=1n,maxPackageSize=128
}={}){
  assertPendingIndexes(source,{cap});
  if(typeof minFeeIncrementAtoms!=='bigint'||minFeeIncrementAtoms<1n)fail('invalid_min_fee_increment');
  if(!Number.isSafeInteger(maxPackageSize)||maxPackageSize<1||maxPackageSize>cap)fail('invalid_package_limit');
  const verified=verifyTxCrypto(raw);
  if(!verified.ok)fail(verified.error);
  if(raw.txid&&raw.txid!==verified.txid)fail('txid_mismatch');
  if(raw.from_address&&raw.from_address!==verified.from)fail('from_key_mismatch');
  if(source.transactions[verified.txid])fail('duplicate_txid');
  let totalInput=0n;
  for(const outpoint of verified.tx.inputs){
    const u=(!source.utxos[outpoint]?.spent&&source.utxos[outpoint])||source.mempoolOutputs[outpoint];
    if(!u)fail('missing_or_spent_input');
    if(u.address!==verified.from)fail('input_not_owned');
    if(source.mempoolSpends[outpoint])fail('input_reserved');
    totalInput+=BigInt(u.amount_atoms);
  }
  const totalOutput=verified.tx.outputs.reduce((a,x)=>a+BigInt(x.amount_atoms),0n);
  if(totalOutput>totalInput)fail('overspend');
  const fee=totalInput-totalOutput,bytes=sizeOf(verified.tx);
  if(source.mempoolOrder.length<cap){
    const result=cloneState(source),record=acceptTxInto(result,raw);
    assertPendingIndexes(result,{cap});
    return {decision:'admitted_without_eviction',state:result,evicted:[],admitted:record.txid,fee_atoms:record.fee_atoms};
  }
  const children=graph(source);
  let best=null;
  for(const root of source.mempoolOrder){
    const ids=packageIds(root,children,{maxPackageSize});
    if(!ids)continue;
    let evictionFee=0n,evictionBytes=0;
    for(const id of ids){
      const rec=source.transactions[id];
      evictionFee+=validFee(rec);
      evictionBytes+=sizeOf(rec);
    }
    if(verified.tx.inputs.some(x=>ids.has(source.mempoolOutputs[x]?.txid)))continue;
    if(fee<evictionFee+minFeeIncrementAtoms)continue;
    if(fee*BigInt(evictionBytes)<=evictionFee*BigInt(bytes))continue;
    const candidate={root,ids,fee:evictionFee,bytes:evictionBytes};
    if(!best||compare(candidate,best)<0)best=candidate;
  }
  if(!best)fail('no_fee_qualified_eviction');
  const removed=removeDescendantPackageOnClone(source,[best.root],{cap,maxPackageSize});
  const record=acceptTxInto(removed.state,raw);
  assertPendingIndexes(removed.state,{cap});
  return {decision:'admitted_after_shadow_eviction',state:removed.state,
    evicted:removed.evicted,admitted:record.txid,fee_atoms:record.fee_atoms,
    evicted_fee_atoms:best.fee.toString(),evicted_bytes:best.bytes};
}

/**
 * Research-only ancestor-topological, fee-sensitive block selection.
 * Does not construct a block, touch consensus, sort a real node's mempool, or
 * select a production fee policy. Uses original pending validated records.
 */
export function selectFeeSensitiveTemplateCandidate(source,{limit=MAX_TXS_PER_BLOCK}={}){
  assertPendingIndexes(source);
  if(!Number.isSafeInteger(limit)||limit<1||limit>MAX_TXS_PER_BLOCK)fail('invalid_template_limit');
  const order=source.mempoolOrder,active=new Set(order),chosen=new Set(),txids=[];
  const parents=new Map();
  for(const id of order){
    const deps=new Set();
    for(const input of source.transactions[id].inputs){
      const parent=source.mempoolOutputs[input]?.txid;
      if(parent&&active.has(parent))deps.add(parent);
    }
    parents.set(id,deps);
  }
  function required(id){
    const path=new Set(),present=new Set(),out=[];
    function visit(current){
      if(chosen.has(current)||present.has(current))return;
      if(path.has(current))fail('cyclic_pending_dependency');
      path.add(current);
      for(const dep of parents.get(current)||[])visit(dep);
      path.delete(current);
      present.add(current);
      out.push(current);
    }
    visit(id);
    return out;
  }
  while(txids.length<limit&&chosen.size<active.size){
    let best=null;
    for(let i=0;i<order.length;i++){
      const id=order[i];if(chosen.has(id))continue;
      const pkg=required(id);
      if(pkg.length>limit-txids.length)continue;
      let fee=0n,bytes=0;
      for(const member of pkg){const rec=source.transactions[member];fee+=validFee(rec);bytes+=sizeOf(rec)}
      const candidate={id,pkg,fee,bytes,index:i};
      if(!best){best=candidate;continue}
      const d=candidate.fee*BigInt(best.bytes)-best.fee*BigInt(candidate.bytes);
      if(d>0n||(d===0n&&(candidate.fee>best.fee||
         (candidate.fee===best.fee&&candidate.index<best.index))))best=candidate;
    }
    if(!best)break;
    for(const id of best.pkg){if(chosen.has(id))fail('duplicate_candidate_template_tx');chosen.add(id);txids.push(id)}
  }
  let fee=0n;
  for(const id of txids)fee+=validFee(source.transactions[id]);
  const positions=new Map(txids.map((id,index)=>[id,index]));
  for(const id of txids)for(const parent of parents.get(id)||[]){
    if(!positions.has(parent)||positions.get(parent)>=positions.get(id))fail('template_dependency_not_topological');
  }
  return {template_policy:'FEE_SENSITIVE_SHADOW_ONLY',txids,fee_atoms:fee.toString(),
    transactions_considered:order.length,limit,source_state_mutated:false};
}
