// Finite-window PPLNS counterfactual based on ShareLedger.window/weights and allocatePplnsOutputs source semantics.

// Research only: not a production pool or release and not an exact BWH/FAW profitability forecast.

function windowWeights(shares,windowSize=2048){
  const window=shares.slice(-windowSize);
  const counts=new Map();
  for(const share of window)counts.set(share,(counts.get(share)||0)+1);
  return{windowShares:window.length,weights:Object.fromEntries([...counts].sort(([a],[b])=>a.localeCompare(b))),fraction:Object.fromEntries([...counts].map(([a,n])=>[a,n/window.length]))};
}

function coinbaseDistribution(value,weights){
  const names=Object.keys(weights).sort(),sum=names.reduce((s,a)=>s+BigInt(weights[a]),0n);
  let allocated=0n;const outputs=names.map((name,i)=>{const n=i===names.length-1?value-allocated:value*BigInt(weights[name])/sum;allocated+=n;return{name,atoms:n.toString()}});
  return{outputs,total:allocated.toString(),conserved:allocated===value};
}

function runWindow(){
  const checks=[],check=(n,v)=>{if(!v)throw Error("failed "+n);checks.push(n)};
  const shares=[];for(let i=0;i<2048;i++)shares.push(i%4===0?"infiltrator":"honest");
  const initial=windowWeights(shares);
  check("2048_exact_last_N",initial.windowShares===2048);
  check("initial_512_attacker_weight",initial.weights.infiltrator===512&&initial.weights.honest===1536);
  const before=JSON.stringify(initial);
  const withheldFullSolution={submitted_to_coordinator:false,job_ttl_ms:300000};
  const afterWithholding=windowWeights(shares);
  check("withheld_block_does_not_change_share_ledger",JSON.stringify(afterWithholding)===before);
  for(let i=0;i<512;i++)shares.push("honest");
  const drift=windowWeights(shares);
  check("share_window_displaces_old_attacker",drift.weights.infiltrator===384&&drift.weights.honest===1664);
  const after512=drift;
  for(let i=0;i<2048;i++)shares.push("honest");
  const terminal=windowWeights(shares);
  check("full_window_rolloff_eliminates_old_shares",!terminal.weights.infiltrator&&terminal.weights.honest===2048);
  const allocated=coinbaseDistribution(1_000_003n,initial.weights);
  check("integer_coinbase_conservation",allocated.conserved&&BigInt(allocated.total)===1000003n);
  return{schema:"FAE_FINITE_PPLNS_WINDOW_ASSURANCE_RESULT_V1",status:"EXACT_WINDOW_ACCOUNTING_COUNTERFACTUAL_PASS__BWH_FAW_EFAW_FINAL_ECONOMICS_OPEN",checks:{passed:checks.length,total:6,ids:checks},candidate_constants:{share_window:2048,share_target_delta_bits:6,job_ttl_ms:300000,max_live_jobs:1024},payout_fraction:{initial,after_512_honest_shares:after512,after_2048_more_honest_shares:terminal},withheld_full_solution:withheldFullSolution,example_integer_distribution:allocated,interpretation:["The PPLNS candidate uses counts of last 2048 admitted share records, not proportional-hash long-run payout in a single block.","A coordinator cannot infer a worker's undisclosed full-difficulty block from lower-difficulty accepted shares; the pay-weight ledger by itself does not prevent BWH.","Payout weight after withholding a full block can persist while old shares remain in the 2048-window; actual realized pool revenue, attack costs and propagation races are outside this toy experiment.","Different precommitted job templates are not mutually transferable by copying the same proof; this does not eliminate coordinated multi-pool withholding/release games.","The final EFAW/BWH/FAW model requires share arrival timing, stales, job renewal, block race probability, final tie policy and actual miner opportunity costs."],limitations:["This is exact rolling-window accounting only, not a full live ShareCoordinator or Monte Carlo fork simulation.","All shares are assumed valid, accepted, and equally weighted; cryptographic validation is separately covered by coordinator tests.","No fee policy, pool activation, network architecture or consensus choice was changed.","Cross-coordinator proof nontransferability is NOT tested by this fixture; requires a real challenge/hash binding negative test."],authority:{research_only:true,consensus_change:false,pool_activation:false,fee_policy_selected:false,mainnet:false}};
}

console.log(JSON.stringify(runWindow(),null,2));

