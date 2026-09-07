const U=Deno.env.get('SUPABASE_URL')!;
const K=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const NET='fairyelf-public-testnet-v4';
const START_BITS=18, RETARGET=20, TARGET=180, ERA=600000;
const COIN=100000000n, INITIAL=10n*COIN;
const HRP='faet', CS='qpzry9x8gf2tvdw0s3jn54khce6mua7l', B32M=0x2bc830a3;
const E=new TextEncoder();
const H={'content-type':'application/json; charset=utf-8','cache-control':'no-store','access-control-allow-origin':'*'};
function canon(v:any):any{if(Array.isArray(v))return v.map(canon);if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,canon(v[k])]));return v}
function stable(v:any){return JSON.stringify(canon(v))}
async function sha(b:Uint8Array){return new Uint8Array(await crypto.subtle.digest('SHA-256',b))}
function hex(b:Uint8Array){return [...b].map(x=>x.toString(16).padStart(2,'0')).join('')}
async function dh(v:any){const a=await sha(E.encode(stable(v)));return hex(await sha(a))}
function lz(h:string){let n=0;for(const c of h){const v=parseInt(c,16);if(v===0){n+=4;continue}if(v<2)n+=3;else if(v<4)n+=2;else if(v<8)n++;break}return n}
function subsidy(h:number){const e=Math.floor((h-1)/ERA);return e>=63?0n:INITIAL>>BigInt(e)}
function pm(values:number[]){const G=[0x3b6a57b2,0x26508e6d,0x1ea119fa,0x3d4233dd,0x2a1462b3];let chk=1;for(const value of values){const top=chk>>>25;chk=((chk&0x1ffffff)<<5)^value;for(let i=0;i<5;i++)if((top>>>i)&1)chk^=G[i]}return chk>>>0}
function he(hrp:string){return [...hrp].map(c=>c.charCodeAt(0)>>>5).concat([0],[...hrp].map(c=>c.charCodeAt(0)&31))}
function cv(data:number[]|Uint8Array,from:number,to:number,pad=true){let acc=0,bits=0,ret:number[]=[],maxv=(1<<to)-1,maxAcc=(1<<(from+to-1))-1;for(const value of data){if(value<0||(value>>>from)!==0)throw Error('bit conversion');acc=((acc<<from)|value)&maxAcc;bits+=from;while(bits>=to){bits-=to;ret.push((acc>>>bits)&maxv)}}if(pad){if(bits)ret.push((acc<<(to-bits))&maxv)}else if(bits>=from||((acc<<(to-bits))&maxv))throw Error('padding');return ret}
function checksum(data:number[]){const mod=(pm([...he(HRP),...data,0,0,0,0,0,0])^B32M)>>>0;return Array.from({length:6},(_,i)=>(mod>>>(5*(5-i)))&31)}
function addr(payload:Uint8Array){const d=cv(payload,8,5,true);return HRP+'1'+[...d,...checksum(d)].map(v=>CS[v]).join('')}
function b64(s:string){return Uint8Array.from(atob(s),c=>c.charCodeAt(0))}
async function rest(path:string){const r=await fetch(U+'/rest/v1/'+path,{headers:{apikey:K,authorization:'Bearer '+K}});if(!r.ok)throw Error('db '+r.status+' '+await r.text());return await r.json()}
function bitsFor(prev:any[]){if(!prev.length)return START_BITS;let bits=Number(prev.at(-1).difficulty_bits);const next=Number(prev.at(-1).height)+1;if(next%RETARGET!==1||prev.length<RETARGET)return bits;const s=prev.slice(-RETARGET);const actual=Math.max(1,(Number(s.at(-1).timestamp_ms)-Number(s[0].timestamp_ms))/1000);const expected=TARGET*(RETARGET-1);let d=Math.round(Math.log2(expected/actual));d=Math.max(-2,Math.min(2,d));return Math.max(12,Math.min(28,bits+d))}
function txPayload(t:any){return {domain:'FAIRYELF_TX_V2',network:t.network,inputs:t.inputs,outputs:t.outputs,public_key_spki:t.public_key_spki}}
async function verifyTx(t:any){const spki=b64(t.public_key_spki), pub=await crypto.subtle.importKey('spki',spki,{name:'Ed25519'},true,['verify']);const from=addr((await sha(spki)).slice(0,20));if(from!==t.from_address)return 'from_key_mismatch';const ok=await crypto.subtle.verify({name:'Ed25519'},pub,b64(t.signature),E.encode(stable(txPayload(t))));if(!ok)return 'bad_signature';const full={version:2,network:t.network,inputs:t.inputs,outputs:t.outputs,public_key_spki:t.public_key_spki,signature:t.signature};if(await dh(full)!==t.txid)return 'txid_mismatch';return null}
Deno.serve(async req=>{try{
 const blocks=await rest('fae_v4_blocks?select=height,hash,previous_hash,timestamp_ms,difficulty_bits,nonce,miner_address,reward_atoms,header_json,txids&order=height.asc&limit=1000');
 const txs=await rest('fae_v4_transactions?select=txid,network,from_address,public_key_spki,signature,inputs,outputs,fee_atoms,status,confirmed_height&limit=1000');
 const dbu=await rest('fae_v4_utxos?select=outpoint,address,amount_atoms,created_height,spent,spent_by&limit=5000');
 const errs:string[]=[]; const seen:any[]=[]; const txm=new Map(txs.map((t:any)=>[t.txid,t])); const u=new Map<string,any>(); let prev='0'.repeat(64),issued=0n;
 for(const b of blocks){const h=Number(b.height);if(h!==seen.length+1)errs.push(`height_gap:${h}`);if(b.previous_hash!==prev)errs.push(`prev_hash:${h}`);const expectedBits=bitsFor(seen);if(Number(b.difficulty_bits)!==expectedBits)errs.push(`difficulty:${h}:${b.difficulty_bits}!=${expectedBits}`);const hh=await dh(b.header_json);if(hh!==b.hash)errs.push(`block_hash:${h}`);if(lz(b.hash)<Number(b.difficulty_bits))errs.push(`pow:${h}`);const rw=BigInt(String(b.reward_atoms));if(rw!==subsidy(h))errs.push(`subsidy:${h}`);issued+=rw;const ids=Array.isArray(b.txids)?b.txids:[];if(b.header_json?.tx_root!==undefined){if(await dh(ids)!==b.header_json.tx_root)errs.push(`tx_root:${h}`);if(Number(b.header_json.tx_count)!==ids.length)errs.push(`tx_count:${h}`)}else if(ids.length)errs.push(`legacy_tx_commitment_missing:${h}`);
   for(const id of ids){const t:any=txm.get(id);if(!t){errs.push(`missing_tx:${id}`);continue}const te=await verifyTx(t);if(te)errs.push(`${te}:${id}`);if(t.status!=='confirmed'||Number(t.confirmed_height)!==h)errs.push(`tx_confirmation:${id}`);let ins=0n;for(const op of t.inputs){const x=u.get(op);if(!x||x.spent){errs.push(`bad_input:${id}:${op}`);continue}if(x.address!==t.from_address)errs.push(`input_owner:${id}:${op}`);ins+=x.amount;x.spent=true;x.spent_by=id}let outs=0n;t.outputs.forEach((o:any,i:number)=>{const a=BigInt(String(o.amount_atoms));outs+=a;u.set(id+':'+i,{address:o.address,amount:a,height:h,spent:false,spent_by:null})});if(ins!==outs+BigInt(String(t.fee_atoms)))errs.push(`conservation:${id}`)}
   u.set(b.hash+':0',{address:b.miner_address,amount:rw,height:h,spent:false,spent_by:null});prev=b.hash;seen.push(b)}
 for(const t of txs){if(t.status==='confirmed'&&!blocks.some((b:any)=>Array.isArray(b.txids)&&b.txids.includes(t.txid)))errs.push(`orphan_confirmed_tx:${t.txid}`)}
 const dbm=new Map(dbu.map((x:any)=>[x.outpoint,x]));if(dbm.size!==u.size)errs.push(`utxo_count:${dbm.size}!=${u.size}`);for(const [op,x] of u){const d:any=dbm.get(op);if(!d){errs.push(`missing_utxo:${op}`);continue}if(d.address!==x.address||BigInt(String(d.amount_atoms))!==x.amount||Number(d.created_height)!==x.height||Boolean(d.spent)!==x.spent||(d.spent_by||null)!==(x.spent_by||null))errs.push(`utxo_mismatch:${op}`)}
 const out={ok:errs.length===0,auditor_version:1,network:NET,height:blocks.length,issued_atoms:issued.toString(),blocks_checked:blocks.length,transactions_checked:txs.length,utxos_checked:dbu.length,errors:errs.slice(0,100)};return new Response(JSON.stringify(out),{status:errs.length?409:200,headers:H});
}catch(e){return new Response(JSON.stringify({ok:false,error:String((e as any)?.message||e)}),{status:500,headers:H})}});
