// V52 isolated disposable signer proof. This is NOT a production Wallet signer.
// Original Wallet #342 crypto is imported unchanged from its independently pinned
// source snapshot; no user vault, password, mnemonic or private key crosses IPC.
import {entropyToMnemonic,deriveRecords,buildSignedTransaction,NETWORK} from
  '../../standalone/wallet/crypto.mjs';
const MODE='TS_V52_DISPOSABLE_SIGNER_ONLY';
const DIGEST=/^[0-9a-f]{64}$/;
if(process.env.TS_V52_DISPOSABLE_SIGNER_PROOF!=='isolated-owner-fixture'||
   !process.connected)throw Error('Disposable proof only; signer not admitted');
let used=false;
process.on('message',packet=>{
  if(used)return;
  used=true;
  const session=packet?.session;
  try{
    if(!packet||typeof packet!=='object'||Array.isArray(packet)||
       Object.keys(packet).sort().join(',')!==
         'mode,network,outpoint,request_id,session'||
       packet.mode!==MODE||packet.network!==NETWORK||
       packet.request_id!==1||typeof session!=='string'||!DIGEST.test(session)||
       typeof packet.outpoint!=='string'||
       !/^[0-9a-f]{64}:0$/.test(packet.outpoint))
      throw Error('Invalid one-shot disposable intent');
    // Two public, deterministic test identities. NEVER derive from a vault or
    // accept entropy, mnemonic, seed, passphrase or password from the parent.
    const a=deriveRecords(entropyToMnemonic(Buffer.alloc(32,0x11)))[0];
    const b=deriveRecords(entropyToMnemonic(Buffer.alloc(32,0xab)))[0];
    const result=buildSignedTransaction(a,[packet.outpoint],[
      {address:b.address,amount_atoms:'100000000'},
      {address:a.address,amount_atoms:'899999999'}
    ]);
    process.send({mode:MODE,session,network:NETWORK,request_id:1,
      status:'SIGNED_DISPOSABLE_ONLY',from:a.address,to:b.address,
      tx:result.tx,txid:result.txid},()=>process.disconnect());
  }catch{
    if(process.connected)process.send({mode:MODE,
      session:typeof session==='string'?session:'',network:NETWORK,
      request_id:1,status:'DENIED'},()=>process.disconnect());
  }
});
