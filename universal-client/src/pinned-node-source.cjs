'use strict';
// Candidate-only exact-byte boundary before starting a protected FAE original
// node. The expected SHA-256 values MUST be pinned independently by the
// admitted owner/build; never derive them from the files being executed.
// SHA-256 checks are not operating-system executable attestation or TOCTOU
// immunity. Native Wallet signing remains disabled.
const {createHash}=require('node:crypto');
const {open,lstat}=require('node:fs/promises');
const {constants}=require('node:fs');
const path=require('node:path');
const FILES=Object.freeze([
  'sovereign-forge/node/fae-node.mjs',
  'sovereign-forge/node/node-parent-port.mjs',
  'sovereign-forge/node/managed-http-guard.mjs',
  'sovereign-forge/node/explorer-read.mjs'
]);
const MINER_FILES=Object.freeze([
  'standalone/fae-miner.mjs',
  'standalone/mining-core.mjs',
  'universal-client/src/v34-original-miner-owned-worker.mjs'
]);
const SHA256=/^[0-9a-f]{64}$/;
function validateNativeNodeSourcePins(pins){
  if(!pins||typeof pins!=='object'||Array.isArray(pins)||
    Object.getPrototypeOf(pins)!==Object.prototype||
    Object.keys(pins).length!==FILES.length)
    throw Error('Native original-node source pins required before launch');
  for(const file of FILES)
    if(!Object.hasOwn(pins,file)||typeof pins[file]!=='string'||!SHA256.test(pins[file]))
      throw Error('Missing or invalid original-node source pin');
  return Object.freeze(Object.fromEntries(FILES.map(file=>[file,pins[file]])));
}
function validateOriginalMinerSourcePins(pins){
  if(!pins||typeof pins!=='object'||Array.isArray(pins)||
    Object.getPrototypeOf(pins)!==Object.prototype||
    Object.keys(pins).length!==MINER_FILES.length)
    throw Error('Original Miner worker source pins required before launch');
  for(const file of MINER_FILES)
    if(!Object.hasOwn(pins,file)||typeof pins[file]!=='string'||!SHA256.test(pins[file]))
      throw Error('Missing or invalid original Miner source pin');
  return Object.freeze(Object.fromEntries(MINER_FILES.map(file=>[file,pins[file]])));
}
async function assertPinnedFileSet(root,expected,files,label){

  if(typeof root!=='string'||!path.isAbsolute(root))
    throw Error('Invalid original-node source root');
  for(const name of files){
    const abs=path.join(root,...name.split('/'));
    let handle;
    try{
      const before=await lstat(abs);
      if(!before.isFile()||before.isSymbolicLink()||before.size>2*1024*1024)
        throw Error('Original-node source is not a regular bounded file');
      // O_NOFOLLOW is available on macOS/Linux; lstat also refuses symlinks
      // on Windows. Inode/size/mtime comparison detects ordinary mutations.
      handle=await open(abs,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
      const opened=await handle.stat();
      const bytes=await handle.readFile();
      const after=await lstat(abs);
      if(!opened.isFile()||!after.isFile()||
        before.dev!==opened.dev||before.ino!==opened.ino||
        opened.dev!==after.dev||opened.ino!==after.ino||
        before.size!==bytes.length||after.size!==bytes.length||
        before.mtimeMs!==after.mtimeMs)
        throw Error('Original-node source changed during verification');
      const digest=createHash('sha256').update(bytes).digest('hex');
      if(digest!==expected[name])
        throw Error('Original-node source SHA-256 pin mismatch');
    }catch(error){
      // No absolute filesystem paths or file contents in renderer-visible errors.
      throw Error('Native '+label+' source verification failed: '+name+
        ' ('+(error?.code==='ENOENT'?'missing file':'integrity mismatch')+')');
    }finally{
      await handle?.close().catch(()=>{});
    }
  }
  return Object.freeze({files_checked:files.length,source_pinned:true,
    authority:'EXACT_CANDIDATE_BYTES_ONLY'});
}
async function assertPinnedOriginalNodeSources(root,pins){
  return assertPinnedFileSet(root,validateNativeNodeSourcePins(pins),FILES,'original-node');
}
async function assertPinnedOriginalMinerSources(root,pins){
  return assertPinnedFileSet(root,validateOriginalMinerSourcePins(pins),MINER_FILES,'original-miner');
}
// Disposable Wallet proof only: NOT an admitted production signing source.
// Its parent-owned bridge is deliberately excluded from all installed builds.
const DISPOSABLE_SIGNER_FILE='universal-client/src/v52-disposable-original-wallet-signer.mjs';
async function assertPinnedDisposableWalletSignerSource(root,expectedSha256){
  if(typeof expectedSha256!=='string'||!SHA256.test(expectedSha256))
    throw Error('Independently pinned disposable Wallet signer source required');
  return assertPinnedFileSet(root,{[DISPOSABLE_SIGNER_FILE]:expectedSha256},
    [DISPOSABLE_SIGNER_FILE],'disposable-wallet-signer');
}
module.exports={DISPOSABLE_SIGNER_FILE,assertPinnedDisposableWalletSignerSource,
  FILES,MINER_FILES,validateNativeNodeSourcePins,
  validateOriginalMinerSourcePins,assertPinnedOriginalNodeSources,
  assertPinnedOriginalMinerSources};
