/**
 * HPA-UC-001 W3 — deterministic finite-horizon expectation for the classic
 * selfish-release state machine already used by selfish-mining-sensitivity.
 *
 * This removes Monte Carlo sampling error from the declared model.  It does
 * not measure FAE propagation gamma, select a tie rule, or prove profitability.
 */
function add(map,state,p,attacker,honest){
  if(p===0)return;
  const prior=map.get(state)||{p:0,attacker:0,honest:0};
  prior.p+=p;prior.attacker+=attacker;prior.honest+=honest;map.set(state,prior);
}

export function exactSelfishHorizon({alpha,gamma,events=1000}={}){
  if(typeof alpha!=='number'||!Number.isFinite(alpha)||alpha<=0||alpha>=0.5||
     typeof gamma!=='number'||!Number.isFinite(gamma)||gamma<0||gamma>1||
     !Number.isSafeInteger(events)||events<1||events>100000)
    throw new Error('invalid_selfish_horizon_assumptions');
  let states=new Map([[0,{p:1,attacker:0,honest:0}]]);
  for(let event=0;event<events;event++){
    const next=new Map();
    for(const [state,row] of states){
      const ap=row.p*alpha,hp=row.p*(1-alpha);
      if(state===-1){
        add(next,0,ap,row.attacker*alpha+2*ap,row.honest*alpha);
        const honestAttacker=hp*gamma,honestHonest=hp*(1-gamma);
        add(next,0,honestAttacker,row.attacker*(1-alpha)*gamma+honestAttacker,
          row.honest*(1-alpha)*gamma+honestAttacker);
        add(next,0,honestHonest,row.attacker*(1-alpha)*(1-gamma),
          row.honest*(1-alpha)*(1-gamma)+2*honestHonest);
      }else if(state===0){
        add(next,1,ap,row.attacker*alpha,row.honest*alpha);
        add(next,0,hp,row.attacker*(1-alpha),row.honest*(1-alpha)+hp);
      }else if(state===1){
        add(next,2,ap,row.attacker*alpha,row.honest*alpha);
        add(next,-1,hp,row.attacker*(1-alpha),row.honest*(1-alpha));
      }else if(state===2){
        add(next,3,ap,row.attacker*alpha,row.honest*alpha);
        add(next,0,hp,row.attacker*(1-alpha)+2*hp,row.honest*(1-alpha));
      }else{
        add(next,state+1,ap,row.attacker*alpha,row.honest*alpha);
        add(next,state-1,hp,row.attacker*(1-alpha)+hp,row.honest*(1-alpha));
      }
    }
    states=next;
  }
  let probability=0,attacker=0,honest=0,unresolvedProbability=0;
  for(const [state,row] of states){
    probability+=row.p;attacker+=row.attacker;honest+=row.honest;
    if(state!==0)unresolvedProbability+=row.p;
  }
  const accepted=attacker+honest,share=accepted?attacker/accepted:0;
  return {
    schema:'FAE_CLASSIC_SELFISH_EXACT_FINITE_HORIZON_V1',
    alpha,gamma,events,probability_mass:probability,
    expected_attacker_accepted_blocks:attacker,
    expected_honest_accepted_blocks:honest,
    attacker_revenue_share:share,
    profitability_delta:share-alpha,
    unresolved_terminal_probability:unresolvedProbability,
    terminal_state_count:states.size,
    model:'CLASSIC_SELFISH_RELEASE__UNRESOLVED_TERMINAL_WORK_EARNS_ZERO',
    propagation_gamma_observed:false,
    final_tie_policy_selected:false,
    actual_profitability_proven:false
  };
}

/**
 * Explicit one-event trail counterfactual.  After the attacker's branch loses
 * a one-block public race, it attempts exactly one more private discovery.  A
 * discovery restores a length-two public race; another honest discovery
 * resolves three honest blocks.  This is deliberately narrower than any full
 * literature strategy family and must not be labelled as empirical FAE
 * stubborn-mining profitability.
 */
export function exactOneEventTrailHorizon({alpha,gamma,events=1000}={}){
  if(typeof alpha!=='number'||!Number.isFinite(alpha)||alpha<=0||alpha>=0.5||
     typeof gamma!=='number'||!Number.isFinite(gamma)||gamma<0||gamma>1||
     !Number.isSafeInteger(events)||events<1||events>100000)
    throw new Error('invalid_trail_horizon_assumptions');
  let states=new Map([[0,{p:1,attacker:0,honest:0}]]);
  for(let event=0;event<events;event++){
    const next=new Map();
    for(const [state,row] of states){
      const ap=row.p*alpha,hp=row.p*(1-alpha);
      if(state==='R1'||state==='R2'){
        const length=state==='R1'?1:2;
        add(next,0,ap,row.attacker*alpha+(length+1)*ap,row.honest*alpha);
        const onAttacker=hp*gamma,onHonest=hp*(1-gamma);
        add(next,0,onAttacker,row.attacker*(1-alpha)*gamma+length*onAttacker,
          row.honest*(1-alpha)*gamma+onAttacker);
        if(state==='R1')
          add(next,'T1',onHonest,row.attacker*(1-alpha)*(1-gamma),
            row.honest*(1-alpha)*(1-gamma));
        else
          add(next,0,onHonest,row.attacker*(1-alpha)*(1-gamma),
            row.honest*(1-alpha)*(1-gamma)+(length+1)*onHonest);
      }else if(state==='T1'){
        add(next,'R2',ap,row.attacker*alpha,row.honest*alpha);
        add(next,0,hp,row.attacker*(1-alpha),row.honest*(1-alpha)+3*hp);
      }else if(state===0){
        add(next,1,ap,row.attacker*alpha,row.honest*alpha);
        add(next,0,hp,row.attacker*(1-alpha),row.honest*(1-alpha)+hp);
      }else if(state===1){
        add(next,2,ap,row.attacker*alpha,row.honest*alpha);
        add(next,'R1',hp,row.attacker*(1-alpha),row.honest*(1-alpha));
      }else if(state===2){
        add(next,3,ap,row.attacker*alpha,row.honest*alpha);
        add(next,0,hp,row.attacker*(1-alpha)+2*hp,row.honest*(1-alpha));
      }else{
        add(next,state+1,ap,row.attacker*alpha,row.honest*alpha);
        add(next,state-1,hp,row.attacker*(1-alpha)+hp,row.honest*(1-alpha));
      }
    }
    states=next;
  }
  let probability=0,attacker=0,honest=0,unresolvedProbability=0,trailProbability=0;
  for(const [state,row] of states){
    probability+=row.p;attacker+=row.attacker;honest+=row.honest;
    if(state!==0)unresolvedProbability+=row.p;
    if(state==='T1'||state==='R2')trailProbability+=row.p;
  }
  const accepted=attacker+honest,share=accepted?attacker/accepted:0;
  return {
    schema:'FAE_ONE_EVENT_TRAIL_COUNTERFACTUAL_EXACT_HORIZON_V1',
    alpha,gamma,events,probability_mass:probability,
    expected_attacker_accepted_blocks:attacker,
    expected_honest_accepted_blocks:honest,
    attacker_revenue_share:share,
    profitability_delta:share-alpha,
    unresolved_terminal_probability:unresolvedProbability,
    trail_or_second_race_terminal_probability:trailProbability,
    model:'ONE_EVENT_TRAIL_AFTER_LOST_LENGTH_ONE_PUBLIC_RACE',
    full_literature_strategy_equivalence_proven:false,
    propagation_gamma_observed:false,
    actual_profitability_proven:false
  };
}
