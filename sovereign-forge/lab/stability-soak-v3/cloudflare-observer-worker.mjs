import {runFallbackObserverTick} from './fallback-observer-core.mjs';

function nodes(env){return[
  {name:'node-a',url:env.FAE_V3_NODE_A},
  {name:'node-b',url:env.FAE_V3_NODE_B},
  {name:'node-c',url:env.FAE_V3_NODE_C}
].map(n=>({...n,url:String(n.url||'')}))}
async function fetchJson(url){const r=await fetch(url,{headers:{'cache-control':'no-store'}});if(!r.ok)throw new Error(`http_${r.status}`);return r.json()}
async function loadState(db){
  const {results=[]}=await db.prepare('SELECT node,last_seq,last_success_ms,outage_open_ms,fail_emitted FROM v3_observer_state').all();
  return Object.fromEntries(results.map(r=>[r.node,{last_seq:Number(r.last_seq)||0,last_success_ms:r.last_success_ms===null?null:Number(r.last_success_ms),outage_open_ms:r.outage_open_ms===null?null:Number(r.outage_open_ms),fail_emitted:Boolean(r.fail_emitted)}]));
}
async function saveState(db,state){
  const stmts=Object.entries(state).map(([node,s])=>db.prepare(
    'INSERT INTO v3_observer_state(node,last_seq,last_success_ms,outage_open_ms,fail_emitted) VALUES(?,?,?,?,?) ON CONFLICT(node) DO UPDATE SET last_seq=excluded.last_seq,last_success_ms=excluded.last_success_ms,outage_open_ms=excluded.outage_open_ms,fail_emitted=excluded.fail_emitted'
  ).bind(node,s.last_seq,s.last_success_ms,s.outage_open_ms,s.fail_emitted?1:0));
  if(stmts.length)await db.batch(stmts);
}
async function appendEvents(db,runId,rows){
  if(!rows.length)return;
  const stmts=rows.map(row=>db.prepare(
    'INSERT OR IGNORE INTO v3_evidence(run_id,node,event,event_at_ms,boot_id,seq,payload_json) VALUES(?,?,?,?,?,?,?)'
  ).bind(runId,row.node||row.node_role||null,row.event,Number(row.at_ms)||Date.parse(row.at)||Date.now(),row.boot_id||null,Number.isSafeInteger(Number(row.seq))?Number(row.seq):null,JSON.stringify(row)));
  for(let i=0;i<stmts.length;i+=50)await db.batch(stmts.slice(i,i+50));
}
async function tick(env){
  const runId=String(env.FAE_V3_RUN_ID||'PREPARED_NOT_STARTED');
  const state=await loadState(env.DB);
  const result=await runFallbackObserverTick({
    nodes:nodes(env),state,fetchJson,
    appendEvents:rows=>appendEvents(env.DB,runId,rows)
  });
  await saveState(env.DB,result.state);
  return result;
}
export default{
  async scheduled(_controller,env,ctx){ctx.waitUntil(tick(env))},
  async fetch(request,env){
    const url=new URL(request.url);
    if(url.pathname==='/health'){
      try{const row=await env.DB.prepare('SELECT COUNT(*) AS n FROM v3_evidence').first();return Response.json({ok:true,run_id:env.FAE_V3_RUN_ID||'PREPARED_NOT_STARTED,evidence_rows':Number(row?.n)||0})}
      catch(error){return Response.json({ok:false,error:error.message},{status:503})}
    }
    if(url.pathname==='/export'){
      const after=Math.max(0,Number(url.searchParams.get('after_id')||0)),limit=Math.max(1,Math.min(1000,Number(url.searchParams.get('limit')||500)));
      const {results=[]}=await env.DB.prepare('SELECT id,payload_json FROM v3_evidence WHERE id>? ORDER BY id ASC LIMIT ?').bind(after,limit).all();
      return Response.json({ok:true,events:results.map(r=>({id:r.id,...JSON.parse(r.payload_json)})),next_after_id:results.at(-1)?.id??after});
    }
    return Response.json({ok:false,error:'not_found'},{status:404});
  }
};
