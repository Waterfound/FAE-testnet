export async function runFallbackObserverTick({
  nodes,state,fetchJson,appendEvents,nowMs=Date.now(),boundMs=180000
}){
  if(!Array.isArray(nodes)||nodes.length!==3)throw new Error('three_nodes_required');
  const next=structuredClone(state||{});
  const emitted=[],status=[];
  const emit=(event,payload={})=>{const row={event,monitor_role:'observer',at:new Date(nowMs).toISOString(),at_ms:nowMs,...payload};emitted.push(row);return row};

  for(const node of nodes){
    const s=next[node.name]||{last_seq:0,last_success_ms:null,outage_open_ms:null,fail_emitted:false};
    try{
      const [eventsPayload,meta]=await Promise.all([
        fetchJson(`${node.url.replace(/\/$/,'')}/v3/events?after_seq=${Number(s.last_seq)||0}&limit=5000`),
        fetchJson(`${node.url.replace(/\/$/,'')}/v3/meta`)
      ]);
      if(s.outage_open_ms!==null&&s.last_success_ms!==null){
        const upperBoundMs=nowMs-s.last_success_ms;
        emit('FAE_V3_OBSERVER_TRANSPORT_RECOVERED',{node:node.name,upper_bound_duration_ms:upperBoundMs,last_success_ms:s.last_success_ms,first_failed_observation_ms:s.outage_open_ms});
        if(upperBoundMs>boundMs)emit('FAE_V3_FAIL',{reason:'observer_transport_gap_upper_bound_exceeded',node:node.name,duration_ms:upperBoundMs,bound_ms:boundMs});
      }
      for(const e of eventsPayload.events||[])emitted.push({...e,observer_collected_at:new Date(nowMs).toISOString(),observer_collected_at_ms:nowMs});
      s.last_seq=Math.max(Number(s.last_seq)||0,Number(eventsPayload.last_seq)||0,...(eventsPayload.events||[]).map(e=>Number(e.seq)||0));
      s.last_success_ms=nowMs;s.outage_open_ms=null;s.fail_emitted=false;
      status.push({node:node.name,ok:true,boot_id:meta.boot_id,height:meta.status?.height,tip:meta.status?.tip_hash,last_seq:s.last_seq});
    }catch(error){
      if(s.outage_open_ms===null){
        s.outage_open_ms=nowMs;
        emit('FAE_V3_OBSERVER_TRANSPORT_LOSS',{node:node.name,error:error.message,last_success_ms:s.last_success_ms});
      }
      const upperBoundMs=s.last_success_ms===null?null:nowMs-s.last_success_ms;
      if(upperBoundMs!==null&&upperBoundMs>boundMs&&!s.fail_emitted){
        s.fail_emitted=true;
        emit('FAE_V3_FAIL',{reason:'observer_transport_gap_upper_bound_exceeded',node:node.name,duration_ms:upperBoundMs,bound_ms:boundMs});
      }
      status.push({node:node.name,ok:false,error:error.message,last_seq:s.last_seq,upper_bound_gap_ms:upperBoundMs});
    }
    next[node.name]=s;
  }
  emit('FAE_V3_HEARTBEAT',{nodes:status});
  await appendEvents(emitted);
  return{state:next,events:emitted,status,failed:emitted.some(e=>e.event==='FAE_V3_FAIL')};
}
