// Crash-safe, encrypted, single-flight transaction intent. No seed, private key,
// signature, or executable transaction is stored. Deliberately NO auto-replay.
import {createCipheriv,createDecipheriv,randomBytes,scryptSync} from 'node:crypto';
import {constants} from 'node:fs';
import {open,lstat,unlink} from 'node:fs/promises';
import {NETWORK} from './crypto.mjs';
import {isValidAddress} from '../../sovereign-forge/node/authoritative/address.mjs';
import {hardenWindowsPrivateFile,verifyWindowsPrivateFile} from './windows-private-file-acl.mjs';
// V56 independent original-source SECURITY-OWNER CANDIDATE ONLY.
import {observeWindowsDirectoryFenceCandidate} from './windows-outbox-directory-fence-candidate.mjs';

const NOFOLLOW=constants.O_NOFOLLOW??0;
const KDF={N:32768,r:8,p:1,maxmem:128*1024*1024};
const HEX64=/^[0-9a-f]{64}$/;
export function intentPath(vaultPath){return vaultPath+'.outbox.json'}
function validateIntent(v){
  if(!v||v.network!==NETWORK||!HEX64.test(v.txid)||typeof v.node!=='string'||
     !/^https?:\/\//.test(v.node)||!isValidAddress(v.address)||
     (v.recipient!==undefined&&!isValidAddress(v.recipient))||
     !/^[1-9]\d*$/.test(String(v.amount_atoms))||
     !/^\d+$/.test(String(v.fee_atoms))||
     !Number.isSafeInteger(v.tip_height)||v.tip_height<0||!HEX64.test(v.tip_hash)){
    throw Error('invalid_outbox_intent');
  }
  return v;
}
function decryptRecord(blob,password){
  const enc=blob.encryption;
  if(blob.format!=='FAE_STANDALONE_OUTBOX_V1'||blob.network!==NETWORK||
    enc?.kdf!=='scrypt'||enc?.cipher!=='aes-256-gcm'||
    enc?.N!==KDF.N||enc?.r!==KDF.r||enc?.p!==KDF.p)throw Error('invalid_outbox_format');
  const binary=(v,size)=>{
    if(typeof v!=='string'||!/^[A-Za-z0-9+/]*={0,2}$/.test(v))throw Error('invalid_outbox_encoding');
    const b=Buffer.from(v,'base64');
    if((size&&b.length!==size)||b.toString('base64')!==v)throw Error('invalid_outbox_encoding');
    return b;
  };
  const salt=binary(enc.salt,16),iv=binary(enc.iv,12),tag=binary(enc.tag,16),ciphertext=binary(enc.payload);
  if(ciphertext.length===0||ciphertext.length>4096)throw Error('invalid_outbox_payload');
  const key=scryptSync(password,salt,32,KDF);
  let plaintext;
  try{
    const decipher=createDecipheriv('aes-256-gcm',key,iv);
    decipher.setAAD(Buffer.from('FAE_STANDALONE_OUTBOX_V1:'+NETWORK));
    decipher.setAuthTag(tag);
    plaintext=Buffer.concat([decipher.update(ciphertext),decipher.final()]);
    return validateIntent(JSON.parse(plaintext.toString('utf8')));
  }finally{key.fill(0);plaintext?.fill(0);}
}
export async function writeIntent(path,record,password){
  validateIntent(record);
  if(typeof password!=='string'||password.length<12)throw Error('outbox_password_invalid');
  const salt=randomBytes(16),iv=randomBytes(12),key=scryptSync(password,salt,32,KDF);
  const plain=Buffer.from(JSON.stringify(record),'utf8');
  let handle,created=false;
  try{
    const cipher=createCipheriv('aes-256-gcm',key,iv);
    cipher.setAAD(Buffer.from('FAE_STANDALONE_OUTBOX_V1:'+NETWORK));
    const payload=Buffer.concat([cipher.update(plain),cipher.final()]);
    const data=JSON.stringify({format:'FAE_STANDALONE_OUTBOX_V1',network:NETWORK,
      encryption:{cipher:'aes-256-gcm',kdf:'scrypt',N:KDF.N,r:KDF.r,p:KDF.p,
        salt:salt.toString('base64'),iv:iv.toString('base64'),
        tag:cipher.getAuthTag().toString('base64'),payload:payload.toString('base64')}})+'\n';
    // EXCL locks out concurrent sends and any unresolved old intent.
    handle=await open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|NOFOLLOW,0o600);
    created=true;
    // NTFS ACL must be private BEFORE recording encrypted intent bytes.
    await hardenWindowsPrivateFile(path,handle);
    await handle.writeFile(data,{encoding:'utf8'});
    await handle.sync();
    await handle.close();handle=null;
    // A file fsync is insufficient for the new outbox directory entry.
    // Original #342 uses parent.sync(). Windows Node currently returns EPERM.
    // V56 SECURITY-OWNER CANDIDATE: an independently identity-bound native
    // Win32 directory FlushFileBuffers call has been observed to succeed.
    // This branch must NOT ship or submit real funds before owner admission
    // and independent crash/power-loss durability review. No suppress-EPERM.
    const dirname=(await import('node:path')).dirname(path);
    const parent=await open(dirname,constants.O_RDONLY|NOFOLLOW);
    try{
      if(process.platform==='win32')
        await observeWindowsDirectoryFenceCandidate(dirname,parent);
      else await parent.sync();
    }finally{await parent.close()}
  }catch(error){
    if(handle){await handle.close().catch(()=>{});}
    // Never delete a potentially committed intent. If fsync failed, leave
    // the file in place and fail closed; user must inspect/repair safely.
    if(created)error.message='outbox_write_incomplete_fail_closed:'+error.message;
    throw error;
  }finally{key.fill(0);plain.fill(0);}
}
export async function readIntent(path,password){
  // Preserve full 64-bit NTFS identity when validating the opened file.
  const st=await lstat(path,{bigint:process.platform==='win32'});
  if(!st.isFile()||st.isSymbolicLink()||
     (process.platform!=='win32'&&(st.mode&0o077)!==0))
    throw Error('outbox_requires_private_0600_file');
  await verifyWindowsPrivateFile(path);
  if(typeof process.getuid==='function'&&st.uid!==process.getuid())throw Error('outbox_owner_mismatch');
  const handle=await open(path,constants.O_RDONLY|NOFOLLOW);
  try{
    const v=await handle.stat({bigint:process.platform==='win32'});
    if(v.size<100||v.size>8192||v.ino!==st.ino||v.dev!==st.dev||
       (process.platform!=='win32'&&(v.mode&0o077)!==0))
      throw Error('outbox_file_invalid');
    const blob=JSON.parse(await handle.readFile('utf8'));
    try{return decryptRecord(blob,password)}catch{throw Error('outbox_wrong_password_or_corrupt')}
  }finally{await handle.close()}
}
// No deletion/resubmission automatically: a recovered intent remains a guard.
export async function acknowledgeConfirmedIntent(path,password,txid,confirmation){
  const old=await readIntent(path,password);
  if(old.txid!==txid||confirmation?.state!=='confirmed_node_reported'||confirmation?.txid!==txid)
    throw Error('outbox_not_confirmed_or_txid_mismatch');
  // Deliberate explicit caller action, only after consistent node status.
  await unlink(path);
}
