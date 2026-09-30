export const V3_WILSON_Z_ONE_SIDED_95=1.6448536269514722;

export function wilsonUpperOneSided95(stales,total){
  const n=Number(total),x=Number(stales);
  if(!Number.isSafeInteger(n)||n<=0||!Number.isSafeInteger(x)||x<0||x>n)throw new Error('invalid_wilson_counts');
  const z=V3_WILSON_Z_ONE_SIDED_95,z2=z*z,p=x/n,den=1+z2/n;
  const center=(p+z2/(2*n))/den;
  const half=z*Math.sqrt((p*(1-p)/n)+(z2/(4*n*n)))/den;
  return Math.min(1,center+half);
}
export function percentile95(values){
  if(!Array.isArray(values)||values.length<1)return null;
  const rows=values.map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
  if(!rows.length)return null;
  return rows[Math.max(0,Math.ceil(rows.length*0.95)-1)];
}
function ms(value){const t=Date.parse(value);if(!Number.isFinite(t))throw new Error(`invalid_time:${value}`);return t}
function uniqueBy(rows,keyFn){const seen=new Set(),out=[];for(const row of rows){const key=keyFn(row);if(seen.has(key))continue;seen.add(key);out.push(row)}return out}
function validHash(value){return typeof value==='string'&&value.length>0}

export function analyzeStabilitySoakV3({
  events,finalChain,t0Utc,tEndUtc,initialHeight,
  frozenHarnessCommit=null,maxMonitorCoverageGapMs=30_000
}){
  if(!Array.isArray(events)||!Array.isArray(finalChain))throw new Error('events_and_final_chain_required');
  const t0=ms(t0Utc),tEnd=ms(tEndUtc),durationMs=tEnd-t0;
  const invalidTimestampEvents=events.filter(e=>!Number.isFinite(Date.parse(e?.at))).length;
  const filtered=events.filter(e=>{
    try{const t=ms(e.at);return t>=t0&&t<=tEnd}catch{return false}
  }).sort((a,b)=>ms(a.at)-ms(b.at));

  const failures=filtered.filter(e=>e.event==='FAE_V3_FAIL');
  const monitorBoots=filtered.filter(e=>e.event==='FAE_V3_MONITOR_BOOT');
  const nodeBoots=filtered.filter(e=>e.event==='FAE_V3_NODE_BOOT');
  const roles=new Set(monitorBoots.map(e=>e.monitor_role));
  const commitMismatches=frozenHarnessCommit?filtered.filter(e=>
    ['FAE_V3_MONITOR_BOOT','FAE_V3_NODE_BOOT'].includes(e.event)&&e.render_git_commit&&e.render_git_commit!==frozenHarnessCommit
  ):[];

  const coveragePoints=filtered
    .filter(e=>['FAE_V3_MONITOR_BOOT','FAE_V3_HEARTBEAT'].includes(e.event))
    .map(e=>({at:ms(e.at),role:e.monitor_role}));
  const combinedTimes=[t0,...coveragePoints.map(x=>x.at),tEnd].sort((a,b)=>a-b);
  let maxCombinedCoverageGapMs=0;
  for(let i=1;i<combinedTimes.length;i++)maxCombinedCoverageGapMs=Math.max(maxCombinedCoverageGapMs,combinedTimes[i]-combinedTimes[i-1]);

  const phaseMs=24*60*60_000,phases=[];
  for(let i=0;i<4;i++){
    const start=t0+i*phaseMs,end=start+phaseMs;
    const rows=coveragePoints.filter(x=>x.at>=start&&x.at<end);
    phases.push({
      phase:i+1,start:new Date(start).toISOString(),end:new Date(end).toISOString(),
      controller:rows.some(x=>x.role==='controller'),
      observer:rows.some(x=>x.role==='observer')
    });
  }

  const finalChainValid=finalChain.length>0&&finalChain.every(b=>
    Number.isSafeInteger(Number(b.height))&&Number(b.height)>=0&&validHash(String(b.hash||''))&&Number.isFinite(Number(b.timestamp_ms))
  );
  const finalHashes=new Set(finalChain.map(b=>String(b.hash)));
  const runCanonical=finalChain.filter(b=>Number(b.height)>Number(initialHeight)&&Number(b.timestamp_ms)>=t0&&Number(b.timestamp_ms)<=tEnd);
  const seen=uniqueBy(filtered.filter(e=>e.event==='FAE_V3_TIP_FIRST_SEEN'&&Number(e.height)>Number(initialHeight)),e=>String(e.hash));
  const stale=seen.filter(e=>!finalHashes.has(String(e.hash)));
  const totalBlocks=runCanonical.length+stale.length;
  const staleRate=totalBlocks>0?stale.length/totalBlocks:null;
  const wilsonUpper=totalBlocks>0?wilsonUpperOneSided95(stale.length,totalBlocks):null;

  const propagatedRaw=uniqueBy(filtered.filter(e=>e.event==='FAE_V3_BLOCK_PROPAGATED'&&Number(e.height)>Number(initialHeight)),e=>String(e.hash));
  const malformedPropagation=propagatedRaw.filter(e=>!Number.isFinite(Number(e.propagation_ms))||Number(e.propagation_ms)<0);
  const propagated=propagatedRaw.filter(e=>Number.isFinite(Number(e.propagation_ms))&&Number(e.propagation_ms)>=0);
  const propagationP95=percentile95(propagated.map(e=>Number(e.propagation_ms)));

  const reorgRows=filtered.filter(e=>e.event==='FAE_V3_REORG_OBSERVED');
  const malformedReorgs=reorgRows.filter(e=>
    !e.node||!Number.isFinite(Number(e.anchor_height))||!validHash(String(e.previous_tip||''))||
    !validHash(String(e.new_hash_at_anchor||''))||!validHash(String(e.current_tip||''))
  );
  const reorgs=uniqueBy(reorgRows.filter(e=>!malformedReorgs.includes(e)),e=>[
    e.node,e.anchor_height,e.previous_tip,e.new_hash_at_anchor,e.current_tip
  ].join(':'));
  const recoveries=filtered.filter(e=>e.event==='FAE_V3_NODE_RECOVERED').map(e=>Number(e.duration_ms)).filter(Number.isFinite);
  const transportRecoveries=filtered.filter(e=>e.event==='FAE_V3_TRANSPORT_RECOVERED').map(e=>Number(e.duration_ms)).filter(Number.isFinite);
  const maxRecoveryMs=Math.max(0,...recoveries,...transportRecoveries);

  const gates={
    duration_96h:durationMs>=96*60*60_000,
    four_complete_phases:phases.every(p=>p.controller&&p.observer),
    dual_monitor_roles:roles.has('controller')&&roles.has('observer'),
    monitor_coverage:maxCombinedCoverageGapMs<=maxMonitorCoverageGapMs,
    timestamps_complete:invalidTimestampEvents===0,
    final_chain_valid:finalChainValid,
    chain_progressed:runCanonical.length>0,
    no_fail_events:failures.length===0,
    frozen_commit:commitMismatches.length===0,
    recovery_under_180s:maxRecoveryMs<=180_000,
    stale_observed_under_1pct:staleRate!==null&&staleRate<0.01,
    wilson_upper_under_1pct:wilsonUpper!==null&&wilsonUpper<0.01,
    propagation_evidence_complete:propagated.length>0&&malformedPropagation.length===0,
    propagation_p95_under_5s:propagationP95!==null&&propagationP95<5000,
    reorg_accounting_complete:malformedReorgs.length===0
  };
  return{
    ok:Object.values(gates).every(Boolean),gates,
    duration_ms:durationMs,phases,max_combined_monitor_gap_ms:maxCombinedCoverageGapMs,
    invalid_timestamp_events:invalidTimestampEvents,
    failures,commit_mismatches:commitMismatches,
    canonical_blocks_during_run:runCanonical.length,stale_blocks:stale.length,
    total_blocks_for_stale_rate:totalBlocks,observed_stale_rate:staleRate,wilson_upper_one_sided_95:wilsonUpper,
    propagation_observations:propagated.length,malformed_propagation_observations:malformedPropagation.length,propagation_p95_ms:propagationP95,
    reorg_count:reorgs.length,malformed_reorg_observations:malformedReorgs.length,
    recoveries:recoveries.length,transport_recoveries:transportRecoveries.length,
    max_recovery_ms:maxRecoveryMs,node_boot_events:nodeBoots.length,monitor_boot_events:monitorBoots.length
  };
}

const EVIDENCE_GATES=[
  'four_complete_phases','dual_monitor_roles','monitor_coverage','timestamps_complete','final_chain_valid',
  'frozen_commit','propagation_evidence_complete','reorg_accounting_complete'
];
export function classifyStabilitySoakV3({analysis,termination='completed',providerFailureProven=false,harnessFailureProven=false}={}){
  if(!analysis||typeof analysis!=='object'||!analysis.gates)return'EVIDENCE_INCOMPLETE';
  if(providerFailureProven===true)return'PROVIDER_FAILURE';
  if(harnessFailureProven===true)return'HARNESS_FAILURE';
  if(EVIDENCE_GATES.some(k=>analysis.gates[k]!==true))return'EVIDENCE_INCOMPLETE';
  if(termination!=='completed')return'INCONCLUSIVE';
  if(analysis.ok===true)return'PASS';
  return'FAIL';
}
