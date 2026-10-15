// Isolated counterfactual. Does not modify active FAE mempool or fee/consensus policy.

// Mirrors the 4096-entry and 16 KiB candidate ceilings; abstract inputs are preverified.

function evictSet(pool,root){
  const ids=new Set([root]);let changed=true;
  while(changed){changed=false;for(const tx of pool.values())if(!ids.has(tx.id)&&tx.parents.some(p=>ids.has(p))){ids.add(tx.id);changed=true}}
  return ids;
}

function candidateAdmission(pool,incoming,{cap=4096,maxBytes=16384,minFeeIncrement=1n}={}){
  const before=pool.size;
  if(pool.has(incoming.id))return{status:"reject",reason:"duplicate"};
  if(!Number.isInteger(incoming.bytes)||incoming.bytes<1||incoming.bytes>maxBytes)return{status:"reject",reason:"size"};
  if(typeof incoming.fee!=="bigint"||incoming.fee<0n)return{status:"reject",reason:"fee"};
  if(!Array.isArray(incoming.parents)||incoming.parents.some(p=>!pool.has(p)))return{status:"reject",reason:"missing_parent"};
  if(pool.size<cap){pool.set(incoming.id,incoming);return{status:"admitted",evicted:[],size:pool.size}}
  let best=null;
  for(const root of pool.keys()){
    const ids=evictSet(pool,root);
    if(incoming.parents.some(p=>ids.has(p)))continue;
    let fee=0n,bytes=0;for(const id of ids){const tx=pool.get(id);fee+=tx.fee;bytes+=tx.bytes}
    const candidate={root,ids,fee,bytes};
    if(!best||candidate.fee*BigInt(best.bytes)<best.fee*BigInt(candidate.bytes)||
      (candidate.fee*BigInt(best.bytes)===best.fee*BigInt(candidate.bytes)&&
      (ids.size<best.ids.size||(ids.size===best.ids.size&&root<best.root))))best=candidate;
  }
  if(!best)return{status:"reject",reason:"no_safe_cluster"};
  if(incoming.fee<best.fee+minFeeIncrement||
    incoming.fee*BigInt(best.bytes)<=best.fee*BigInt(incoming.bytes))
    return{status:"reject",reason:"insufficient_fee_increase",lowestEvictionFeeAtoms:best.fee.toString()};
  const removed=[...best.ids].sort();
  for(const id of best.ids)pool.delete(id);
  pool.set(incoming.id,incoming);
  if(pool.size>cap)throw Error("capacity invariant");
  for(const tx of pool.values())if(tx.parents.some(p=>!pool.has(p)))throw Error("dangling descendant");
  return{status:"admitted",evicted:removed,size:pool.size,evictionFeeAtoms:best.fee.toString()};
}

function runMempool(){
  const tx=(id,fee=0n,parents=[],bytes=256)=>({id,fee,parents,bytes});
  const assertions=[];const check=(id,condition)=>{if(!condition)throw Error("FAIL "+id);assertions.push(id)};
  const full=new Map();for(let i=0;i<4096;i++)full.set("z"+i,tx("z"+i,0n,i?["z"+(i-1)]:[]));
  const result=candidateAdmission(full,tx("honest",1000000n));
  check("zero_fee_chain_exposes_admission",result.status==="admitted"&&result.evicted.length===1&&result.evicted[0]==="z4095"&&full.size===4096);
  check("no_dangling_dependencies",[...full.values()].every(t=>t.parents.every(p=>full.has(p))));
  const independent=new Map([["a",tx("a",1n)],["b",tx("b",10n)],["c",tx("c",100n)]]);
  const equal=candidateAdmission(independent,tx("equal",1n),{cap:3});
  check("equal_fee_rejected",equal.status==="reject"&&!independent.has("equal"));
  const low=candidateAdmission(independent,tx("low",0n),{cap:3});
  check("lower_fee_rejected",low.status==="reject"&&independent.size===3);
  const high=candidateAdmission(independent,tx("high",20n),{cap:3});
  check("higher_fee_in",high.status==="admitted"&&high.evicted[0]==="a");
  const dependent=new Map([["parent",tx("parent",1n)],["child",tx("child",100n,["parent"])],["cheap",tx("cheap",1n)]]);
  const ev=candidateAdmission(dependent,tx("new",10n,["parent"]),{cap:3});
  check("preserve_incoming_ancestor",ev.status==="admitted"&&dependent.has("parent")&&dependent.has("child")&&ev.evicted[0]==="cheap");
  const blocked=new Map([["p",tx("p",2n)],["c",tx("c",100n,["p"])]]);
  const lowVsPackage=candidateAdmission(blocked,tx("lowVsPackage",10n),{cap:2});
  check("descendant_package_aggregate",lowVsPackage.status==="reject"&&blocked.size===2);
  const bad=candidateAdmission(blocked,tx("bad",999n,[],16385),{cap:2});
  check("oversized_rejected_before_eviction",bad.status==="reject"&&blocked.size===2);
  const missing=candidateAdmission(blocked,tx("badparent",999n,["unknown"]),{cap:2});
  check("missing_parent_rejected_before_eviction",missing.status==="reject"&&blocked.size===2);
  return {schema:"FAE_MEMPOOL_ADMISSION_POLICY_COUNTERFACTUAL_RESULT_V1",status:"ISOLATED_POLICY_CANDIDATE_PASS__PRODUCTION_PATH_UNCHANGED",checks:{passed:assertions.length,total:9,ids:assertions},example:{scenario:"4096 zero-fee dependent transactions vs unrelated higher-fee signed transaction",baseline:"mempool_full (reproduced in node diagnostic)",candidate:result},source_semantics:{max_pending_transactions:4096,max_normalized_transaction_bytes:16384,fee_recorded_as_input_minus_outputs:true,actual_node_blocks_full_pool_before_validation:true},limitations:["Counterfactual only; no node, mempool, mining-template, networking or consensus mutations.","Records are abstract validated inputs; no signature verification, atom-exact production replay, adversarial hash/fanout benchmark, or P2P relay test.","Eviction requires atomic update of mempoolSpends, mempoolOutputs and transaction records plus reorg/restart deterministic replay; not implemented.","Fee priority for block template (currently FIFO) and incremental relay-fee pricing are unresolved.","Higher-fee admission is not economically final until fee/security-budget policy freeze."],authority:{research_only:true,merge:false,consensus_change:false,fee_policy_activated:false,release:false,mainnet:false}};
}

console.log(JSON.stringify(runMempool(),null,2));

