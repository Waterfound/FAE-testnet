'use strict';
// V34 independently scoped, DENIAL-ONLY child-owner bridge.
// This candidate NEVER calls original node /submit-block and cannot grant a
// node mutation. Only an admitted original-node owner can implement that later.
const {fork}=require('node:child_process');
const {randomBytes,createHash}=require('node:crypto');
const fs=require('node:fs/promises');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const NETWORK='fairyelf-public-testnet-v4';
// Git blob IDs are bound to original-miner PR #360 and THIS unmerged child.
// Source substitutions fail closed before launching any mining process.
const SOURCE_BLOBS=Object.freeze({
  'standalone/fae-miner.mjs':'0ab1643c1ff1bf2991a2e56512a3b1746c62122b',
  'standalone/mining-core.mjs':'42c392ad54a3e3c2f446ab79f67948d30b82a73e',
  'universal-client/src/v34-original-miner-owned-worker.mjs':'102ccc04ad1feb51b20196bab0ad23f63bca6755'
});
const DIGEST=/^[0-9a-f]{64}$/;
const ENDPOINT=/^http:\/\/127\.0\.0\.1:([0-9]{4,5})$/;
function samePath(a,b){
  const x=path.normalize(a),y=path.normalize(b);
  return process.platform==='win32'?x.toLowerCase()===y.toLowerCase():x===y;
}
function blobId(bytes){
  return createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
}
// Pre-mutation proof gate: use the EXACT original, source-pinned mining-core
// buildSubmission implementation, never a parallel hash/target algorithm.
// This does NOT authenticate a node or grant native mutation authority.
function assertOriginalMinerProposal(submission,buildSubmission){
  if(!submission||typeof submission!=='object'||Array.isArray(submission)||
     typeof buildSubmission!=='function'||
     Object.keys(submission).some(k=>!['header','nonce','hash','txids','coinbase_outputs'].includes(k)))
    throw Error('Original miner proposal proof rejected');
  try{
    const template={header:submission.header,txids:submission.txids,
      ...(Object.hasOwn(submission,'coinbase_outputs')?
        {coinbase_outputs:submission.coinbase_outputs}:{})};
    const canonical=buildSubmission(template,submission.nonce,submission.hash);
    if(JSON.stringify(canonical)!==JSON.stringify(submission))
      throw Error('Noncanonical mined-block envelope');
  }catch{throw Error('Original miner proposal proof rejected')}
  return true;
}
async function verifyOriginalMinerSource(root){
  if(typeof root!=='string'||!path.isAbsolute(root))throw Error('Owned original miner root required');
  const real=await fs.realpath(root);
  if(!samePath(real,root))throw Error('Original miner root is redirected');
  for(const [relative,expected] of Object.entries(SOURCE_BLOBS)){
    const full=path.join(root,...relative.split('/'));
    if(!samePath(await fs.realpath(full),full))
      throw Error('Original miner source path redirected');
    const st=await fs.lstat(full);
    if(!st.isFile()||st.isSymbolicLink()||st.size<64||st.size>65536||
       (process.platform!=='win32'&&(st.mode&0o022)!==0))
      throw Error('Original miner source file unsafe');
    const file=await fs.readFile(full);
    if(blobId(file)!==expected)throw Error('Original miner source pin mismatch');
  }
  return path.join(root,'universal-client','src','v34-original-miner-owned-worker.mjs');
}
// Only a normal exit code 0 proves completion; signal termination is not proof.
function cleanOriginalMinerExit(code,signal){return code===0&&signal===null}
async function runDeniedOriginalMiner({repoRoot,node,address,timeoutMs=35000}={}){
  // No caller-supplied executable, callback, path or mutation privilege.
  if(typeof node!=='string'||!ENDPOINT.test(node)||
     +(node.match(ENDPOINT)?.[1]||0)>65535||
     typeof address!=='string'||address.length>90||
     !/^faet1[023456789acdefghjklmnpqrstuvwxyz]{25,85}$/.test(address)||
     !Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>180000)
    throw Error('Original miner candidate parameters not admitted');
  const script=await verifyOriginalMinerSource(repoRoot);
  // The already-pinned original mining-core is loaded before any child
  // proposal. Node authoritative acceptance remains owner-only and disabled.
  const {buildSubmission}=await import(pathToFileURL(
    path.join(repoRoot,'standalone','mining-core.mjs')).href);
  if(typeof buildSubmission!=='function')
    throw Error('Pinned original mining-core proof verifier missing');
  const session=randomBytes(32).toString('hex');
  const safeEnv={};
  for(const k of ['PATH','SystemRoot','WINDIR','HOME','USERPROFILE','TMP','TEMP','TMPDIR'])
    if(process.env[k])safeEnv[k]=process.env[k];
  // Intentional built-in node fork: child private IPC is OS-owned and never
  // accessible to arbitrary local HTTP clients. Electron adaptation is gated.
  const child=fork(script,[],{cwd:repoRoot,execArgv:[],env:safeEnv,
    windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
  let state='INIT',lastSeq=0,proposal=null,finish=null,stopped=false;
  const denied=()=>{if(child.connected)child.send({
    type:'fae-v34-submit-result',session,network:NETWORK,
    request_id:lastSeq,ok:false,error:'original_node_owner_admission_required'
  })};
  const done=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{
      try{child.kill()}catch{}
      reject(Error('Original miner candidate timed out; submission outcome not retried'));
    },timeoutMs);
    function fault(err){
      if(stopped)return;stopped=true;clearTimeout(timer);
      try{child.kill()}catch{}
      reject(err);
    }
    child.on('message',m=>{
      if(stopped)return;
      let length;
      try{length=Buffer.byteLength(JSON.stringify(m),'utf8')}
      catch{return fault(Error('Invalid miner owned-process packet'))}
      if(!m||typeof m!=='object'||Array.isArray(m)||length>8192||
         m.session!==session||m.network!==NETWORK)
        return fault(Error('Forged miner owned-process message'));
      if(m.type==='fae-v34-ready'){
        if(state!=='INIT')return fault(Error('Replayed miner ready'));
        state='READY';return;
      }
      if(m.type==='fae-v34-telemetry'){
        if(state==='INIT'||finish)return fault(Error('Miner telemetry out of sequence'));
        return;
      }
      if(m.type==='fae-v34-proposal'){
        if(state!=='READY'||proposal||m.request_id!==lastSeq+1||
           !m.submission||typeof m.submission!=='object'||Array.isArray(m.submission)||
           m.submission.header?.network!==NETWORK||
           !Number.isSafeInteger(m.submission.nonce)||m.submission.nonce<0||
           typeof m.submission.hash!=='string'||!DIGEST.test(m.submission.hash)||
           !Array.isArray(m.submission.txids))
          return fault(Error('Unauthorized or replayed mined-block proposal'));
        try{assertOriginalMinerProposal(m.submission,buildSubmission)}
        catch{return fault(Error('Original mined-block proof invalid'))}
        lastSeq=m.request_id;proposal=m.submission;state='DENIED';
        // Fail CLOSED. In particular, never use original HTTP /submit-block.
        denied();return;
      }
      if(m.type==='fae-v34-finish'){
        if(finish||!['FAIL_CLOSED','STOPPED'].includes(m.status)||
           state==='INIT'||(proposal&&m.status!=='FAIL_CLOSED'))
          return fault(Error('Invalid miner completion acknowledgement'));
        finish=m.status;state='FINISHED';
        // Close the inherited channel only after the worker's final packet;
        // guarantees the bounded disposable OS child can exit cleanly.
        if(child.connected)child.disconnect();
        return;
      }
      return fault(Error('Unrecognized miner owned-process operation'));
    });
    child.on('error',error=>fault(Error('Original miner OS child failed: '+error.message)));
    child.on('exit',(code,signal)=>{
      if(stopped)return;stopped=true;clearTimeout(timer);
      // SIGTERM/SIGKILL reports code=null: never accept a killed miner as
      // independent evidence of a completed, clean denial protocol.
      if(!proposal||finish!=='FAIL_CLOSED'||!cleanOriginalMinerExit(code,signal))
        return reject(Error('Original miner owner denial was not independently witnessed'));
      resolve(Object.freeze({
        type:'REAL_ORIGINAL_MINER_OS_CHILD_DENIED',
        original_network:NETWORK,
        request_count:lastSeq,
        block_height:proposal.header.height,
        block_hash:proposal.hash,
        nonce:proposal.nonce,
        header:proposal.header,
        txids:proposal.txids,
        result:finish,
        native_node_mutation:'NOT_ADMITTED',
        http_fallback:'NEVER_CALLED'
      }));
    });
    child.send({type:'fae-v34-start',session,network:NETWORK,node,address},
      error=>{if(error)fault(Error('Owned original miner start IPC failed'))});
  });
  return done;
}
module.exports={verifyOriginalMinerSource,assertOriginalMinerProposal,cleanOriginalMinerExit,runDeniedOriginalMiner,SOURCE_BLOBS,NETWORK};
