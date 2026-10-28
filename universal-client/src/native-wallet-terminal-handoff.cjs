'use strict';
// Candidate native terminal handoff ONLY. This module cannot decrypt, sign or
// receive any secret. Actual CLI is separately owned by Wallet PR #342.
// Do not use this for graphical secret prompts or headless CI signing.
const fs=require('node:fs/promises');
const path=require('node:path');
const {constants}=require('node:fs');
const {spawn}=require('node:child_process');
const {createHash}=require('node:crypto');
const COMMANDS=new Set(['create','recover','address','receive','balance','history','outbox']);
const TTY_REQUIRED=new Set(['create','recover','address','receive','balance','history','outbox']);
const MAX_SOURCE_BYTES=32768;
const WALLET_IMPORT_CLOSURE=Object.freeze([
  'standalone/wallet/fae-wallet.mjs',
  'standalone/wallet/crypto.mjs',
  'standalone/wallet/vault.mjs',
  'standalone/wallet/outbox.mjs',
  'sovereign-forge/node/authoritative/address.mjs',
  'sovereign-forge/node/authoritative/crypto.mjs',
  'sovereign-forge/node/authoritative/canonical.mjs',
  'bip39-en.js'
]);
async function authenticatedWalletScript(file,expectedSha256){
  if(typeof file!=='string'||!path.isAbsolute(file)||
     path.basename(file)!=='fae-wallet.mjs'||
     !/^[0-9a-f]{64}$/.test(expectedSha256||''))
    throw Error('Native Wallet companion source not admitted');
  const st=await fs.lstat(file);
  if(!st.isFile()||st.isSymbolicLink()||st.size<100||st.size>MAX_SOURCE_BYTES||
     (process.platform!=='win32'&&(st.mode&0o022)!==0))
    throw Error('Native Wallet companion file unsafe');
  const f=await fs.open(file,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
  let bytes;try{
    const actual=await f.stat();
    if(actual.ino!==st.ino||actual.dev!==st.dev||actual.size!==st.size)
      throw Error('Native Wallet companion changed during read');
    bytes=await f.readFile();
  }finally{await f.close()}
  if(createHash('sha256').update(bytes).digest('hex')!==expectedSha256)
    throw Error('Native Wallet companion SHA-256 mismatch');
  return file;
}
async function authenticatedWalletBundle(script,manifest){
  if(typeof script!=='string'||!path.isAbsolute(script)||!manifest||
    typeof manifest!=='object'||Array.isArray(manifest)||
    Object.keys(manifest).length!==WALLET_IMPORT_CLOSURE.length)
    throw Error('Complete Wallet source-owner bundle attestation required');
  const root=path.resolve(path.dirname(script),'..','..');
  const realRoot=await fs.realpath(root);
  if(realRoot!==root)throw Error('Native Wallet source root must not be symlinked');
  for(const relative of WALLET_IMPORT_CLOSURE){
    if(!Object.hasOwn(manifest,relative)||!(/^[0-9a-f]{64}$/.test(manifest[relative])))
      throw Error('Wallet bundle dependency SHA-256 unavailable');
    const full=path.join(root,...relative.split('/'));
    if(await fs.realpath(full)!==full)throw Error('Wallet bundle dependency is redirected');
    const st=await fs.lstat(full);
    if(!st.isFile()||st.isSymbolicLink()||st.size<64||st.size>65536||
       (process.platform!=='win32'&&(st.mode&0o022)!==0))
      throw Error('Wallet bundle dependency unsafe');
    const content=await fs.readFile(full);
    if(createHash('sha256').update(content).digest('hex')!==manifest[relative])
      throw Error('Wallet bundle dependency digest mismatch');
  }
  if(script!==path.join(root,'standalone','wallet','fae-wallet.mjs'))
    throw Error('Native Wallet CLI outside attested bundle');
  return script;
}
async function runPrivilegedWalletTerminal(command,{
  script,manifest,nodeExecutable,publicVault,tty,spawnFn=spawn
}={}){
  if(!COMMANDS.has(command))throw Error('Unsupported native Wallet command');
  if(!tty||tty.stdin!==true||tty.stdout!==true||tty.stderr!==true)
    throw Error('Protected interactive terminal unavailable');
  if(typeof nodeExecutable!=='string'||!path.isAbsolute(nodeExecutable)||
     typeof publicVault!=='string'||!path.isAbsolute(publicVault)||
     publicVault.includes('\0')||publicVault.length>1024)
    throw Error('Wallet executable or local vault target not admitted');
  // Full source-owned static import closure is mandatory, not only the CLI.
  await authenticatedWalletBundle(script,manifest);
  const args=[script,command,'--vault',publicVault];
  return new Promise((resolve,reject)=>{
    let child;
    try{
      child=spawnFn(nodeExecutable,args,{
        shell:false,windowsHide:false,stdio:'inherit',cwd:path.dirname(script),
        env:{PATH:process.env.PATH||'',SystemRoot:process.env.SystemRoot||'',WINDIR:process.env.WINDIR||'',
          HOME:process.env.HOME||'',USERPROFILE:process.env.USERPROFILE||'',TMP:process.env.TMP||'',
          TEMP:process.env.TEMP||'',LANG:process.env.LANG||''}
      });
    }catch{return reject(Error('Native Wallet terminal start failed'))}
    child.once('error',()=>reject(Error('Native Wallet terminal process unavailable')));
    child.once('exit',(code,signal)=>{
      resolve(Object.freeze({command,status:code===0&&signal===null?'CLI_EXIT_SUCCESS':'CLI_EXIT_UNCONFIRMED',
        // Do not return stdout, stderr, seed, mnemonic or password to GUI.
        custody:'NATIVE_TERMINAL_SEPARATE_FROM_RENDERER',
        signer:'NOT_ATTESTED_BY_THIS_BRIDGE',
        outbox:'NOT_INSPECTED_BY_THIS_BRIDGE'}));
    });
  });
}
module.exports={authenticatedWalletScript,authenticatedWalletBundle,runPrivilegedWalletTerminal};
