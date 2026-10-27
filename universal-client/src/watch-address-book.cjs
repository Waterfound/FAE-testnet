'use strict';
// Public-only address catalog; never stores recovery material or signing authority.
const fs=require('node:fs/promises'),path=require('node:path');
const {constants}=require('node:fs');
const {randomBytes}=require('node:crypto');
const ADDRESS=/^faet1[023456789acdefghjklmnpqrstuvwxyz]{25,85}$/;
const FORMAT='TS_PUBLIC_WATCH_ONLY_V1';
const MAX=32;
function address(a){if(typeof a!=='string'||!ADDRESS.test(a))throw Error('Invalid public FAE address');return a}
function alias(a){if(typeof a!=='string'||a.length<1||a.length>40||a!==a.trim()||/[\u0000-\u001f\u007f<>]/.test(a))throw Error('Invalid watch-only alias');return a}
function result(a){return {network:'fairyelf-public-testnet-v4',kind:'watch_only',entries:a.map(x=>({...x}))}}
class WatchAddressBook {
 constructor(root){
   if(!path.isAbsolute(root))throw Error('userData must be absolute');
   this.root=root;this.file=path.join(root,'watch-addresses.json');this.rows=null;this.queue=Promise.resolve();
 }
 async load(){
   if(this.rows!==null)return result(this.rows);
   let text;
   try{
     const st=await fs.lstat(this.file);
     if(!st.isFile()||st.isSymbolicLink()||st.size<2||st.size>16384)throw Error('Unsafe local address catalog');
     const handle=await fs.open(this.file,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
     try{if((await handle.stat()).size!==st.size)throw Error('Catalog changed during read');text=await handle.readFile('utf8')}
     finally{await handle.close()}
   }catch(e){if(e.code==='ENOENT'){this.rows=[];return result(this.rows)}throw e}
   let parsed;
   try{parsed=JSON.parse(text)}catch{throw Error('Corrupt watch-only catalog, refusing reset')}
   if(parsed?.format!==FORMAT||!Array.isArray(parsed.rows)||parsed.rows.length>MAX)throw Error('Invalid watch-only format');
   const seen=new Set();
   this.rows=parsed.rows.map(v=>{
     if(!v||typeof v!=='object'||Array.isArray(v)||typeof v.hidden!=='boolean')throw Error('Invalid saved entry');
     const a=address(v.address),n=alias(v.alias);
     if(seen.has(a))throw Error('Duplicate saved address');
     seen.add(a);return {address:a,alias:n,hidden:v.hidden}
   });
   return result(this.rows);
 }
 async save(next){
   await fs.mkdir(this.root,{recursive:true,mode:0o700});
   const temp=path.join(this.root,'.watch-'+randomBytes(8).toString('hex')+'.tmp');
   const h=await fs.open(temp,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|(constants.O_NOFOLLOW||0),0o600);
   try{await h.writeFile(JSON.stringify({format:FORMAT,rows:next})+'\n');await h.sync()}
   finally{await h.close()}
   try{await fs.rename(temp,this.file)}catch(e){await fs.unlink(temp).catch(()=>{});throw e}
   if(process.platform!=='win32'){
     const d=await fs.open(this.root,constants.O_RDONLY);try{await d.sync()}finally{await d.close()}
   }
   this.rows=next;return result(next)
 }
 async mutate(action){
   const task=this.queue.then(async()=>{
     await this.load();const next=this.rows.map(x=>({...x}));action(next);
     if(next.length>MAX)throw Error('Public address limit reached');
     return this.save(next)
   });
   this.queue=task.then(()=>{},()=>{});return task
 }
 async list(){await this.queue;return this.load()}
 add(a,n){address(a);alias(n);return this.mutate(rows=>{
   if(rows.some(v=>v.address===a))throw Error('Address already saved');
   rows.push({address:a,alias:n,hidden:false})
 })}
 update(a,change){
   address(a);
   if(!change||typeof change!=='object'||Array.isArray(change)||
     !Object.keys(change).length||Object.keys(change).some(k=>!['hidden','alias'].includes(k)))
     throw Error('Invalid watch-only update');
   if(change.hidden!==undefined&&typeof change.hidden!=='boolean')throw Error('Invalid visibility');
   if(change.alias!==undefined)alias(change.alias);
   return this.mutate(rows=>{
     const row=rows.find(v=>v.address===a);if(!row)throw Error('Unknown public address');
     if(change.hidden!==undefined)row.hidden=change.hidden;
     if(change.alias!==undefined)row.alias=change.alias
   })
 }
 remove(a){address(a);return this.mutate(rows=>{
   const i=rows.findIndex(v=>v.address===a);if(i<0)throw Error('Unknown public address');rows.splice(i,1)
 })}
}
module.exports={WatchAddressBook,address,alias};
