#!/usr/bin/env node
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {hashHex,leadingZeroBits} from '../node/authoritative/crypto.mjs';

const role=(process.env.FAE_V3_ROLE||'').trim();
if(!['controller','observer'].includes(role))throw new Error('FAE_V3_ROLE must be controller or observer');
const runId=(process.env.FAE_V3_RUN_ID||'PREPARED_NOT_STARTED').trim();
const bootId=randomUUID(),startedAt=new Date().toISOString();
const port=Number(process.env.PORT||10000);
const boundMs=180_000,pollMs=1000,heartbeatMs=10_000;
const nodes=[
  ['node-a',process.env.FAE_V3_NODE_A],
  ['node-b',process.env.FAE_V3_NODE_B],
  ['node-c',process.env.FAE_V3_NODE_C]
].map(([name,url])=>({name,url:String(url||'').replace(/\/$/,'')})); 
if(nodes.some(n=>!/^https?:\/\//.test(n.url)))throw new Error('FAE_V3_NODE_A/B/C must be absolute URLs');

const peerMonitor=(process.env.FAE_V3_PEER_MONITOR_URL||'').replace(/\/$/,'');
const t0=Date.parse(process.env.FAE_V3_T0_UTC||'');
const runStarted=Number.isFinite(t0);
const startHeight=Number(process.env.FAE_V3_START_HEIGHT);
const minerAddress=(process.env.FAE_V3_MINER_ADDRESS||'').trim();
const blockIntervalMs=300_000;
if(runStarted&&role==='controller'&&(!Number.isSafeInteger(startHeight)||startHeight<0||!minerAddress))throw new Error('started controller requires FAE_V3_START_HEIGHT and FAE_V3_MINER_ADDRESS');

const state=new Map(nodes.map(n=>[n.name,{reachable:null,bootId:null,height:null,tip:null,lastHealthyAt:null,outageStart:null,recoveryStart:null}]));
const blockSeen=new Map();
let lastHeartbeat=0,lastPeerPing=0,lastMineSlot=-1,failed=false,loopBusy=false;

function emit(event,payload={}){console.log(JSON.stringify({event,run_id:runId,monitor_role:role,monitor_boot_id:bootId,render_instance_id:process.env.RENDER_INSTANCE_ID||null,render_git_commit:process.env.RENDER_GIT_COMMIT||null,at:new Date().toISOString(),...payload}))}
emit('FAE_V3_MONITOR_BOOT',{process_started_at:startedAt,run_started:runStarted,t0_utc:runStarted?new Date(t0).toISOString():null});

async function getMeta(node,anchorHeight){
  const q=anchorHeight&&anchorHeight>0?`?anchor_height=${anchorHeight}`:'';
  const response=await fetch(`${node.url}/v3/meta${q}`,{signal:AbortSignal.timeout(4000)});
  if(!response.ok)throw new Error(`http_${response.status}`);
  return response.json();
}
function consensusOf(rows){
  const reachable=rows.filter(r=>r.ok);
  if(!reachable.length)return null;
  const groups=new Map();
  for(const r of reachable){const key=`${r.meta.status.height}:${r.meta.status.tip_hash}`;groups.set(key,(groups.get(key)||0)+1)}
  const [key,count]=[...groups.entries()].sort((a,b)=>b[1]-a[1]||b[0].localeCompare(a[0]))[0];
  const [height,...hashParts]=key.split(':');
  return{height:Number(height),tip:hashParts.join(':'),votes:count};
}
function observeBlock(nodeName,meta,now){
  const tip=meta.status.tip_hash,height=meta.status.height;
  if(!tip||height<=0)return;
  let row=blockSeen.get(tip);
  if(!row){row={height,firstSeen:now,nodes:new Map()};blockSeen.set(tip,row);emit('FAE_V3_TIP_FIRST_SEEN',{node:nodeName,height,hash:tip})}
  if(!row.nodes.has(nodeName))row.nodes.set(nodeName,now);
  if(row.nodes.size===3&&!row.emitted){
    row.emitted=true;const times=[...row.nodes.values()];
    emit('FAE_V3_BLOCK_PROPAGATED',{height:row.height,hash:tip,propagation_ms:Math.max(...times)-Math.min(...times)});
  }
}
function markFail(reason,payload){
  if(failed)return;
  failed=true;
  emit('FAE_V3_FAIL',{reason,...payload});
}
async function mine(nodeUrl){
  const templateResponse=await fetch(`${nodeUrl}/template?address=${encodeURIComponent(minerAddress)}`,{signal:AbortSignal.timeout(5000)});
  const template=await templateResponse.json();if(!templateResponse.ok)throw new Error(template.error||`template_http_${templateResponse.status}`);
  let nonce=0,hash='';
  for(;nonce<20_000_000;nonce++){hash=hashHex({...template.header,nonce});if(leadingZeroBits(hash)>=template.header.difficulty_bits)break}
  if(nonce>=20_000_000)throw new Error('pow_search_exhausted');
  const response=await fetch(`${nodeUrl}/submit-block`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({header:template.header,nonce,hash,txids:template.txids||[],coinbase_outputs:template.coinbase_outputs??null}),signal:AbortSignal.timeout(8000)});
  const body=await response.json();if(!response.ok)throw new Error(body.error||`submit_http_${response.status}`);
  return body;
}
async function maybeMine(rows,now){
  if(role!=='controller'||!runStarted||now<t0)return;
  const slot=Math.floor((now-t0)/blockIntervalMs);
  if(slot<1||slot===lastMineSlot)return;
  const slotStart=t0+slot*blockIntervalMs;
  const latestTs=Math.max(...rows.filter(r=>r.ok).flatMap(r=>r.meta.tail||[]).map(b=>Number(b.timestamp_ms)||0),0);
  lastMineSlot=slot;
  if(latestTs>=slotStart){emit('FAE_V3_MINE_SLOT_SKIPPED',{slot,reason:'block_already_observed_in_slot'});return}
  const target=nodes[(slot-1)%nodes.length];
  try{
    const result=await mine(target.url);
    emit('FAE_V3_BLOCK_MINED',{slot,node:target.name,height:result.height,hash:result.hash});
  }catch(error){
    emit('FAE_V3_MINE_ERROR',{slot,node:target.name,error:error.message});
  }
}

async function sample(){
  if(loopBusy)return;loopBusy=true;
  try{
    const now=Date.now();
    const rows=await Promise.all(nodes.map(async node=>{
      const prev=state.get(node.name);
      try{return{node,ok:true,meta:await getMeta(node,prev.height)}}catch(error){return{node,ok:false,error:error.message}}
    }));
    const consensus=consensusOf(rows);

    for(const row of rows){
      const s=state.get(row.node.name);
      if(!row.ok){
        if(s.reachable!==false){
          s.outageStart=now;s.recoveryStart=s.recoveryStart??now;
          emit('FAE_V3_TRANSPORT_LOSS',{node:row.node.name,error:row.error,previous_height:s.height,previous_tip:s.tip});
        }
        s.reachable=false;
        if(s.outageStart&&now-s.outageStart>boundMs)markFail('transient_outage_exceeded',{node:row.node.name,duration_ms:now-s.outageStart,bound_ms:boundMs});
        continue;
      }

      const m=row.meta,st=m.status;
      if(s.reachable===false&&s.outageStart){
        emit('FAE_V3_TRANSPORT_RECOVERED',{node:row.node.name,duration_ms:now-s.outageStart,height:st.height,tip:st.tip_hash});
        s.outageStart=null;
      }
      if(s.bootId&&s.bootId!==m.boot_id){
        s.recoveryStart=s.recoveryStart??now;
        emit('FAE_V3_NODE_RESTART_OBSERVED',{node:row.node.name,previous_boot_id:s.bootId,new_boot_id:m.boot_id,render_instance_id:m.render_instance_id,height:st.height,tip:st.tip_hash});
      }
      if(s.height!==null){
        if(st.height<s.height){
          s.recoveryStart=s.recoveryStart??now;
          emit('FAE_V3_STATE_REGRESSION_OBSERVED',{node:row.node.name,previous_height:s.height,height:st.height,previous_tip:s.tip,tip:st.tip_hash});
        }else if(s.height>0&&m.anchor&&m.anchor.hash!==s.tip){
          emit('FAE_V3_REORG_OBSERVED',{node:row.node.name,anchor_height:s.height,previous_tip:s.tip,new_hash_at_anchor:m.anchor.hash,current_height:st.height,current_tip:st.tip_hash});
        }
      }

      observeBlock(row.node.name,m,now);
      s.reachable=true;s.bootId=m.boot_id;s.height=st.height;s.tip=st.tip_hash;s.lastHealthyAt=now;

      if(s.recoveryStart&&consensus?.votes>=2&&st.height===consensus.height&&st.tip_hash===consensus.tip){
        const duration=now-s.recoveryStart;
        emit('FAE_V3_NODE_RECOVERED',{node:row.node.name,duration_ms:duration,height:st.height,tip:st.tip_hash,bound_ms:boundMs});
        if(duration>boundMs)markFail('recovery_exceeded',{node:row.node.name,duration_ms:duration,bound_ms:boundMs});
        s.recoveryStart=null;
      }else if(s.recoveryStart&&now-s.recoveryStart>boundMs){
        markFail('recovery_exceeded',{node:row.node.name,duration_ms:now-s.recoveryStart,bound_ms:boundMs});
      }
    }

    if(now-lastHeartbeat>=heartbeatMs){
      lastHeartbeat=now;
      emit('FAE_V3_HEARTBEAT',{failed,run_started:runStarted,nodes:rows.map(r=>r.ok?{node:r.node.name,ok:true,boot_id:r.meta.boot_id,instance_id:r.meta.render_instance_id,height:r.meta.status.height,tip:r.meta.status.tip_hash,peers:r.meta.status.configured_peers}:{node:r.node.name,ok:false,error:r.error}),consensus});
    }
    await maybeMine(rows,now);
    if(peerMonitor&&now-lastPeerPing>=60_000){
      lastPeerPing=now;
      fetch(`${peerMonitor}/v3/health`,{signal:AbortSignal.timeout(4000)}).catch(()=>{});
    }
  }finally{loopBusy=false}
}
setInterval(()=>void sample(),pollMs).unref?.();void sample();

const server=http.createServer((req,res)=>{
  const url=new URL(req.url||'/','http://monitor.invalid');
  if(url.pathname==='/v3/health'||url.pathname==='/health'){
    res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});
    return res.end(JSON.stringify({ok:true,run_id:runId,role,boot_id:bootId,failed,run_started:runStarted,at:new Date().toISOString()}));
  }
  if(url.pathname==='/v3/monitor-meta'){
    res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});
    return res.end(JSON.stringify({ok:true,run_id:runId,role,boot_id:bootId,failed,run_started:runStarted,t0_utc:runStarted?new Date(t0).toISOString():null,state:Object.fromEntries(state),at:new Date().toISOString()}));
  }
  res.writeHead(404,{'content-type':'application/json'});res.end(JSON.stringify({ok:false,error:'not_found'}));
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'0.0.0.0',()=>{server.off('error',reject);resolve()})});
emit('FAE_V3_MONITOR_ONLINE',{port});
