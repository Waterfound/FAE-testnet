// Bounded opportunity-cost thought experiment, not a final selfish-mining payoff model.

function simpson(alpha,n=4096){
  if(n%2)throw Error("n must even");
  const f=u=>(1-u)*alpha*u/(1-alpha+alpha*u);
  let acc=f(0)+f(1);for(let i=1;i<n;i++)acc+=(i%2?4:2)*f(i/n);
  return acc/(3*n);
}

function runTie(){
  const cells=[];
  for(const alpha of[0,0.05,0.10,0.20,0.30,0.35,0.45]){
    const incr=simpson(alpha);
    cells.push({attacker_hash_fraction:alpha,base_single_candidate_tie_win_probability:0.5,grind_before_honest_extension_additional_win_probability:Number(incr.toFixed(8)),grind_total_win_probability:Number((0.5+incr).toFixed(8)),attacker_extension_before_honest_extension_probability:alpha});
  }
  const fixed=[];
  for(const k of[1,2,3,4,8,16])fixed.push({number_of_attack_valid_candidates:k,win_probability:k/(k+1),win_probability_per_expected_valid_candidate:(k/(k+1))/k});
  if(cells[0].grind_total_win_probability!==0.5)throw Error("zero attacker bound");
  if(!cells.every((x,i,a)=>i===0||x.grind_total_win_probability>=a[i-1].grind_total_win_probability))throw Error("nonmonotone");
  if(!fixed.every((x,i,a)=>i===0||x.win_probability_per_expected_valid_candidate<a[i-1].win_probability_per_expected_valid_candidate))throw Error("cost");
  return{schema:"FAE_EQUAL_WORK_TIE_OPPORTUNITY_COST_RESULT_V1",status:"BOUNDED_QUANTITATIVE_CANDIDATE__FINAL_STRATEGIC_PROFITABILITY_OPEN",tests:3,model:{single_honest_tip_hash:"independent uniform continuous rank",valid_attacker_candidate_hashes:"independent uniform ranks",competing_first_honest_extension:"Poisson rate 1-alpha, attacker grinding Poisson rate alpha",grind_opportunity:"attacker uses hash to search same-height candidate, not to extend chain",formula:"P(initial wins) + integral_0^1 (1-u)*alpha*u/(1-alpha+alpha*u) du",caveat:"The first-honest-extension stopping rule and zero network delay are an assumption; direct extension payoff and time-to-finality differ from this conditional win metric."},fixed_k_work_cost_sensitivity:fixed,extension_hazard_competition:cells,interpretation:["Lexicographic tie advantage increases with repeated valid candidate work, but not for free.","Fixed-k probability is NOT a profitability measure; probability normalized per discovery declines.","Race-constrained advantage cannot be equated to net revenue: extending the chain, propagation, private lead, stochastic block times and network tie reachability are excluded.","Strict-greater-work-only remains a tested non-persistent counterfactual, not a consensus choice."],authority:{research_only:true,consensus_change:false,selected_tie_policy:false,mainnet:false}};
}

console.log(JSON.stringify(runTie(),null,2));

