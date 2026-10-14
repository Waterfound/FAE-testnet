// Candidate-only public-copy assurance. This does not certify any runtime or legal status.
import {createHash} from 'node:crypto';
export const FROZEN=Object.freeze({
 main_sha:'6d0c3956fdf72cd2e7543eee2539397ed5c0e699',
 explorer_config_blob:'66ce29d1c50715d9f1d4b4edca206f6c3a695aad',
 deployment_id:'dpl_6HNpKeER3NYumrNwfV88Sx8oXYp1',
 public_alias:'fairyelf-fae-testnet.vercel.app',
 binding:'LOCAL_DEV',
 deployment:'NOT_LIVE'
});
export function gitBlobSha(content){
 const data=Buffer.from(content,'utf8');
 return createHash('sha1').update(Buffer.from('blob '+data.length+'\0')).update(data).digest('hex');
}
export function verifyPinnedConfig(content){
 const errors=[];
 if(typeof content!=='string'||gitBlobSha(content)!==FROZEN.explorer_config_blob)
  errors.push('explorer-config: source blob drift');
 let x;
 try{x=JSON.parse(content)}catch{return [...errors,'explorer-config: invalid JSON']}
 if(x.binding_state!==FROZEN.binding||x.deployment_state!==FROZEN.deployment||
    x.api_base!=='http://127.0.0.1:8787'||x.source_revision!==null||x.read_only!==true)
  errors.push('explorer-config: unverified operational binding');
 return errors;
}
function plain(s){
 return String(s).normalize('NFKC').replace(/<\s*(?:script|style)\b[^>]*>[\s\S]*?<\s*\/\s*(?:script|style)\s*>/gi,' ')
 .replace(/<[^>]*>/g,' ').replace(/[\u200b-\u200d\ufeff]/g,'').replace(/[*_`~]/g,'')
 .replace(/\s+/g,' ').toLowerCase();
}
export function reviewExplorerClaim(copy){
 const t=plain(copy),bad=[];
 const patterns=[
 /\b(?:the\s+)?explorer\s+(?:reads|serves|shows|uses|provides)\b.{0,100}\b(?:independent(?:ly)?(?:\s+validated)?\s+node|validated\s+node)\b/gi,
 /\b(?:blocks|transactions|addresses|rewards)\b.{0,125}\bfrom\s+independently\s+validated\s+node\s+state\b/gi
 ];
 for(const re of patterns)for(const match of t.matchAll(re)){
  const prefix=t.slice(Math.max(0,match.index-70),match.index);
  if(/(?:\bwill\s+|\bwould\s+|\bmay\s+|\bcould\s+|\bshould\s+|\bnot\s+yet\s+|\bdoes\s+not\s+|\bunverified\s+|\bmisleading\s*:\s*(?:the\s+)?|\bincorrect\s*:\s*(?:the\s+)?)$/i.test(prefix))continue;
  bad.push('explorer: unbound NOT_LIVE independent-node runtime claim');
 }
 return [...new Set(bad)];
}