// Test-runner-only diagnostic: classifies genuine loopback fetch transport errors.
// NEVER import this in Electron, consensus, network runtime or production.
const originalFetch=globalThis.fetch;
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
