'use strict';

export const EXPLORER_NETWORK='fairyelf-public-testnet-v4';

const DIGEST=/^[0-9a-f]{64}$/;
const HEIGHT=/^[1-9]\d*$/;
const ADDRESS=/^faet1[0-9a-z]{20,100}$/;
const ALLOWED_PATHS=new Set([
  '/explorer/status',
  '/explorer/blocks',
  '/explorer/block',
  '/explorer/transaction',
  '/explorer/address',
  '/explorer/search'
]);

export class ExplorerClientError extends Error{
  constructor(code,message,{status=null,detail=null,cause=null}={}){
    super(message,{cause});
    this.name='ExplorerClientError';
    this.code=code;
    this.status=status;
    this.detail=detail;
  }
}

function normalizeBase(apiBase){
  let url;
  try{
    url=new URL(apiBase);
  }catch(error){
    throw new ExplorerClientError('invalid_api_base','Explorer API base must be an absolute HTTP(S) URL.',{cause:error});
  }
  if(!['http:','https:'].includes(url.protocol)){
    throw new ExplorerClientError('invalid_api_base','Explorer API base must use HTTP or HTTPS.');
  }
  if(url.username||url.password){
    throw new ExplorerClientError('invalid_api_base','Explorer API base must not contain credentials.');
  }
  url.hash='';
  url.search='';
  url.pathname=url.pathname.replace(/\/$/,'');
  return url.toString().replace(/\/$/,'');
}

function assertDigest(value,label){
  if(!DIGEST.test(String(value)))throw new ExplorerClientError('invalid_query',`${label} must be 64 lowercase hexadecimal characters.`);
}

function assertAddress(value){
  if(!ADDRESS.test(String(value)))throw new ExplorerClientError('invalid_query','Address must be a faet1 testnet address.');
}

function assertHeight(value){
  if(!HEIGHT.test(String(value)))throw new ExplorerClientError('invalid_query','Block height must be a positive integer.');
}

function assertLimit(limit,max=100){
  const n=Number(limit);
  if(!Number.isInteger(n)||n<1||n>max)throw new ExplorerClientError('invalid_query',`Limit must be an integer from 1 to ${max}.`);
  return n;
}

function assertBoundPayload(payload,expectedNetwork){
  if(!payload||payload.ok!==true)throw new ExplorerClientError('invalid_payload','Explorer node returned an invalid success payload.');
  if(payload.network!==expectedNetwork){
    throw new ExplorerClientError(
      'network_mismatch',
      `Expected ${expectedNetwork}, received ${String(payload.network||'unknown')}.`,
      {detail:{expected:expectedNetwork,received:payload.network??null}}
    );
  }
  if(!Number.isInteger(Number(payload.observed_tip_height))||Number(payload.observed_tip_height)<0){
    throw new ExplorerClientError('invalid_payload','Explorer payload is missing a valid observed tip height.');
  }
  if(!DIGEST.test(String(payload.observed_tip_hash))){
    throw new ExplorerClientError('invalid_payload','Explorer payload is missing a valid observed tip hash.');
  }
  return payload;
}

export function createExplorerClient({
  apiBase,
  expectedNetwork=EXPLORER_NETWORK,
  fetchImpl=globalThis.fetch
}){
  if(typeof fetchImpl!=='function')throw new ExplorerClientError('fetch_unavailable','Fetch is unavailable in this environment.');
  const base=normalizeBase(apiBase);

  async function request(path,params={}){
    if(!ALLOWED_PATHS.has(path))throw new ExplorerClientError('forbidden_path','Explorer client may only call verified /explorer/* read routes.');
    const url=new URL(base+path);
    for(const [key,value] of Object.entries(params)){
      if(value!==null&&value!==undefined&&value!=='')url.searchParams.set(key,String(value));
    }

    let response;
    try{
      response=await fetchImpl(url,{
        method:'GET',
        headers:{accept:'application/json'},
        cache:'no-store',
        credentials:'omit',
        referrerPolicy:'no-referrer'
      });
    }catch(error){
      throw new ExplorerClientError('network_error','Unable to reach the FAE Explorer node.',{cause:error});
    }

    let payload;
    try{
      payload=await response.json();
    }catch(error){
      throw new ExplorerClientError('invalid_payload','Explorer node returned non-JSON data.',{status:response.status,cause:error});
    }

    if(!response.ok){
      throw new ExplorerClientError(
        payload?.error||'request_failed',
        payload?.detail||`Explorer request failed with HTTP ${response.status}.`,
        {status:response.status,detail:payload?.detail??null}
      );
    }

    return assertBoundPayload(payload,expectedNetwork);
  }

  return Object.freeze({
    apiBase:base,
    expectedNetwork,
    status:()=>request('/explorer/status'),
    blocks:({limit=12,beforeHeight=null}={})=>request('/explorer/blocks',{
      limit:assertLimit(limit),
      before_height:beforeHeight===null?null:(assertHeight(beforeHeight),beforeHeight)
    }),
    blockByHeight:height=>request('/explorer/block',{height:(assertHeight(height),height)}),
    blockByHash:hash=>request('/explorer/block',{hash:(assertDigest(hash,'Block hash'),hash)}),
    transaction:txid=>request('/explorer/transaction',{txid:(assertDigest(txid,'TXID'),txid)}),
    address:({address,limit=30,cursor=null})=>request('/explorer/address',{
      address:(assertAddress(address),address),
      limit:assertLimit(limit),
      cursor
    }),
    search:q=>{
      const query=String(q||'').trim();
      if(!query)throw new ExplorerClientError('invalid_query','Search query is required.');
      if(query.length>160)throw new ExplorerClientError('invalid_query','Search query is too long.');
      return request('/explorer/search',{q:query});
    }
  });
}
