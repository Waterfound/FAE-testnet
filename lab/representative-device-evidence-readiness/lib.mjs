import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,lstat} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const rootDir=fileURLToPath(new URL('.',import.meta.url));
export const contract=JSON.parse(await readFile(new URL('./acceptance-contract.json',import.meta.url),'utf8'));
export const SHA256=/^[0-9a-f]{64}$/;
export const HEX40=/^[0-9a-f]{40}$/;
export const sha256=(bytes)=>createHash('sha256').update(bytes).digest('hex');
export const jsonText=(value)=>JSON.stringify(value,null,2)+'\n';
export async function readJson(path){return JSON.parse(await readFile(path,'utf8'))}
export async function writeJson(path,value){await mkdir(dirname(path),{recursive:true});await writeFile(path,jsonText(value))}
export async function digestFile(path){const bytes=await readFile(path);return{sha256:sha256(bytes),size_bytes:bytes.length}}
export function parseArgs(argv){
  const out={};
  for(let i=0;i<argv.length;i++){
    const arg=argv[i]; if(!arg.startsWith('--'))continue;
    const key=arg.slice(2); const next=argv[i+1];
    out[key]=next&&!next.startsWith('--')?argv[++i]:true;
  }
  return out;
}
export function isoMs(value){const ms=Date.parse(value);return Number.isFinite(ms)?ms:NaN}
export function median(values){
  const a=values.filter(Number.isFinite).sort((x,y)=>x-y);
  if(!a.length)return NaN; const mid=Math.floor(a.length/2);
  return a.length%2?a[mid]:(a[mid-1]+a[mid])/2;
}
export async function ensureRegularFile(path){
  const st=await lstat(path); if(st.isSymbolicLink()||!st.isFile())throw new Error('not_regular_file');
}
export function stableEntries(entries){
  return [...entries].map(x=>({path:x.path,sha256:x.sha256,size_bytes:x.size_bytes})).sort((a,b)=>a.path.localeCompare(b.path));
}
export function manifestPayloadHash(entries){return sha256(Buffer.from(JSON.stringify(stableEntries(entries))))}
export const resolveIn=(root,rel)=>resolve(root,rel);
