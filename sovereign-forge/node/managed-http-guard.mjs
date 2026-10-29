// Protected-node security-owner proposal: opt-in browser-origin and DNS-rebinding
// guard for the native managed-client's ORIGINAL HTTP surface.
// This is an exposure reduction, NOT OS-level peer authentication: another
// local process without browser headers can still reach mutation endpoints.
export function managedHttpRequestAllowed(req){
  const socket=req?.socket,headers=req?.headers;
  if(!socket||!headers||typeof headers!=='object')return false;
  if(socket.remoteAddress!=='127.0.0.1'&&
     socket.remoteAddress!=='::ffff:127.0.0.1')return false;
  if(!Number.isSafeInteger(socket.localPort)||socket.localPort<1||
     socket.localPort>65535)return false;
  // Do not accept arbitrary DNS names pointing at localhost.
  // Managed native client and original Node miner use explicit IPv4 loopback.
  if(headers.host!=='127.0.0.1:'+socket.localPort)return false;
  if(typeof req.url!=='string'||req.url.length>4096)return false;
  if(req.method==='OPTIONS')return false;
  // No browser origin, cross-site navigation, service worker or preflight
  // should acquire local-node mutation authority. Native Node fetch() may
  // send Sec-Fetch-Mode: cors, therefore only Site/Dest are guarded.
  if(headers.origin!==undefined||headers.referer!==undefined||
     headers['sec-fetch-site']!==undefined||
     headers['sec-fetch-dest']!==undefined||
     headers['access-control-request-method']!==undefined||
     headers['access-control-request-headers']!==undefined)return false;
  return true;
}
export function managedHttpCors(methods='GET,POST,OPTIONS'){
  // Managed native IPC mode has no browser CORS audience.
  return {'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store','x-content-type-options':'nosniff'};
}
