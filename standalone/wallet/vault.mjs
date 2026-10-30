import {createCipheriv,createDecipheriv,randomBytes,scryptSync} from 'node:crypto';
import {constants} from 'node:fs';
import {open,lstat,unlink} from 'node:fs/promises';
import {deriveRecords,NETWORK} from './crypto.mjs';
import {hardenWindowsPrivateFile,verifyWindowsPrivateFile} from './windows-private-file-acl.mjs';

const KDF={N:32768,r:8,p:1,maxmem:128*1024*1024};
const NOFOLLOW=constants.O_NOFOLLOW??0;
export async function writeVault(path,mnemonic,bip39Passphrase,password){
  if(typeof password!=='string'||password.length<12)throw Error('vault_password_minimum_12_characters');
  const records=deriveRecords(mnemonic,bip39Passphrase);
  const salt=randomBytes(16),iv=randomBytes(12),key=scryptSync(password,salt,32,KDF);
  const payload=Buffer.from(JSON.stringify({mnemonic,bip39Passphrase}), 'utf8');
  try{
    const cipher=createCipheriv('aes-256-gcm',key,iv);
    const encrypted=Buffer.concat([cipher.update(payload),cipher.final()]);
    const data=JSON.stringify({
      format:'FAE_STANDALONE_VAULT_V1',network:NETWORK,
      public_addresses:records.map(r=>({index:r.index,address:r.address,public_key_spki:r.public_key_spki})),
      encryption:{cipher:'aes-256-gcm',kdf:'scrypt',N:KDF.N,r:KDF.r,p:KDF.p,
        salt:salt.toString('base64'),iv:iv.toString('base64'),
        tag:cipher.getAuthTag().toString('base64'),payload:encrypted.toString('base64')}
    })+'\n';
    const handle=await open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|NOFOLLOW,0o600);
    try{
      // Before encrypted material hits disk, replace inherited NTFS ACEs.
      await hardenWindowsPrivateFile(path,handle);
      await handle.writeFile(data,{encoding:'utf8'});await handle.sync();
    }
    catch(e){await handle.close();await unlink(path).catch(()=>{});throw e}
    await handle.close();
    return records.map(r=>({index:r.index,address:r.address,public_key_spki:r.public_key_spki}));
  }finally{key.fill(0);payload.fill(0);}
}
export async function readVault(path){
  // Preserve full 64-bit NTFS identity when validating the opened file.
  const s=await lstat(path,{bigint:process.platform==='win32'});
  if(!s.isFile()||s.isSymbolicLink()||
     (process.platform!=='win32'&&(s.mode&0o077)!==0))
    throw Error('vault_requires_regular_private_0600_file');
  await verifyWindowsPrivateFile(path);
  if(typeof process.getuid==='function'&&s.uid!==process.getuid())throw Error('vault_owner_mismatch');
  const handle=await open(path,constants.O_RDONLY|NOFOLLOW);
  try{
    const stat=await handle.stat({bigint:process.platform==='win32'});
    if(stat.size>16384||stat.size<100||stat.dev!==s.dev||stat.ino!==s.ino)
      throw Error('vault_size_or_identity_invalid');
    const data=JSON.parse(await handle.readFile('utf8'));
    if(data.format!=='FAE_STANDALONE_VAULT_V1'||data.network!==NETWORK ||
      !Array.isArray(data.public_addresses)||data.public_addresses.length!==5)throw Error('invalid_vault_format');
    const c=data.encryption;
    if(c?.kdf!=='scrypt'||c?.cipher!=='aes-256-gcm'||c?.N!==KDF.N||c?.r!==KDF.r||c?.p!==KDF.p)throw Error('unsupported_vault_crypto');
    const decode=(x,bytes)=>{if(typeof x!=='string')throw Error('invalid_vault_bytes');const b=Buffer.from(x,'base64');if(bytes&&b.length!==bytes)throw Error('invalid_vault_bytes');return b};
    return {public_addresses:data.public_addresses,encryption:{
      salt:decode(c.salt,16),iv:decode(c.iv,12),tag:decode(c.tag,16),payload:decode(c.payload)
    }};
  }finally{await handle.close();}
}
export async function unlockVault(path,password){
  const vault=await readVault(path);
  const key=scryptSync(password,vault.encryption.salt,32,KDF);
  let plaintext;
  try{
    const decipher=createDecipheriv('aes-256-gcm',key,vault.encryption.iv);
    decipher.setAuthTag(vault.encryption.tag);
    plaintext=Buffer.concat([decipher.update(vault.encryption.payload),decipher.final()]);
    const payload=JSON.parse(plaintext.toString('utf8'));
    const records=deriveRecords(payload.mnemonic,payload.bip39Passphrase);
    for(let i=0;i<records.length;i++){
      const pub=vault.public_addresses[i];
      if(pub.index!==records[i].index||pub.address!==records[i].address||pub.public_key_spki!==records[i].public_key_spki)throw Error('vault_public_record_mismatch');
    }
    return records;
  }catch{throw Error('incorrect_password_or_corrupt_vault')}
  finally{key.fill(0);plaintext?.fill(0);}
}
