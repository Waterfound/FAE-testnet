'use strict';

window.FAENodeConfig=(()=>{
  const DEFAULT='https://wfwwotuhectwknvbvgif.supabase.co/functions/v1/fae-public-testnet-v4';
  const STORAGE_KEY='fae-public-v4-node-url';

  function normalize(value){
    const url=new URL(String(value||'').trim());
    if(!['https:','http:'].includes(url.protocol))throw Error('FAE node must use HTTP(S)');
    if(url.username||url.password)throw Error('FAE node URL must not contain credentials');
    return url.toString().replace(/\/$/,'');
  }

  function current(){
    const query=new URLSearchParams(location.search).get('node');
    if(query){
      try{return normalize(query)}catch{}
    }
    const saved=localStorage.getItem(STORAGE_KEY);
    if(saved){
      try{return normalize(saved)}catch{localStorage.removeItem(STORAGE_KEY)}
    }
    return DEFAULT;
  }

  async function verify(value){
    const base=normalize(value);
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),5000);
    try{
      const response=await fetch(base+'/status',{signal:controller.signal,cache:'no-store'});
      const payload=await response.json();
      if(!response.ok||payload.network!=='fairyelf-public-testnet-v4')throw Error('Endpoint is not an FAE public testnet v4 node');
      return{base,status:payload};
    }finally{clearTimeout(timeout)}
  }

  async function set(value){
    const checked=await verify(value);
    localStorage.setItem(STORAGE_KEY,checked.base);
    return checked;
  }

  function reset(){localStorage.removeItem(STORAGE_KEY)}

  return{DEFAULT,current,verify,set,reset};
})();
