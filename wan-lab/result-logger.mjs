#!/usr/bin/env node
import http from 'node:http';
const PORT=Number(process.env.PORT||10000);
const SOURCE=(process.env.FAE_RESULT_URL||'https://fae-wan-controller.onrender.com/result').replace(/\/$/,'');
let last={ok:false,status:'warming',source:SOURCE};
let printed='';
async function poll(){try{const r=await fetch(SOURCE,{headers:{'cache-control':'no-cache'}});const j=await r.json();last=j;const s=JSON.stringify(j);if(j.status!=='warming'&&s!==printed){printed=s;console.log(JSON.stringify({event:'FAE_WAN_RESULT_PROXY',report:j}))}}catch(e){last={ok:false,status:'poll_error',error:String(e?.message||e),source:SOURCE}}}
setInterval(()=>poll(),2000).unref();poll();
http.createServer((req,res)=>{res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(last))}).listen(PORT,'0.0.0.0',()=>console.log(`FAE WAN result logger listening ${PORT}`));
