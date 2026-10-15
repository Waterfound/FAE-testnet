// Defensive sensitivity model for unilateral BWH/FAW-style pool infiltration.
// Formula structure follows Kwon et al., "Be Selfish and Avoid Dilemmas"
// and the single-target presentation reproduced in the 2022 evaluation framework.
// This is not a proof that FAE's inactive PPLNS candidate has identical economics.

const alphas=[0.05,0.10,0.15,0.20,0.25,0.30,0.35];
const betas=[0.10,0.20,0.30,0.40];
const cs=[0,0.25,0.50,0.75,1.0];
const tauSteps=1000;

function revenue({alpha,beta,tau,c}){
  const infiltrating=tau*alpha;
  const effective=1-infiltrating;
  const poolDen=beta+infiltrating;
  if(effective<=0||poolDen<=0||alpha+beta>1)return null;
  const r1=((1-tau)*alpha)/effective;
  const r2=(beta/effective)*(infiltrating/poolDen);
  const outside=1-alpha-beta;
  const r3=c*infiltrating*(outside/effective)*(infiltrating/poolDen);
  return{r1,r2,r3,total:r1+r2+r3,relative_extra:(r1+r2+r3-alpha)/alpha};
}

const rows=[];
for(const alpha of alphas)for(const beta of betas){
  if(alpha+beta>=1)continue;
  for(const c of cs){
    let best={tau:0,...revenue({alpha,beta,tau:0,c})};
    for(let i=1;i<=tauSteps;i++){
      const tau=i/tauSteps,r=revenue({alpha,beta,tau,c});
      if(r&&r.total>best.total)best={tau,...r};
    }
    rows.push({alpha,beta,fork_success_probability:c,best_tau:best.tau,attacker_reward_share:best.total,relative_extra_revenue_pct:best.relative_extra*100});
  }
}

const bwh=rows.filter(r=>r.fork_success_probability===0);
const faw=rows.filter(r=>r.fork_success_probability>0);
const positiveBwh=bwh.filter(r=>r.relative_extra_revenue_pct>1e-9);
const positiveFaw=faw.filter(r=>r.relative_extra_revenue_pct>1e-9);
const top=[...rows].sort((a,b)=>b.relative_extra_revenue_pct-a.relative_extra_revenue_pct).slice(0,12);

console.log(JSON.stringify({
  schema:'FAE_POOL_INFILTRATION_SENSITIVITY_V1',
  status:'MODEL_EXECUTED__POOL_INCENTIVE_RISK_NOT_CLOSED',
  model:{
    total_network_hash_normalized:1,
    alpha:'attacker total hash fraction',
    beta:'target-pool honest hash fraction',
    tau:'fraction of attacker hash infiltrating target pool',
    c:'probability an FAW-triggered fork branch is selected',
    payout_assumption:'long-window proportional share payout approximation; FAE PPLNS window mechanics not modeled exactly',
    costs_omitted:true
  },
  sweep:{alphas,betas,cs,tau_steps:tauSteps,cells:rows.length},
  findings:{
    bwh_cells_with_positive_attacker_extra_revenue:positiveBwh.length,
    faw_cells_with_positive_attacker_extra_revenue:positiveFaw.length,
    top
  },
  interpretation:[
    'This sensitivity model must not be promoted to a final FAE pool-profitability claim.',
    'It is sufficient to show that share-based pool participation creates a strategic-infiltration surface that direct sovereign mining does not require.',
    'Final GREEN requires replay with the frozen FAE pool payout/window/stale-share/fork semantics and realistic propagation/cost assumptions.',
    'A pool feature must remain optional; consensus safety must not depend on pool-coordinator honesty.'
  ],
  sources:[
    'https://arxiv.org/abs/1708.09790',
    'https://pmc.ncbi.nlm.nih.gov/articles/PMC9739052/'
  ],
  authority:{research_only:true,pool_activation:false,consensus_change:false,economics_change:false,mainnet:false}
},null,2));
