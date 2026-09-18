export function proveRenderFreeCapacity({
  requiredHours,
  dashboardRemainingHours=null,
  monthlyPoolHours=750,
  freeWebServiceCount=null,
  worstCaseElapsedHoursSinceReset=null,
  inventoryCompleteSinceReset=false
}={}){
  const required=Number(requiredHours);
  if(!Number.isFinite(required)||required<=0)throw new Error('required_hours_invalid');
  if(dashboardRemainingHours!==null){
    const remaining=Number(dashboardRemainingHours);
    if(!Number.isFinite(remaining)||remaining<0)return{ok:false,method:'dashboard',error:'dashboard_remaining_invalid'};
    return{ok:remaining>=required,method:'dashboard',remainingLowerBoundHours:remaining,requiredHours:required};
  }
  if(inventoryCompleteSinceReset!==true)return{ok:false,method:'worst_case_bound',error:'inventory_since_reset_not_proven',requiredHours:required};
  const count=Number(freeWebServiceCount),elapsed=Number(worstCaseElapsedHoursSinceReset),pool=Number(monthlyPoolHours);
  if(!Number.isSafeInteger(count)||count<0||!Number.isFinite(elapsed)||elapsed<0||!Number.isFinite(pool)||pool<=0)return{ok:false,method:'worst_case_bound',error:'bound_inputs_invalid',requiredHours:required};
  const consumedUpperBound=count*elapsed;
  const remainingLowerBound=Math.max(0,pool-consumedUpperBound);
  return{
    ok:remainingLowerBound>=required,method:'worst_case_bound',
    monthlyPoolHours:pool,freeWebServiceCount:count,worstCaseElapsedHoursSinceReset:elapsed,
    consumedUpperBoundHours:consumedUpperBound,remainingLowerBoundHours:remainingLowerBound,requiredHours:required
  };
}
