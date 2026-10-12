function rng(seed){
  let x=BigInt(seed)||1n;
  return()=>{
    x=(6364136223846793005n*x+1442695040888963407n)&((1n<<64n)-1n);
    return Number(x>>11n)/9007199254740992;
  };
}

function simulate({alpha,gamma,events=2_000_000,seed=1}){
  const random=rng(seed);
  let state=0; // >=0 private lead; -1 means public race 0'
  let attacker=0,honest=0,discoveries=0;

  while(discoveries<events){
    discoveries++;
    const attackerFinds=random()<alpha;

    if(state===-1){
      if(attackerFinds){
        attacker+=2;
      }else if(random()<gamma){
        attacker+=1; honest+=1;
      }else{
        honest+=2;
      }
      state=0;
      continue;
    }

    if(state===0){
      if(attackerFinds)state=1;
      else honest+=1;
      continue;
    }

    if(state===1){
      if(attackerFinds)state=2;
      else state=-1;
      continue;
    }

    if(state===2){
      if(attackerFinds)state=3;
      else{
        attacker+=2;
        state=0;
      }
      continue;
    }

    if(attackerFinds){
      state++;
    }else{
      attacker+=1;
      state--;
    }
  }

  // Conservative terminal accounting: unresolved private/race work earns nothing.
  const accepted=attacker+honest;
  return{
    alpha,gamma,events,
    attacker_blocks:attacker,
    honest_blocks:honest,
    attacker_revenue_share:accepted?attacker/accepted:0,
    profitability_delta:(accepted?attacker/accepted:0)-alpha,
    unresolved_state:state
  };
}

const alphas=[.10,.15,.20,.22,.24,.25,.26,.28,.30,.32,.33,.34,.36,.40,.45];
const gammas=[0,.25,.5];
const rows=[];
for(const gamma of gammas){
  for(const alpha of alphas){
    rows.push(simulate({alpha,gamma,seed:Math.round(alpha*10000+gamma*1000+20261010)}));
  }
}

const thresholds={};
for(const gamma of gammas){
  const subset=rows.filter(r=>r.gamma===gamma);
  const profitable=subset.find(r=>r.profitability_delta>0.001);
  thresholds[String(gamma)]=profitable?.alpha??null;
}

console.log(JSON.stringify({
  schema:'FAE_STRATEGIC_MINING_SELFISH_SENSITIVITY_V1',
  model:'classic selfish-mining state machine; deterministic Monte Carlo',
  events_per_cell:2_000_000,
  rows,
  observed_grid_profitability_threshold:thresholds,
  analytic_reference_threshold:{
    formula:'(1-gamma)/(3-2*gamma)',
    gamma_0:(1-0)/(3-0),
    gamma_0_25:(1-.25)/(3-.5),
    gamma_0_5:(1-.5)/(3-1)
  },
  fae_interpretation:[
    'FAE cumulative-work validation does not eliminate strategic withholding.',
    'If the equal-work lexicographic hash tie is unbiased between one attacker candidate and one honest candidate, its eventual branch preference is 50/50 in expectation; using gamma=0.5 is therefore a useful attacker-favorable sensitivity, not a proof of actual network gamma.',
    'Grinding multiple valid same-height candidates can bias that tie but consumes additional valid-block work opportunities; its net profitability requires a separate opportunity-cost model.',
    'Final strategic-mining closure must use frozen mainnet block timing, DAA, propagation and pool semantics.'
  ],
  authority:'RESEARCH_ONLY'
},null,2));
