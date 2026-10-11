/**
 * HPA-UC-001 / Element 2 — non-activating fee-aware admission rehearsal.
 * Uses actual FAE v4 signed transaction verification and a cloned state.
 * NEVER wire this into a live node without a separate security/economics gate.
 */
import {
  NETWORK, MAX_MEMPOOL_TXS, cloneState, acceptTxInto, verifyTxCrypto
} from '../../sovereign-forge/node/authoritative/fae-v4-core.mjs';
import {stableStringify} from '../../sovereign-forge/node/authoritative/canonical.mjs';

const size = tx => Buffer.byteLength(stableStringify({
  version:2, network:NETWORK, inputs:tx.inputs, outputs:tx.outputs,
  public_key_spki:tx.public_key_spki, signature:tx.signature
}), 'utf8');
const failure = (reason, detail) => ({status:'rejected', reason, ...(detail?{detail}:{}), state:null});
const outputOwner = (state, outpoint) => {
  const u=state.utxos[outpoint];
  if(u && !u.spent) return u;
  return state.mempoolOutputs[outpoint] || null;
};
function incomingFee(state, verified) {
  let inputs=0n, outputs=0n;
  for (const outpoint of verified.tx.inputs) {
    const o=outputOwner(state,outpoint);
    if (!o) throw Error('missing_or_spent_input');
    if (o.address!==verified.from) throw Error('input_not_owned');
    if (state.mempoolSpends[outpoint]) throw Error('input_reserved');
    inputs+=BigInt(o.amount_atoms);
  }
  for (const o of verified.tx.outputs) outputs+=BigInt(o.amount_atoms);
  if (outputs>inputs) throw Error('overspend');
  return inputs-outputs;
}
function dependencyIndex(state) {
  const pending=new Set(state.mempoolOrder);
  const children=new Map([...pending].map(id=>[id,new Set()]));
  for (const id of pending) {
    const rec=state.transactions[id];
    if (!rec || rec.status!=='pending') throw Error('unverified_mempool_record');
    for (const outpoint of rec.inputs) {
      const parent=state.mempoolOutputs[outpoint]?.txid;
      if(parent && pending.has(parent)) children.get(parent).add(id);
    }
  }
  return {pending,children};
}
function descendantClosure(root, children) {
  const result=new Set([root]), todo=[root];
  while(todo.length) for(const child of children.get(todo.pop())||[]) {
    if (!result.has(child)) {result.add(child);todo.push(child);}
  }
  return result;
}
function removeClosure(source, ids) {
  const shadow=cloneState(source);
  for(const id of ids) {
    const rec=shadow.transactions[id];
    if(!rec || rec.status!=='pending') throw Error('missing_eviction_record');
    for(const [idx] of rec.outputs.entries()) {
      const outpoint=id+':'+idx, child=shadow.mempoolSpends[outpoint];
      if(child && !ids.has(child)) throw Error('orphan_descendant');
    }
  }
  shadow.mempoolOrder=shadow.mempoolOrder.filter(id=>!ids.has(id));
  for(const id of ids) {
    const rec=shadow.transactions[id];
    for(const outpoint of rec.inputs) {
      if(shadow.mempoolSpends[outpoint]!==id) throw Error('inconsistent_spend_index');
      delete shadow.mempoolSpends[outpoint];
    }
    for(const [idx] of rec.outputs.entries()) delete shadow.mempoolOutputs[id+':'+idx];
    delete shadow.transactions[id];
  }
  return shadow;
}
function indexConsistent(state) {
  const live=new Set(state.mempoolOrder);
  if(live.size!==state.mempoolOrder.length || live.size>MAX_MEMPOOL_TXS) return false;
  for(const id of live){
    const rec=state.transactions[id];
    if(!rec || rec.status!=='pending')return false;
    for(const input of rec.inputs) if(state.mempoolSpends[input]!==id)return false;
    for(const [idx] of rec.outputs.entries()) if(!state.mempoolOutputs[id+':'+idx])return false;
  }
  for(const id of Object.values(state.mempoolSpends)) if(!live.has(id))return false;
  for(const output of Object.values(state.mempoolOutputs)) if(!live.has(output.txid))return false;
  return true;
}
function chooseEviction(state, verified, incomingFeeAtoms, minBump) {
  const {pending,children}=dependencyIndex(state);
  const protectedParents=new Set(verified.tx.inputs.map(x=>state.mempoolOutputs[x]?.txid).filter(Boolean));
  const incomingBytes=size(verified.tx);
  let best=null;
  for(const root of pending) {
    const ids=descendantClosure(root,children);
    if([...ids].some(id=>protectedParents.has(id)))continue;
    let fee=0n,bytes=0;
    for(const id of ids) {
      const rec=state.transactions[id];
      fee+=BigInt(rec.fee_atoms);
      bytes+=size(rec);
    }
    if(bytes===0 || incomingFeeAtoms<fee+minBump)continue;
    if(incomingFeeAtoms*BigInt(bytes)<=fee*BigInt(incomingBytes))continue;
    const proposed={root,ids,fee,bytes};
    if(!best || fee*BigInt(best.bytes)<best.fee*BigInt(bytes) ||
       (fee*BigInt(best.bytes)===best.fee*BigInt(bytes) &&
          (ids.size<best.ids.size || (ids.size===best.ids.size && root<best.root))))best=proposed;
  }
  return best;
}
/**
 * This is a defensive shadow rehearsal only. A signed incoming transaction
 * must pass FAE's real crypto verifier before any prospective eviction.
 * A fresh clone is admitted via the UNMODIFIED FAE core after eviction.
 */
export function trialFeeAwareAdmission(state,raw,{minimumFeeBumpAtoms=1n}={}) {
  if(typeof minimumFeeBumpAtoms!=='bigint'||minimumFeeBumpAtoms<1n)return failure('invalid_fee_policy');
  if(!indexConsistent(state))return failure('invalid_source_indexes');
  const verified=verifyTxCrypto(raw);
  if(!verified.ok)return failure(verified.error||'invalid_signature');
  if(raw.txid&&raw.txid!==verified.txid)return failure('txid_mismatch');
  if(raw.from_address&&raw.from_address!==verified.from)return failure('from_key_mismatch');
  if(state.transactions[verified.txid])return failure('duplicate_txid');
  let fee;
  try{fee=incomingFee(state,verified);}catch(e){return failure(e.message);}
  if(state.mempoolOrder.length<MAX_MEMPOOL_TXS){
    const candidate=cloneState(state);
    try{const accepted=acceptTxInto(candidate,raw);
      return{status:'admitted',state:candidate,txid:accepted.txid,evicted:[],fee_atoms:accepted.fee_atoms};
    }catch(e){return failure(e.code||e.message);}
  }
  let winner;
  try{winner=chooseEviction(state,verified,fee,minimumFeeBumpAtoms);}
  catch(e){return failure(e.message);}
  if(!winner)return failure('no_better_fee_package');
  try {
    const candidate=removeClosure(state,winner.ids);
    const accepted=acceptTxInto(candidate,raw);
    if(!indexConsistent(candidate))return failure('post_admission_index_inconsistent');
    return {status:'admitted',state:candidate,txid:accepted.txid,
      fee_atoms:accepted.fee_atoms,evicted:[...winner.ids].sort(),
      evicted_fee_atoms:winner.fee.toString(),evicted_bytes:winner.bytes};
  }catch(e){return failure(e.code||e.message);}
}
/**
 * A bounded preview of ancestor-aware fee-ordering. It does not replace the
 * active FIFO block-template rules, nor select a final relay/fee policy.
 */
export function candidateFeeOrderedTxids(state,{limit=20}={}) {
  if(!indexConsistent(state)) throw Error('invalid_source_indexes');
  if(!Number.isSafeInteger(limit)||limit<1||limit>4096)throw Error('invalid_template_limit');
  const pending=new Set(state.mempoolOrder),chosen=new Set(),out=[];
  const order=new Map(state.mempoolOrder.map((x,i)=>[x,i]));
  function packageFor(id,visiting=new Set(),seen=new Set()) {
    if(chosen.has(id)||seen.has(id))return [];
    if(visiting.has(id))throw Error('dependency_cycle');
    visiting.add(id);
    const rec=state.transactions[id],packageIds=[];
    for(const input of rec.inputs){
      const parent=state.mempoolOutputs[input]?.txid;
      if(parent&&pending.has(parent))packageIds.push(...packageFor(parent,visiting,seen));
    }
    visiting.delete(id);seen.add(id);packageIds.push(id);
    return packageIds;
  }
  while(out.length<limit){
    let best=null;
    for(const id of pending){
      if(chosen.has(id))continue;
      const ids=packageFor(id);
      if(out.length+ids.length>limit)continue;
      const fee=ids.reduce((n,x)=>n+BigInt(state.transactions[x].fee_atoms),0n);
      const bytes=ids.reduce((n,x)=>n+size(state.transactions[x]),0);
      if(bytes===0)continue;
      if(!best || fee*BigInt(best.bytes)>best.fee*BigInt(bytes) ||
        (fee*BigInt(best.bytes)===best.fee*BigInt(bytes) &&
        order.get(id)<order.get(best.id)))best={id,ids,fee,bytes};
    }
    if(!best)break;
    for(const id of best.ids){chosen.add(id);out.push(id);}
  }
  return out;
}
