'use strict';
const {lstat,open}=require('node:fs/promises');
const {constants}=require('node:fs');
const {NETWORK}=require('./bridge-contract.cjs');
const MAX_STATE_BYTES=512*1024*1024;
// Candidate safety: never silently start an empty FAE chain over malformed disk state.
// The canonical FAE node itself is immutable; this is a defensive desktop preflight only.
async function assertRecoverableLocalNodeState(file){
  let stat;
  try{stat=await lstat(file)}
  catch(e){if(e.code==='ENOENT')return {present:false};throw e}
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size<2||stat.size>MAX_STATE_BYTES)
    throw Error('FAE node persisted state is not a safe regular file');
  const handle=await open(file,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
  try{
    const observed=await handle.stat();
    if(!observed.isFile()||observed.size!==stat.size)
      throw Error('FAE node state changed during preflight');
    let data;
    try{data=JSON.parse(await handle.readFile('utf8'))}
    catch{throw Error('FAE node persisted state is corrupt; refused empty-chain restart')}
    if(!data||data.format!=='FAE_NODE_STATE_V1'||data.network!==NETWORK||
      !Array.isArray(data.chain)||!data.transactions||typeof data.transactions!=='object'||
      Array.isArray(data.transactions))
      throw Error('FAE node persisted state has invalid format or network; refused empty-chain restart');
    return {present:true,blocks:data.chain.length};
  }finally{await handle.close()}
}
module.exports={assertRecoverableLocalNodeState};
