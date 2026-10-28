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
// Independently fetched from protected Wallet Draft PR #342 exact head
// 17c90ffc313fd11de17396437436e4429472f616; candidate evidence only.
// Publishing this public digest does not admit a release or cryptographic signer.
const WALLET_OWNER_HEAD='17c90ffc313fd11de17396437436e4429472f616';
const PINNED_WALLET_BUNDLE=Object.freeze({
  "standalone/wallet/fae-wallet.mjs": "fd734253fdb43de7c64bc968048b12506a7a4faa25c1a340b5a036971b0feae1",
  "standalone/wallet/crypto.mjs": "482ed15976e876c2728dcfff88dc845ae325d5c982ac92aaba4af9ed516e8805",
  "standalone/wallet/vault.mjs": "6861fa4c60c4f2530dded90a4bc4d70a026f50783b33fff857fa9b905bc514d7",
  "standalone/wallet/outbox.mjs": "94c038446dc0ef148c42df0c720db18d85c418e182226ace816bb978a28ddc8b",
  "sovereign-forge/node/authoritative/address.mjs": "a7ba18463aa85bc40ed8bf9410ab046542102a63b30b9f84532d16b27b0b24f1",
  "sovereign-forge/node/authoritative/crypto.mjs": "c327ae561a1d0052032ca4d2fb025018a1aab9fd20b64711f184388cda2c7a7f",
  "sovereign-forge/node/authoritative/canonical.mjs": "1193a597e16a9138903742c19d7a94367beb79084ad1857f5f016b63f82f9feb",
  "bip39-en.js": "46e6d96b5b262d16152f7006d24910afc4243de7f72ccb89650d37bc588c278a"
});

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
async function authenticatedWalletBundle(script){
  const manifest=PINNED_WALLET_BUNDLE;
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
  script,nodeExecutable,publicVault,tty,spawnFn=spawn
}={}){
  if(!COMMANDS.has(command))throw Error('Unsupported native Wallet command');
  if(!tty||tty.stdin!==true||tty.stdout!==true||tty.stderr!==true)
    throw Error('Protected interactive terminal unavailable');
  if(typeof nodeExecutable!=='string'||!path.isAbsolute(nodeExecutable)||
     typeof publicVault!=='string'||!path.isAbsolute(publicVault)||
     publicVault.includes('\0')||publicVault.length>1024)
    throw Error('Wallet executable or local vault target not admitted');
  // Full source-owned static import closure is mandatory, not only the CLI.
  await authenticatedWalletBundle(script);
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
module.exports={WALLET_OWNER_HEAD,authenticatedWalletBundle,runPrivilegedWalletTerminal};
