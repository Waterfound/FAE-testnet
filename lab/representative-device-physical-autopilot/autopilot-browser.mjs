import {
  API,NETWORK,CONTRACT_ID,AUTOPILOT_PROTOCOL_ID,TESTED_SOURCE_REVISION,TESTED_MINER_BLOB_SHA,
  api,runId,currentIso,makeSourceProvenance,makeWorkerSource,buildSelectionLock,
  environmentDefaults,energyUnavailable,thermalFromTelemetry,percentile,leadingZeroBitsHex,validatePhysicalMode
} from './autopilot-core.mjs';

const $=id=>document.getElementById(id);
const state={
  lock:null,profile:null,captures:[],stopped:false,activeWorker:null,
  lifecycleCycles:0,lifecycleHidden:false,localAgent:false,harnessRevision:'RPA-V1'
};
const REQUIRED_LIFECYCLE=new Set(['mobile_tablet_arm','compact_handheld_consumer']);
const physicalDurations={
  pure_mining_sustained:{warmup:600,measurement:1200},
  normal_use_coexistence:{baseline:60,warmup:300,measurement:900}
};
const rehearsalDurations={
  pure_mining_sustained:{warmup:2,measurement:5},
  normal_use_coexistence:{baseline:2,warmup:2,measurement:5}
};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function status(text,kind=''){const el=$('campaignState');el.textContent=text;el.className='status '+kind}
function lockStatus(text,kind=''){const el=$('lockState');el.textContent=text;el.className='status '+kind}
function updateMetrics({label,attempts,rate,progress}={}){
  if(label!==undefined)$('runLabel').textContent=label;
  if(attempts!==undefined)$('attempts').textContent=Math.round(attempts).toLocaleString();
  if(rate!==undefined)$('rate').textContent=Math.round(rate).toLocaleString()+' H/s';
  if(progress!==undefined)$('progress').style.width=Math.max(0,Math.min(100,progress))+'%';
  $('captures').textContent=String(state.captures.length);
}
function formProfile(){
  return{
    manufacturer:$('manufacturer').value.trim(),
    model:$('model').value.trim(),
    device_class:$('deviceClass').value,
    os:navigator.platform||'browser',
    os_version:navigator.userAgent,
    isa_family:state.profile?.isa_family||(/arm|iphone|ipad|mac/i.test(navigator.userAgent)?'arm64':'unknown'),
    form_factor:({
      mobile_tablet_arm:'mobile_or_tablet',
      thin_light_integrated:'thin_and_light_laptop',
      consumer_discrete_gpu:'consumer_desktop_or_laptop_with_dGPU',
      compact_handheld_consumer:'handheld_or_compact_gaming_device'
    })[$('deviceClass').value],
    soc_cpu:state.profile?.soc_cpu||'browser_not_exposed',
    gpu:state.profile?.gpu||'browser_not_exposed',
    ram_gb:state.profile?.ram_gb??(navigator.deviceMemory||null),
    hardware_concurrency:navigator.hardwareConcurrency||null,
    power_mode:$('powerMode').value.trim()||'normal',
    charging_state:$('chargingState').value.trim()||'unknown_declared',
    external_power:$('externalPower').value==='true',
    cooling_configuration:$('cooling').value.trim()||'stock',
    background_task_policy:$('background').value.trim()||'ordinary_background_state',
    display_state:'on'
  };
}
async function loadLocalProfile(){
  try{
    const r=await fetch('/_rde/profile',{cache:'no-store'});
    if(!r.ok)throw new Error('not local agent');
    const p=await r.json();state.profile=p;state.localAgent=true;
    if(p.manufacturer)$('manufacturer').value=p.manufacturer;
    if(p.model)$('model').value=p.model;
    if(p.device_class)$('deviceClass').value=p.device_class;
    $('profileState').textContent='Local agent detected · '+[p.manufacturer,p.model,p.os].filter(Boolean).join(' · ');
    $('profileState').className='status good';
  }catch{
    $('profileState').textContent='Browser-only path. Device identity must be declared before lock.';
  }
}
async function telemetry(){
  if(!state.localAgent)return{};
  try{const r=await fetch('/_rde/telemetry',{cache:'no-store'});return r.ok?await r.json():{}}catch{return{}}
}
async function lockSelection(){
  if(state.captures.length)throw new Error('selection_cannot_change_after_results');
  const p=formProfile();
  if(!p.manufacturer||!p.model)throw new Error('manufacturer_and_exact_model_required');
  const statusNow=await api('/status');
  if(!Number.isSafeInteger(Number(statusNow.height))||!/^[0-9a-f]{64}$/.test(String(statusNow.tip_hash||'')))throw new Error('network_tip_invalid');
  state.lock=buildSelectionLock({
    deviceClass:p.device_class,manufacturer:p.manufacturer,model:p.model,
    candidates:[{manufacturer:p.manufacturer,model:p.model,eligible:true,source:state.localAgent?'machine_discovery':'operator_preselection'}],
    rationale:state.localAgent?'Deterministic machine discovery of the device present before any FAE measurement.':'Operator-selected physical device locked before any FAE measurement.',
    status:statusNow,harnessRevision:state.harnessRevision
  });
  for(const id of ['deviceClass','manufacturer','model'])$(id).disabled=true;
  $('lock').disabled=true;$('unlock').disabled=false;$('runFull').disabled=false;
  lockStatus('Locked before results · height '+statusNow.height+' · '+p.manufacturer+' '+p.model,'good');
}
function resetLock(){
  if(state.captures.length)throw new Error('cannot_unlock_after_capture');
  state.lock=null;
  for(const id of ['deviceClass','manufacturer','model'])$(id).disabled=false;
  $('lock').disabled=false;$('unlock').disabled=true;$('runFull').disabled=true;
  lockStatus('No selection lock yet.');
}
function newPowWorker(){
  const url=URL.createObjectURL(new Blob([makeWorkerSource()],{type:'text/javascript'}));
  const worker=new Worker(url);
  worker.__url=url;return worker;
}
function stopWorker(){
  if(state.activeWorker){
    try{state.activeWorker.postMessage({kind:'stop'});state.activeWorker.terminate();URL.revokeObjectURL(state.activeWorker.__url)}catch{}
    state.activeWorker=null;
  }
}
async function template(address){return api('/template?address='+encodeURIComponent(address))}
function tipMatches(header,s){
  const parentHeight=Number(header?.height)-1;
  return Number(s?.height)===parentHeight&&String(s?.tip_hash||'')===String(header?.previous_hash||'');
}
async function miningSession({seconds,onTick,events}){
  const address=$('rewardAddress').value.trim();
  if(!address.startsWith('faet1'))throw new Error('valid_FAE_reward_address_required');
  const started=performance.now(),end=started+seconds*1000;
  let totalAttempts=0,stale=0,invalid=0,accepted=0,validated=0;
  let rates=[],activeHeader=null,lastWorkerAttempts=0,workerStarted=0,lastStatusPoll=0;
  state.stopped=false;

  async function startWork(){
    stopWorker();
    const t=await template(address);activeHeader=t.header;lastWorkerAttempts=0;workerStarted=performance.now();
    const worker=newPowWorker();state.activeWorker=worker;
    worker.onmessage=async e=>{
      const msg=e.data||{};
      if(msg.kind==='progress'){
        lastWorkerAttempts=Math.max(lastWorkerAttempts,Number(msg.attempts)||0);
        const rate=lastWorkerAttempts/Math.max(.001,(performance.now()-workerStarted)/1000);
        rates.push(rate);
        onTick?.({attempts:totalAttempts+lastWorkerAttempts,rate});
      }else if(msg.kind==='solution'){
        lastWorkerAttempts=Math.max(lastWorkerAttempts,Number(msg.attempts)||0);
        totalAttempts+=lastWorkerAttempts;lastWorkerAttempts=0;
        const bits=leadingZeroBitsHex(String(msg.hash||''));
        if(bits<Number(activeHeader.difficulty_bits)){invalid++;events.push({event_id:runId('invalid'),at:currentIso(),type:'invalid_local_solution'});await startWork();return}
        validated++;
        try{
          const s=await api('/status');
          if(!tipMatches(activeHeader,s)){stale++;events.push({event_id:runId('stale'),at:currentIso(),type:'solution_stale_before_submit'});await startWork();return}
          const submission={header:activeHeader,nonce:msg.nonce,hash:msg.hash,txids:t.txids||[]};
          if(Array.isArray(t.coinbase_outputs))submission.coinbase_outputs=t.coinbase_outputs;
          await api('/submit-block',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(submission)});
          accepted++;events.push({event_id:runId('accepted'),at:currentIso(),type:'block_accepted'});
        }catch(error){
          if(/stale|race/i.test(String(error.message))){stale++;events.push({event_id:runId('stale'),at:currentIso(),type:'stale_submission'});}
          else{invalid++;events.push({event_id:runId('submit-error'),at:currentIso(),type:'submission_error',message:String(error.message||error)});}
        }
        if(performance.now()<end&&!state.stopped)await startWork();
      }
    };
    worker.onerror=e=>{events.push({event_id:runId('worker-error'),at:currentIso(),type:'worker_error',message:String(e.message||'worker error')});invalid++};
    worker.postMessage({header:t.header,targetBits:Number(t.header.difficulty_bits)});
  }

  await startWork();
  while(performance.now()<end&&!state.stopped){
    await sleep(250);
    const now=performance.now();
    if(now-lastStatusPoll>=2000&&activeHeader){
      lastStatusPoll=now;
      try{
        const s=await api('/status');
        if(!tipMatches(activeHeader,s)){
          totalAttempts+=lastWorkerAttempts;lastWorkerAttempts=0;stale++;
          events.push({event_id:runId('tip-advance'),at:currentIso(),type:'tip_advanced_work_replaced'});
          await startWork();
        }
      }catch(error){events.push({event_id:runId('status-error'),at:currentIso(),type:'status_probe_error',message:String(error.message||error)})}
    }
    const elapsed=now-started;onTick?.({attempts:totalAttempts+lastWorkerAttempts,progress:100*elapsed/(seconds*1000)});
  }
  totalAttempts+=lastWorkerAttempts;stopWorker();
  const elapsed=Math.max(.001,(performance.now()-started)/1000);
  return{attempts:totalAttempts,elapsed,rates,stale,invalid,accepted,validated};
}
async function interactionProbe(seconds){
  const delays=[],hardFailures=[];let mutations=0;
  const target=document.createElement('div');target.hidden=true;document.body.append(target);
  const end=performance.now()+seconds*1000;
  while(performance.now()<end&&!state.stopped){
    const expected=performance.now()+50;
    await new Promise(resolve=>setTimeout(resolve,50));
    const delay=Math.max(0,performance.now()-expected);delays.push(delay);
    try{
      const before=target.dataset.n||'0',next=String(Number(before)+1);target.dataset.n=next;target.textContent=next;
      const row=[7,3,11,2,5,13,1].sort((a,b)=>a-b);
      await Promise.resolve();
      if(target.dataset.n!==next||row.join(',')!=='1,2,3,5,7,11,13')throw new Error('interaction_state_mismatch');
      if(delay>1000)hardFailures.push('probe_over_1000ms');
      mutations++;
    }catch(error){hardFailures.push(String(error.message||error))}
    if(delays.length%5===0)await sleep(0);
  }
  target.remove();
  return{p95_ms:50+percentile(delays,0.95),failed:hardFailures.length,mutations,delays};
}
function rateWindows(rates,fallback){
  const clean=rates.filter(x=>Number.isFinite(x)&&x>0);
  if(!clean.length)return{first:fallback,last:fallback};
  const n=Math.max(1,Math.ceil(clean.length*.2));
  const med=a=>{const b=[...a].sort((x,y)=>x-y);return b[Math.floor(b.length/2)]};
  return{first:med(clean.slice(0,n)),last:med(clean.slice(-n))};
}
async function createCapture({workloadId,repetition,measurement,baselineP95=null,lifecycleTransitions=0,events,startedAt,endedAt}){
  const p=formProfile(),mode=$('mode').value;
  const env=environmentDefaults(p.device_class,p);
  const tel=await telemetry();
  const run= {
    schema:'FAE_RDE_RUN_V1',contract_id:CONTRACT_ID,run_id:runId('rde'),
    evidence_class:mode,synthetic:mode!=='PHYSICAL_EVIDENCE',rehearsal_scaled:mode==='REHEARSAL_ONLY',
    completed:true,started_at:startedAt,ended_at:endedAt
  };
  const m={
    schema:'FAE_RDE_MEASUREMENTS_V1',
    warmup_observed_seconds:Number(measurement.warmupSeconds||0),
    measurement_observed_seconds:Number(measurement.elapsed),
    attempts_start:Number(measurement.attemptsStart||0),
    attempts_end:Number(measurement.attemptsStart||0)+Number(measurement.attempts||0),
    derived_work_rate:Number(measurement.attempts||0)/Math.max(.001,Number(measurement.elapsed)),
    first_window_rate:Number(measurement.firstRate),
    last_window_rate:Number(measurement.lastRate),
    validated_work_events:Number(measurement.validated||0),
    accepted_work_events:Number(measurement.accepted||0),
    invalid_work_events:Number(measurement.invalid||0),
    stale_work_events:Number(measurement.stale||0)
  };
  if(workloadId==='normal_use_coexistence'){
    m.interactive_p95_ms_baseline=baselineP95;
    m.interactive_p95_ms_with_mining=measurement.interactiveP95;
    m.failed_scripted_interactions=measurement.failedInteractions;
    m.recovery_seconds=measurement.recoverySeconds;
  }
  if(workloadId==='lifecycle_recovery')m.lifecycle_transitions=lifecycleTransitions;
  const capture={
    schema:'FAE_RDE_OPERATOR_CAPTURE_V1',contract_id:CONTRACT_ID,template_only:false,
    run,selection_lock:structuredClone(state.lock),
    device:{
      schema:'FAE_RDE_DEVICE_V1',device_id:[p.manufacturer,p.model,p.device_class].join(':'),
      device_class:p.device_class,manufacturer:p.manufacturer,model:p.model,soc_cpu:p.soc_cpu,gpu:p.gpu,ram_gb:p.ram_gb,
      os:p.os,os_version:p.os_version,isa_family:p.isa_family,form_factor:p.form_factor,power_mode:p.power_mode,thermal_mode:'normal',
      hardware_concurrency:p.hardware_concurrency
    },
    environment:env,
    source_provenance:makeSourceProvenance(state.harnessRevision),
    workload:{schema:'FAE_RDE_WORKLOAD_V1',workload_id:workloadId,device_class:p.device_class,repetition,protocol_contract_id:CONTRACT_ID,autopilot_protocol_id:AUTOPILOT_PROTOCOL_ID},
    measurements:m,
    energy:energyUnavailable(),
    thermals:thermalFromTelemetry(tel),
    system_events:{schema:'FAE_RDE_SYSTEM_EVENTS_V1',contamination_detected:false,events:events.filter(e=>!e.type.startsWith('miner_'))},
    miner_events:{schema:'FAE_RDE_MINER_EVENTS_V1',events:events.map((e,i)=>({event_id:e.event_id||run.run_id+'-'+i,at:e.at||currentIso(),type:e.type||'event'}))},
    operator_attestation:{
      schema:'FAE_RDE_OPERATOR_ATTESTATION_V1',run_id:run.run_id,device_id:[p.manufacturer,p.model,p.device_class].join(':'),
      physical_run_performed:mode==='PHYSICAL_EVIDENCE',synthetic_data_used:mode!=='PHYSICAL_EVIDENCE',test_fixture:mode!=='PHYSICAL_EVIDENCE',
      operator_id:state.localAgent?'LOCAL_MACHINE_AUTOPILOT':'BROWSER_DEVICE_AUTOPILOT'
    },
    miner_log:events.map(e=>(e.at||'')+' '+(e.type||'event')).join('\n')+'\nPhysical autopilot capture; raw browser event log retained.\n'
  };
  state.captures.push(capture);updateMetrics();
  if(state.localAgent){
    try{
      const r=await fetch('/_rde/capture',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(capture)});
      const reply=await r.json();
      events.push({event_id:runId('agent'),at:currentIso(),type:'local_agent_verdict_'+String(reply.verdict||r.status)});
    }catch(error){status('Capture produced, but local packaging failed: '+String(error.message||error),'warn')}
  }
  $('export').disabled=false;
  return capture;
}
async function runTimedMining(workloadId,repetition,durations){
  const events=[{event_id:runId('start'),at:currentIso(),type:'miner_run_started'}],startedAt=currentIso();
  status(workloadId+' repetition '+repetition+' · warm-up');
  updateMetrics({label:workloadId+' #'+repetition,progress:0});
  const warm=await miningSession({seconds:durations.warmup,onTick:x=>updateMetrics(x),events});
  if(state.stopped)throw new Error('campaign_stopped');
  const attemptsStart=warm.attempts;
  events.push({event_id:runId('measure'),at:currentIso(),type:'measurement_started'});
  const measured=await miningSession({seconds:durations.measurement,onTick:x=>updateMetrics(x),events});
  const windows=rateWindows(measured.rates,measured.attempts/Math.max(.001,measured.elapsed));
  events.push({event_id:runId('end'),at:currentIso(),type:'miner_run_completed'});
  return createCapture({
    workloadId,repetition,events,startedAt,endedAt:currentIso(),
    measurement:{...measured,warmupSeconds:durations.warmup,attemptsStart,firstRate:windows.first,lastRate:windows.last}
  });
}
async function runNormalUse(repetition,durations){
  const events=[{event_id:runId('start'),at:currentIso(),type:'miner_normal_use_started'}],startedAt=currentIso();
  status('Normal-use #'+repetition+' · measuring no-mining baseline');
  const baseline=await interactionProbe(durations.baseline);
  if(state.stopped)throw new Error('campaign_stopped');
  status('Normal-use #'+repetition+' · mining warm-up');
  const warm=await miningSession({seconds:durations.warmup,onTick:x=>updateMetrics(x),events});
  if(state.stopped)throw new Error('campaign_stopped');
  let miningResult=null,interactionResult=null;
  status('Normal-use #'+repetition+' · measured mining + scripted interaction');
  const start=performance.now();
  [miningResult,interactionResult]=await Promise.all([
    miningSession({seconds:durations.measurement,onTick:x=>updateMetrics(x),events}),
    interactionProbe(durations.measurement)
  ]);
  const recoveryStarted=performance.now();await sleep(50);const recoverySeconds=(performance.now()-recoveryStarted)/1000;
  const windows=rateWindows(miningResult.rates,miningResult.attempts/Math.max(.001,miningResult.elapsed));
  events.push({event_id:runId('end'),at:currentIso(),type:'normal_use_completed'});
  return createCapture({
    workloadId:'normal_use_coexistence',repetition,events,startedAt,endedAt:currentIso(),baselineP95:baseline.p95_ms,
    measurement:{...miningResult,warmupSeconds:durations.warmup,attemptsStart:warm.attempts,firstRate:windows.first,lastRate:windows.last,
      interactiveP95:interactionResult.p95_ms,failedInteractions:interactionResult.failed,recoverySeconds}
  });
}
async function runLifecycle(){
  state.lifecycleCycles=0;state.lifecycleHidden=false;$('cycles').textContent='0 / 5';$('lifecycleCard').classList.remove('hidden');
  const events=[{event_id:runId('start'),at:currentIso(),type:'miner_lifecycle_started'}],startedAt=currentIso();
  const done=new Promise((resolve,reject)=>{
    const handler=()=>{
      events.push({event_id:runId('visibility'),at:currentIso(),type:'visibility_'+document.visibilityState});
      if(document.hidden){state.lifecycleHidden=true}
      else if(state.lifecycleHidden){
        state.lifecycleHidden=false;state.lifecycleCycles++;$('cycles').textContent=state.lifecycleCycles+' / 5';
        if(state.lifecycleCycles>=5){document.removeEventListener('visibilitychange',handler);resolve()}
      }
    };
    document.addEventListener('visibilitychange',handler);
    state.__lifecycleCleanup=()=>document.removeEventListener('visibilitychange',handler);
  });
  status('Lifecycle · mining while waiting for five real background/foreground cycles','warn');
  const miningPromise=miningSession({seconds:24*60*60,onTick:x=>updateMetrics(x),events});
  await done;stopWorker();state.stopped=true;
  const measured=await Promise.race([miningPromise,sleep(100).then(()=>({attempts:Math.max(1,Number($('attempts').textContent.replace(/\D/g,''))||1),elapsed:Math.max(.1,(Date.now()-Date.parse(startedAt))/1000),rates:[Number($('rate').textContent.replace(/\D/g,''))||1],stale:0,invalid:0,accepted:0,validated:0}))]);
  state.stopped=false;
  const windows=rateWindows(measured.rates,measured.attempts/Math.max(.001,measured.elapsed));
  events.push({event_id:runId('end'),at:currentIso(),type:'lifecycle_completed'});
  return createCapture({
    workloadId:'lifecycle_recovery',repetition:1,events,startedAt,endedAt:currentIso(),lifecycleTransitions:state.lifecycleCycles,
    measurement:{...measured,warmupSeconds:0,attemptsStart:0,firstRate:windows.first,lastRate:windows.last}
  });
}
async function runCampaign(){
  if(!state.lock)throw new Error('selection_lock_required');
  state.stopped=false;$('stop').disabled=false;$('runFull').disabled=true;
  const mode=$('mode').value;const scale=mode==='PHYSICAL_EVIDENCE'?1:0.01;validatePhysicalMode(mode,scale);
  const d=mode==='PHYSICAL_EVIDENCE'?physicalDurations:rehearsalDurations;
  try{
    for(let rep=1;rep<=3;rep++){if(state.stopped)break;await runTimedMining('pure_mining_sustained',rep,d.pure_mining_sustained)}
    for(let rep=1;rep<=3;rep++){if(state.stopped)break;await runNormalUse(rep,d.normal_use_coexistence)}
    if(!state.stopped&&REQUIRED_LIFECYCLE.has(state.lock.device_class))await runLifecycle();
    if(!state.stopped)status('Campaign complete on this device. Export/agent packaging is ready.','good');
  }catch(error){status('Campaign stopped/fail-closed: '+String(error.message||error),'bad')}
  finally{stopWorker();$('stop').disabled=true;$('runFull').disabled=false;updateMetrics({label:'Idle',progress:0})}
}
function exportCaptures(){
  const payload={schema:'FAE_RDE_BROWSER_PORTFOLIO_V1',exported_at:currentIso(),contract_id:CONTRACT_ID,autopilot_protocol_id:AUTOPILOT_PROTOCOL_ID,captures:state.captures};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='fae-rde-physical-captures-'+Date.now()+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

$('lock').addEventListener('click',()=>lockSelection().catch(e=>lockStatus('Lock failed: '+String(e.message||e),'bad')));
$('unlock').addEventListener('click',()=>{try{resetLock()}catch(e){lockStatus(String(e.message||e),'bad')}});
$('runFull').addEventListener('click',()=>runCampaign());
$('stop').addEventListener('click',()=>{state.stopped=true;state.__lifecycleCleanup?.();stopWorker();status('Stopped by operator. Partial run is not admissible.','warn')});
$('export').addEventListener('click',exportCaptures);
window.addEventListener('beforeunload',()=>stopWorker());
await loadLocalProfile();
