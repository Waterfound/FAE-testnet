const U=Deno.env.get('SUPABASE_URL')!;
const S=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const H={'content-type':'application/json; charset=utf-8','cache-control':'no-store','access-control-allow-origin':'*','access-control-allow-methods':'GET,OPTIONS','access-control-allow-headers':'content-type'};
const J=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:H});
async function rpc(name:string,body:any={}){const r=await fetch(`${U}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:S,authorization:`Bearer ${S}`,'content-type':'application/json'},body:JSON.stringify(body)});const t=await r.text();if(!r.ok)throw Error(`rpc ${name} ${r.status} ${t}`);return t?JSON.parse(t):null}
Deno.serve(async req=>{try{
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:H});
 if(req.method!=='GET')return J({ok:false,error:'read_only'},405);
 const u=new URL(req.url); const p=u.pathname.split('/').filter(Boolean).at(-1)||'status';
 if(p==='fae-sovereign-forge-v1'||p==='status')return J(await rpc('fae_forge_status'));
 if(p==='refs')return J({ok:true,refs:await rpc('fae_forge_refs')});
 if(p==='tree')return J(await rpc('fae_forge_tree',{p_ref:u.searchParams.get('ref')||'main'}));
 if(p==='commit')return J(await rpc('fae_forge_commit',{p_ref:u.searchParams.get('ref')||'main'}));
 if(p==='file'){const path=u.searchParams.get('path');if(!path)return J({ok:false,error:'path_required'},400);const out=await rpc('fae_forge_file',{p_ref:u.searchParams.get('ref')||'main',p_path:path});return out?J(out):J({ok:false,error:'not_found'},404)}
 if(p==='changes')return J({ok:true,change_requests:await rpc('fae_forge_change_requests',{p_status:u.searchParams.get('status')||null})});
 if(p==='reviews'){const id=Number(u.searchParams.get('id'));if(!Number.isSafeInteger(id)||id<1)return J({ok:false,error:'valid_id_required'},400);return J({ok:true,reviews:await rpc('fae_forge_reviews',{p_change_request_id:id})})}
 if(p==='audit'){const limit=Math.max(1,Math.min(500,Number(u.searchParams.get('limit')||100)));return J({ok:true,events:await rpc('fae_forge_audit',{p_limit:limit})})}
 if(p==='diff'){const base=u.searchParams.get('base'),head=u.searchParams.get('head');if(!base||!head)return J({ok:false,error:'base_and_head_required'},400);return J(await rpc('fae_forge_diff',{p_base:base,p_head:head}))}
 return J({ok:false,error:'not_found',endpoints:['/status','/refs','/tree?ref=main','/commit?ref=main','/file?ref=main&path=README.md','/changes','/reviews?id=1','/audit','/diff?base=...&head=...']},404);
}catch(e){console.error(e);return J({ok:false,error:String((e as any)?.message||e)},500)}});
