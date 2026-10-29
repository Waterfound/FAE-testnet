// Test-runner-only diagnostic: classifies genuine loopback fetch transport errors.
// NEVER import this in Electron, consensus, network runtime or production.
import diagnosticsChannel from 'node:diagnostics_channel';
const originalFetch=globalThis.fetch;
if(process.env.TS_PSR11_DIAG_SOCKET_META==='1'){
  // Test-runner-only metadata, no headers, query strings, ports, bodies or credentials.
  // Undici diagnostic callbacks must remain synchronous, bounded and nonthrowing.
  const seenSockets=new WeakMap(),requestSockets=new WeakMap();
  let nextSocket=0;
  function boundedMs(value){
    return Math.min(600000,Math.max(0,Number.isFinite(value)?Math.round(value):0));
  }
  function safeReason(error){
    const code=String(error?.code||error?.cause?.code||'UNKNOWN');
    return /^[A-Z0-9_]{2,48}$/.test(code)?code:'REDACTED';
  }
  function safeRoute(request){
    try{
      const origin=new URL(String(request?.origin));
      if(!['127.0.0.1','localhost','::1'].includes(origin.hostname)||origin.protocol!=='http:')return null;
      const route=String(request.path||'').split('?')[0];
      return ['/status','/template','/submit-block','/submit-tx','/balance','/transactions'].includes(route)?route:null;
    }catch{return null}
  }
  function observeSocket(socket,record){
    if(typeof socket?.once!=='function')return;
    socket.once('error',error=>{
      try{
        console.error(JSON.stringify({
          kind:'TS_PSR11_SOCKET_EVENT_ERROR',socket_sequence:record.id,
          prior_request_count:record.count,reason:safeReason(error),
          since_last_send_ms:boundedMs(Date.now()-(record.lastSendAt||Date.now()))
        }));
      }catch{}
    });
    socket.once('close',hadError=>{
      try{
        record.closed=true;
        console.error(JSON.stringify({
          kind:'TS_PSR11_SOCKET_EVENT_CLOSE',socket_sequence:record.id,
          prior_request_count:record.count,had_error:Boolean(hadError),
          since_last_send_ms:boundedMs(Date.now()-(record.lastSendAt||Date.now()))
        }));
      }catch{}
    });
  }
  diagnosticsChannel.channel('undici:client:sendHeaders').subscribe(({request,socket})=>{
    try{
      const route=safeRoute(request);
      if(!route||!socket)return;
      let record=seenSockets.get(socket);
      if(!record){
        record={id:++nextSocket,count:0,lastSendAt:null,closed:false};
        seenSockets.set(socket,record);
        observeSocket(socket,record);
      }
      const now=Date.now();
      const idleMs=record.lastSendAt===null?0:boundedMs(now-record.lastSendAt);
      record.count++;record.lastSendAt=now;
      requestSockets.set(request,{route,id:record.id,count:record.count,socket,record,idleMs});
      if(route==='/submit-block')console.error(JSON.stringify({
        kind:'TS_PSR11_SOCKET_SEND',route,socket_sequence:record.id,
        request_on_socket:record.count,reused:record.count>1,idle_since_prior_send_ms:idleMs,
        destroyed_at_send:Boolean(socket.destroyed),closed_event_before_send:record.closed,
        readable_ended_at_send:Boolean(socket.readableEnded),
        writable_ended_at_send:Boolean(socket.writableEnded)
      }));
    }catch{}
  });
  diagnosticsChannel.channel('undici:request:error').subscribe(({request,error})=>{
    try{
      const tracked=requestSockets.get(request);
      if(!tracked)return;
      console.error(JSON.stringify({
        kind:'TS_PSR11_SOCKET_ERROR',route:tracked.route,socket_sequence:tracked.id,
        request_on_socket:tracked.count,reused:tracked.count>1,
        idle_since_prior_send_ms:tracked.idleMs,
        destroyed_at_error:Boolean(tracked.socket.destroyed),
        close_event_before_error:Boolean(tracked.record.closed),
        readable_ended_at_error:Boolean(tracked.socket.readableEnded),
        writable_ended_at_error:Boolean(tracked.socket.writableEnded),
        reason:safeReason(error)
      }));
    }catch{}
  });
  diagnosticsChannel.channel('undici:client:disconnect').subscribe(({socket})=>{
    try{
      const record=seenSockets.get(socket);
      if(!record)return;
      console.error(JSON.stringify({
        kind:'TS_PSR11_SOCKET_DISCONNECT',socket_sequence:record.id,
        prior_request_count:record.count,close_event_observed:record.closed,
        since_last_send_ms:boundedMs(Date.now()-(record.lastSendAt||Date.now()))
      }));
    }catch{}
  });
}

if(typeof originalFetch!=='function')throw Error('Node built-in fetch required');
const CLASS=Object.freeze(new Set(['/status','/template','/submit-block','/submit-tx','/balance','/spendable','/transactions','/peer/hello','/peer/channel','/peer/secure','/headers','/blocks']));
function safeCode(error){
  const codes=[error?.cause?.code,error?.cause?.cause?.code,error?.code];
  return codes.find(x=>typeof x==='string'&&/^[A-Z0-9_]{2,48}$/.test(x))||'UNKNOWN_TRANSPORT_ERROR';
}
globalThis.fetch=async function isolatedTransportDiagnostic(input,options){
  const started=Date.now();
  let requestOptions=options;
  // Differential *diagnosis only*: ensure each local HTTP request creates a
  // fresh connection. Do not use this preloader in the product or canonical CI.
  if(process.env.TS_PSR11_DIAG_FRESH_CONNECTION==='1'){
    try{
      const u=new URL(typeof input==='string'?input:input?.url);
      if(u.protocol==='http:'&&(u.hostname==='127.0.0.1'||u.hostname==='localhost')){
        const headers=new Headers(options?.headers);
        headers.set('connection','close');
        requestOptions={...options,headers};
      }
    }catch{}
  }
  try{return await originalFetch(input,requestOptions)}
  catch(error){
    let route='other';
    try{
      const u=new URL(typeof input==='string'?input:input?.url);
      if((u.hostname==='127.0.0.1'||u.hostname==='localhost')&&CLASS.has(u.pathname))
        route=u.pathname;
    }catch{}
    const payload={kind:'TS_LOCAL_FETCH_FAILURE',route,reason:safeCode(error),
      elapsed_ms:Math.min(600000,Math.max(0,Date.now()-started))};
    // Redacted: no port, full URL, credentials, body, tx, mnemonic or peer ID.
    console.error(JSON.stringify(payload));
    throw error;
  }
};
