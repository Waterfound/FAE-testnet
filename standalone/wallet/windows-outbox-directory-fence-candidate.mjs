// V56 original Wallet owner-compatible candidate: Win32 directory flush fence.
// SECURITY OWNER REVIEW REQUIRED: actual FlushFileBuffers success proves an
// OS operation, NOT power-loss persistence or production payment authorization.
// This module exists ONLY on independent draft PR #368; do not release it.
import {execFileSync} from 'node:child_process';
import {realpath,lstat} from 'node:fs/promises';
import {win32,join} from 'node:path';
const SCRIPT_SOURCE=String.raw`
$ErrorActionPreference='Stop'
try {
  $path=[Console]::In.ReadToEnd()
  if(-not [System.IO.Path]::IsPathRooted($path) -or
     -not [System.IO.Directory]::Exists($path)){throw 'invalid_directory'}
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class OriginalWalletV56DirectoryFence {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern IntPtr CreateFileW(
    string path,uint access,uint share,IntPtr security,uint disposition,
    uint flags,IntPtr template);
  [DllImport("kernel32.dll", SetLastError=true)]
  [return:MarshalAs(UnmanagedType.Bool)]
  public static extern bool FlushFileBuffers(IntPtr handle);
  [DllImport("kernel32.dll", SetLastError=true)]
  [return:MarshalAs(UnmanagedType.Bool)]
  public static extern bool CloseHandle(IntPtr handle);
}
'@ -ErrorAction Stop
  # GEN_WRITE / OPEN_EXISTING / BACKUP_SEMANTICS. No privilege elevation.
  $h=[OriginalWalletV56DirectoryFence]::CreateFileW($path,
     [uint32]0x40000000,[uint32]7,[IntPtr]::Zero,[uint32]3,
     [uint32]0x02000000,[IntPtr]::Zero)
  if($h -eq [IntPtr]::new(-1)){throw 'native_directory_open_refused'}
  try{
    if(-not [OriginalWalletV56DirectoryFence]::FlushFileBuffers($h)){
      throw 'native_directory_flush_refused'
    }
  } finally{
    [void][OriginalWalletV56DirectoryFence]::CloseHandle($h)
  }
  [Console]::Out.Write('WIN32_DIRECTORY_FLUSH_OBSERVED')
} catch {
  # No filesystem path or user information crosses to caller diagnostics.
  [Console]::Error.Write('WIN32_DIRECTORY_FLUSH_FAILED')
  exit 18
}
`;
const ENCODED_SCRIPT=Buffer.from(SCRIPT_SOURCE,'utf16le').toString('base64');
function powershell(){
  const root=process.env.SystemRoot;
  if(typeof root!=='string'||!/^[A-Z]:\\Windows$/i.test(root))
    throw Error('trusted Win32 directory fence executable unavailable');
  return join(root,'System32','WindowsPowerShell','v1.0','powershell.exe');
}
async function canonicalDirectory(directory){
  if(typeof directory!=='string'||!win32.isAbsolute(directory)||
     directory.includes('\u0000')||directory.includes('\n')||
     directory.includes('\r'))
    throw Error('Win32 directory fence requires canonical absolute path');
  const real=await realpath(directory);
  if(win32.normalize(real).toLowerCase()!==win32.normalize(directory).toLowerCase())
    throw Error('Win32 directory fence rejected redirected path');
  const stat=await lstat(directory,{bigint:true});
  if(!stat.isDirectory()||stat.isSymbolicLink())
    throw Error('Win32 directory fence requires regular directory');
  return {real,stat};
}
// May only be called after the original owner has synced its encrypted file.
// Compare the SAME caller-owned directory handle to the native target before
// and after the OS flush; any replacement becomes a fail-closed outcome.
export async function observeWindowsDirectoryFenceCandidate(directory,ownedHandle){
  if(process.platform!=='win32')
    throw Error('Win32 directory fence candidate unavailable on this OS');
  if(!ownedHandle||typeof ownedHandle.stat!=='function')
    throw Error('Win32 directory fence owned handle required');
  const before=await canonicalDirectory(directory);
  const original=await ownedHandle.stat({bigint:true});
  if(!original.isDirectory()||original.dev!==before.stat.dev||
     original.ino!==before.stat.ino)
    throw Error('Win32 directory fence handle/path identity mismatch');
  let reply;
  try{
    reply=execFileSync(powershell(),[
      '-NoProfile','-NonInteractive','-EncodedCommand',ENCODED_SCRIPT
    ],{input:before.real,encoding:'utf8',windowsHide:true,
      timeout:25000,maxBuffer:4096,stdio:['pipe','pipe','pipe']});
  }catch{
    throw Error('Win32 directory flush refused: outbox remains unresolved');
  }
  if(reply!=='WIN32_DIRECTORY_FLUSH_OBSERVED')
    throw Error('Win32 directory fence acknowledgement invalid');
  const after=await canonicalDirectory(directory);
  const opened=await ownedHandle.stat({bigint:true});
  if(before.stat.dev!==after.stat.dev||before.stat.ino!==after.stat.ino||
     original.dev!==opened.dev||original.ino!==opened.ino||
     original.dev!==after.stat.dev||original.ino!==after.stat.ino)
    throw Error('Win32 directory fence changed during OS operation');
  // Never represent this receipt as independently proven power-loss safety.
  return Object.freeze({native_directory_flush_observed:true,
    power_loss_verified:false,production_owner_admitted:false});
}
