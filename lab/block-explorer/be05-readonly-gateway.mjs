#!/usr/bin/env node
'use strict';

import http from 'node:http';
import {pathToFileURL} from 'node:url';

export const BE05_PUBLIC_ROUTES=Object.freeze([
  '/explorer/status',
  '/explorer/blocks',
  '/explorer/block',
  '/explorer/transaction',
  '/explorer/address',
  '/explorer/search'
]);

const ROUTES=new Set(BE05_PUBLIC_ROUTES);
const LOOPBACK_HOSTS=new Set(['127.0.0.1','localhost','[::1]','::1']);

function parseOrigin(raw,{kind}){
  let url;
  try{url=new URL(String(raw||''))}catch{throw new Error('invalid_'+kind+'_origin')}
  if(url.username||url.password||url.search||url.hash)throw new Error('invalid_'+kind+'_origin');
  if(url.pathname!=='/'&&url.pathname!=='')throw new Error('invalid_'+kind+'_origin');
  return url;
}

export function normalizeNodeOrigin(raw){
  const url=parseOrigin(raw,{kind:'node'});
  if(url.protocol!=='http:')throw new Error('node_origin_must_use_loopback_http');
  if(!LOOPBACK_HOSTS.has(url.hostname))throw new Error('node_origin_must_be_loopback');
  return url.origin;
}

export function normalizeExplorerOrigin(raw){
  const url=parseOrigin(raw,{kind:'explorer'});
  const local=LOOPBACK_HOSTS.has(url.hostname);
  if(url.protocol!=='https:'&&!(local&&url.protocol==='http:'))throw new Error('explorer_origin_requires_https');
  return url.origin;
}

function json(res,status,payload,headers={}){
  const body=Buffer.from(JSON.stringify(payload));
  res.writeHead(status,{
    'content-type':'application/json; charset=utf-8',
    'content-length':String(body.length),
    'cache-control':'no-store',
    'x-content-type-options':'nosniff',
    'referrer-policy':'no-referrer',
    ...headers
  });
  res.end(body);
}

function corsHeaders(requestOrigin,explorerOrigin){
  if(!requestOrigin)return{'access-control-allow-methods':'GET,OPTIONS','vary':'Origin'};
  if(requestOrigin!==explorerOrigin)return null;
  return{
    'access-control-allow-origin':explorerOrigin,
    'access-control-allow-methods':'GET,OPTIONS',
    'access-control-allow-headers':'accept,content-type',
    'access-control-max-age':'600',
    'vary':'Origin'
  };
}

function hasBody(req){
  const length=Number(req.headers['content-length']||0);
  return (Number.isFinite(length)&&length>0)||Boolean(req.headers['transfer-encoding']);
}

export function createReadonlyGateway({
  nodeOrigin,
  explorerOrigin,
  fetchImpl=globalThis.fetch,
  timeoutMs=12000,
  maxResponseBytes=2_000_000
}){
  if(typeof fetchImpl!=='function')throw new Error('fetch_unavailable');
  const nodeBase=normalizeNodeOrigin(nodeOrigin);
  const browserOrigin=normalizeExplorerOrigin(explorerOrigin);
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>60000)throw new Error('invalid_timeout');
  if(!Number.isSafeInteger(maxResponseBytes)||maxResponseBytes<1024||maxResponseBytes>10_000_000)throw new Error('invalid_response_limit');

  return http.createServer(async(req,res)=>{
    try{
      const url=new URL(req.url||'/', 'http://gateway.invalid');
      if(!ROUTES.has(url.pathname))return json(res,404,{ok:false,error:'public_route_not_found'});

      const requestOrigin=typeof req.headers.origin==='string'?req.headers.origin:null;
      const cors=corsHeaders(requestOrigin,browserOrigin);
      if(cors===null)return json(res,403,{ok:false,error:'origin_not_allowed'});

      if(req.method==='OPTIONS'){
        if(hasBody(req))return json(res,400,{ok:false,error:'body_not_allowed'},cors);
        res.writeHead(204,{
          'cache-control':'no-store',
          'x-content-type-options':'nosniff',
          'referrer-policy':'no-referrer',
          ...cors
        });
        return res.end();
      }

      if(req.method!=='GET')return json(res,405,{ok:false,error:'read_only'},cors);
      if(hasBody(req))return json(res,400,{ok:false,error:'body_not_allowed'},cors);

      const target=new URL(url.pathname+url.search,nodeBase);
      const controller=new AbortController();
      const timer=setTimeout(()=>controller.abort(),timeoutMs);
      let upstream;
      try{
        upstream=await fetchImpl(target,{
          method:'GET',
          headers:{accept:'application/json'},
          signal:controller.signal
        });
      }catch(error){
        return json(res,502,{ok:false,error:'node_unavailable'},cors);
      }finally{
        clearTimeout(timer);
      }

      const type=(upstream.headers.get('content-type')||'').toLowerCase();
      if(!type.startsWith('application/json'))return json(res,502,{ok:false,error:'invalid_node_content_type'},cors);
      const bytes=Buffer.from(await upstream.arrayBuffer());
      if(bytes.length>maxResponseBytes)return json(res,502,{ok:false,error:'node_response_too_large'},cors);

      res.writeHead(upstream.status,{
        'content-type':'application/json; charset=utf-8',
        'content-length':String(bytes.length),
        'cache-control':'no-store',
        'x-content-type-options':'nosniff',
        'referrer-policy':'no-referrer',
        ...cors
      });
      res.end(bytes);
    }catch(error){
      json(res,500,{ok:false,error:'gateway_internal_error'});
    }
  });
}

async function run(){
  const port=Number(process.env.PORT||process.env.FAE_BE05_GATEWAY_PORT||8080);
  if(!Number.isSafeInteger(port)||port<1||port>65535)throw new Error('invalid_gateway_port');
  const host=process.env.FAE_BE05_GATEWAY_HOST||'0.0.0.0';
  const server=createReadonlyGateway({
    nodeOrigin:process.env.FAE_BE05_NODE_ORIGIN||'http://127.0.0.1:8787',
    explorerOrigin:process.env.FAE_BE05_EXPLORER_ORIGIN
  });
  server.listen(port,host,()=>console.log('[FAE BE-05] read-only gateway listening on '+host+':'+port));
}

const invoked=process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url;
if(invoked)run().catch(error=>{console.error(error);process.exitCode=1});
