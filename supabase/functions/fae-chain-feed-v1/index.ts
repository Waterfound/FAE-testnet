const U=Deno.env.get('SUPABASE_URL')!;
const S=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const NETWORK='fairyelf-public-testnet-v4';
const CORS={'access-control-allow-origin':'*','access-control-allow-headers':'content-type','access-control-allow-methods':'GET,OPTIONS','content-type':'application/json; charset=utf-8','cache-control':'no-store'};
const J=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:CORS});
async function rest(path:string){const r=await fetch(U+'/rest/v1/'+path,{headers:{apikey:S,authorization:'Bearer '+S}});const t=await r.text();if(!r.ok)throw Error('db '+r.status+' '+t);return t?JSON.parse(t):null}
function clamp(v:string|null,d:number,min:number,max:number){const n=Number(v);return Number.isSafeInteger(n)?Math.max(min,Math.min(max,n)):d}
Deno.serve(async req=>{try{if(req.method==='OPTIONS')return new Response(null,{status:204,headers:CORS});if(req.method!=='GET')return J({ok:false,error:'read_only'},405);const u=new URL(req.url);const from=clamp(u.searchParams.get('from'),1,1,Number.MAX_SAFE_INTEGER),limit=clamp(u.searchParams.get('limit'),100,1,250),to=from+limit-1;
const blocks=await rest(`fae_v4_blocks?select=height,hash,previous_hash,timestamp_ms,difficulty_bits,nonce,miner_address,reward_atoms,header_json,txids&height=gte.${from}&height=lte.${to}&order=height.asc`);
const txs=await rest(`fae_v4_transactions?select=txid,network,from_address,public_key_spki,signature,inputs,outputs,fee_atoms,status,confirmed_height&status=eq.confirmed&confirmed_height=gte.${from}&confirmed_height=lte.${to}&order=confirmed_height.asc,mempool_seq.asc`);
const tip=await rest('fae_v4_blocks?select=height,hash&order=height.desc&limit=1');
return J({ok:true,feed_version:1,network:NETWORK,from,limit,tip_height:tip?.[0]?.height?Number(tip[0].height):0,tip_hash:tip?.[0]?.hash||'0'.repeat(64),blocks:blocks.map((b:any)=>({...b,height:Number(b.height),timestamp_ms:Number(b.timestamp_ms),difficulty_bits:Number(b.difficulty_bits),nonce:Number(b.nonce),reward_atoms:String(b.reward_atoms),txids:Array.isArray(b.txids)?b.txids:[]})),transactions:txs.map((t:any)=>({...t,fee_atoms:String(t.fee_atoms??0),confirmed_height:Number(t.confirmed_height)}))});}catch(e){console.error(e);return J({ok:false,error:String((e as any)?.message||e)},500)}});
