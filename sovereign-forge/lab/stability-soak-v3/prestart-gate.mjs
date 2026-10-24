export function evaluateV3Prestart({services,nodes,controller,observer,expectedCommit,requiredFreeHours=540,remainingFreeHours=null}={}){
  const errors=[];
  if(!/^[0-9a-f]{40}$/.test(String(expectedCommit||'')))errors.push('expected_commit_invalid');
  if(!Array.isArray(services)||services.length!==5)errors.push('five_services_required');
  for(const service of services||[]){
    const role=service.role||service.id||'unknown';
    if(service.suspended===true||service.suspended==='suspended')errors.push(`${role}:suspended`);
    if(service.plan!=='free')errors.push(`${role}:unexpected_plan`);
    if(service.autoDeploy!==false&&service.autoDeploy!=='no'&&service.autoDeploy!=='off')errors.push(`${role}:auto_deploy_not_off`);
    if(expectedCommit&&service.commit&&service.commit!==expectedCommit)errors.push(`${role}:commit_mismatch`);
    if(service.healthy!==true)errors.push(`${role}:health_not_green`);
  }
  if(!Array.isArray(nodes)||nodes.length!==3)errors.push('three_nodes_required');
  const identities=new Set();
  for(const node of nodes||[]){
    const role=node.role||'node';
    if(!node.identityId)errors.push(`${role}:identity_missing`);else identities.add(node.identityId);
    if(node.configuredPeers<2)errors.push(`${role}:peer_bootstrap_incomplete`);
    if(node.height<0||!node.tipHash)errors.push(`${role}:chain_status_invalid`);
    if(node.runStarted===true)errors.push(`${role}:run_started_before_t0`);
  }
  if(identities.size!==(nodes?.length||0))errors.push('node_identities_not_distinct');
  if(!controller?.healthy)errors.push('controller_not_healthy');
  if(!observer?.healthy)errors.push('observer_not_healthy');
  if(controller?.runStarted||observer?.runStarted)errors.push('monitor_started_before_t0');
  if(remainingFreeHours!==null&&Number(remainingFreeHours)<requiredFreeHours)errors.push('remaining_free_hours_below_required');
  return{ok:errors.length===0,errors,requiredFreeHours};
}
