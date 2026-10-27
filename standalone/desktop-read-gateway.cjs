'use strict';
const http=require('node:http');
const {randomBytes,timingSafeEqual}=require('node:crypto');
const ALLOWED=new Set(['/status','/balance','/explorer/status','/explorer/blocks','/explorer/block','/explorer/transaction','/explorer/address','/explorer/search']);
function createDesktopReadGateway({upstream}){
  const url=new URL(upstream);
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('Invalid loopback upstream');
  const key=randomBytes(32).toString('hex');let address=null;
  const respond=(res,code,value)=>{res.writeHead(code,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value))};
  const server=http.createServer(async(req,res)=>{
    if(!address||req.headers.host!==address)return respond(res,403,{ok:false,error:'host_denied'});
    if(req.headers.origin!==undefined||req.method==='OPTIONS')return respond(res,403,{ok:false,error:'browser_denied'});
    if(req.method!=='GET')return respond(res,405,{ok:false,error:'read_only'});
    const auth=req.headers['x-ts-read-token'];
    if(typeof auth!=='string'||auth.length!==key.length||!timingSafeEqual(Buffer.from(auth),Buffer.from(key)))
      return respond(res,401,{ok:false,error:'unauthorized'});
    let target;
    try{
      target=new URL(req.url,url.origin);
      if(target.origin!==url.origin||!ALLOWED.has(target.pathname)||target.hash)throw Error('Forbidden');
      for(const [k,v] of target.searchParams)
        if(!['q','limit','cursor','address','height','before_height','hash','txid'].includes(k)||v.length>120)throw Error('Selector');
    }catch{return respond(res,400,{ok:false,error:'invalid_route'})}
    try{
      const result=await fetch(target,{method:'GET',redirect:'error',signal:AbortSignal.timeout(3500)});
      if(!result.ok)return respond(res,502,{ok:false,error:'upstream_failed'});
      if(Number(result.headers.get('content-length'))>1048576)throw Error('Oversize');
      const raw=await result.text();
      if(Buffer.byteLength(raw)>1048576)throw Error('Oversize');
      const value=JSON.parse(raw);
      if(value?.network!=='fairyelf-public-testnet-v4')throw Error('Network mismatch');
      return respond(res,200,value);
    }catch{return respond(res,502,{ok:false,error:'unverified_read'})}
  });
  async function start(){
    if(address)throw Error('Already running');
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.off('error',reject);resolve()})});
    address='127.0.0.1:'+server.address().port;
    return {url:'http://'+address,key};
  }
  async function stop(){if(!server.listening)return;await new Promise(resolve=>server.close(resolve));address=null}
  return {start,stop};
}
module.exports={createDesktopReadGateway};
