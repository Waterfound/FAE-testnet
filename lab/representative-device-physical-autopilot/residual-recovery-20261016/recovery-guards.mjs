
export const ORDER=[
  ["pure_mining_sustained",1],["pure_mining_sustained",2],["pure_mining_sustained",3],
  ["normal_use_coexistence",1],["normal_use_coexistence",2],["normal_use_coexistence",3],
  ["lifecycle_recovery",1]
];
const ensure=(condition,error)=>{if(!condition)throw new Error("RESIDUAL_RECOVERY_REJECTED:"+error)};
export function verifyImport(payload,{currentPlatform,currentUA,currentConcurrency}){
  ensure(payload?.schema==="FAE_RDE_BROWSER_PORTFOLIO_V1","schema");
  ensure(payload?.contract_id==="FAE-RDE-ACCEPTANCE-V1-20260928","contract");
  ensure(payload?.autopilot_protocol_id==="FAE-RDE-PHYSICAL-AUTOPILOT-V1-20260928","protocol");
  const rows=payload?.captures;
  ensure(Array.isArray(rows)&&rows.length>=1&&rows.length<7,"must_be_partial_prefix");
  const first=rows[0];const lock=first?.selection_lock,dev=first?.device,source=first?.source_provenance;
  ensure(lock?.device_class==="compact_handheld_consumer"&&lock?.selected_device?.manufacturer==="Valve"&&lock?.selected_device?.model==="Steam Deck OLED","selected_device");
  ensure(dev?.device_id==="Valve:Steam Deck OLED:compact_handheld_consumer","device_id");
  ensure(dev?.os==="Linux x86_64"&&currentPlatform==="Linux x86_64","host_platform");
  ensure(dev?.os_version===currentUA,"host_user_agent_changed");
  ensure(Number(dev?.hardware_concurrency)===Number(currentConcurrency),"host_concurrency_changed");
  ensure(source?.source_revision==="d6c3ac8670806729ec10d026c15317ebb73f4f69","source_revision");
  ensure(source?.miner_blob_sha==="fb98057341adca6f1f53b681e1094ef6fcb97e1f","miner_blob");
  ensure(source?.network==="fairyelf-public-testnet-v4","network");
  ensure(source?.harness_revision==="RPA-V1","original_harness");
  const sameLock=JSON.stringify(lock),sameSource=JSON.stringify(source);
  const identifiers=new Set();let previousEnd=0;
  const lockedTime=Date.parse(lock?.locked_at);
  ensure(Number.isFinite(lockedTime)&&lock?.network_lock?.observed_height>=0,"lock_time_or_tip");
  for(let i=0;i<rows.length;i++){
    const c=rows[i],run=c?.run,w=c?.workload,m=c?.measurements;
    ensure(w?.workload_id===ORDER[i][0]&&w?.repetition===ORDER[i][1],"not_a_canonical_prefix_at_"+i);
    ensure(run?.evidence_class==="PHYSICAL_EVIDENCE"&&run?.completed===true&&run?.synthetic===false&&run?.rehearsal_scaled===false,"physical_only_"+i);
    ensure(c?.template_only===false&&c?.contract_id===payload.contract_id,"capture_contract_"+i);
    ensure(JSON.stringify(c.selection_lock)===sameLock&&JSON.stringify(c.source_provenance)===sameSource,"mixed_lineage_"+i);
    ensure(c?.device?.device_id===dev.device_id&&c?.device?.os_version===dev.os_version,"mixed_device_"+i);
    ensure(!identifiers.has(run.run_id)&&typeof run.run_id==="string","duplicate_run_id_"+i);identifiers.add(run.run_id);
    const start=Date.parse(run.started_at),end=Date.parse(run.ended_at);
    ensure(Number.isFinite(start)&&Number.isFinite(end)&&start>lockedTime&&end>start&&start>=previousEnd,"time_or_order_"+i);previousEnd=end;
    const expectedWarm=ORDER[i][0]==="pure_mining_sustained"?600:ORDER[i][0]==="normal_use_coexistence"?300:0;
    const expectedMeasured=ORDER[i][0]==="pure_mining_sustained"?1200:ORDER[i][0]==="normal_use_coexistence"?900:0;
    ensure(Number(m?.warmup_observed_seconds)>=expectedWarm&&Number(m?.measurement_observed_seconds)>=expectedMeasured,"duration_"+i);
    ensure(Number(m?.attempts_end)>Number(m?.attempts_start)&&Number(m?.derived_work_rate)>0,"attempts_"+i);
    ensure(Number(m?.first_window_rate)>0&&Number(m?.last_window_rate)/Number(m?.first_window_rate)>=0.7,"retention_"+i);
    if(ORDER[i][0]==="normal_use_coexistence"){
      ensure(Number(m?.failed_scripted_interactions)===0&&Number(m?.interactive_p95_ms_baseline)>0&&Number(m?.interactive_p95_ms_with_mining)>0,"normal_use_"+i);
    }
    if(ORDER[i][0]==="lifecycle_recovery")ensure(Number(m?.lifecycle_transitions)>=5,"lifecycle_"+i);
  }
  return {prefix_count:rows.length,original_lock:lock,original_device:dev,remaining:ORDER.slice(rows.length),original_capture_ids:[...identifiers]};
}
export function alreadyCaptured(captures,workloadId,repetition){
  return captures.some(c=>c?.workload?.workload_id===workloadId&&c?.workload?.repetition===repetition);
}
