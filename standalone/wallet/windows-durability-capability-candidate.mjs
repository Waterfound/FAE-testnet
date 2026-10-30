// V56 isolated Win32 durability capability experiment. Never production Wallet.
// No vaults, keys, signed TX, privileged mutations or real user paths accepted.
// A successful Win32 call is NOT a power-loss/namespace durability guarantee.
import {execFileSync} from 'node:child_process';
import {constants} from 'node:fs';
import {open,readFile,realpath,lstat} from 'node:fs/promises';
import {join,dirname,win32} from 'node:path';

const POWERSHELL=String.raw`
$ErrorActionPreference='Stop'
try {
  $req=ConvertFrom-Json -InputObject ([Console]::In.ReadToEnd())
  $src=[string]$req.source
  $dst=[string]$req.destination
  if(-not [System.IO.Path]::IsPathRooted($src) -or
     -not [System.IO.Path]::IsPathRooted($dst) -or
     [System.IO.Path]::GetDirectoryName($src) -ne
       [System.IO.Path]::GetDirectoryName($dst)) {
    throw 'isolated_same_directory_required'
  }
  if(-not [System.IO.File]::Exists($src) -or
     [System.IO.File]::Exists($dst)) {throw 'source_or_target_invalid'}
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class WalletV56DurabilityCapability {
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
  public static extern IntPtr CreateFileW(
    string path,uint access,uint share,IntPtr security,uint disposition,
    uint flags,IntPtr template);
  [DllImport("kernel32.dll",SetLastError=true)]
  [return:MarshalAs(UnmanagedType.Bool)]
  public static extern bool FlushFileBuffers(IntPtr handle);
  [DllImport("kernel32.dll",SetLastError=true)]
  [return:MarshalAs(UnmanagedType.Bool)]
  public static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
  [return:MarshalAs(UnmanagedType.Bool)]
  public static extern bool MoveFileExW(string source,string target,uint flags);
}
'@ -ErrorAction Stop
  # Directory handle opened explicitly with FILE_FLAG_BACKUP_SEMANTICS.
  # Windows may refuse GENERIC_WRITE and/or FlushFileBuffers on directories.
  # Record the actual Win32 error; NEVER convert a failure to durable success.
  $folder=[System.IO.Path]::GetDirectoryName($src)
  $h=[WalletV56DurabilityCapability]::CreateFileW($folder,
    [uint32]0x40000000,[uint32]7,[IntPtr]::Zero,[uint32]3,
    [uint32]0x02000000,[IntPtr]::Zero)
  $opened=$h -ne ([IntPtr]::new(-1))
  $openError=0
  $flushOk=$false
  $flushError=0
  if(-not $opened) {
    $openError=[Runtime.InteropServices.Marshal]::GetLastWin32Error()
  } else {
    try {
      $flushOk=[WalletV56DurabilityCapability]::FlushFileBuffers($h)
      if(-not $flushOk) {
        $flushError=[Runtime.InteropServices.Marshal]::GetLastWin32Error()
      }
    } finally {
      [void][WalletV56DurabilityCapability]::CloseHandle($h)
    }
  }
  # The same-volume MOVEFILE_WRITE_THROUGH flag is not independently a
  # proof that the namespace would survive sudden power loss.
  $moved=[WalletV56DurabilityCapability]::MoveFileExW($src,$dst,[uint32]8)
  $moveError=0
  if(-not $moved) {
    $moveError=[Runtime.InteropServices.Marshal]::GetLastWin32Error()
  }
  [Console]::Out.Write((@{
    schema='ts.v56.windows-durability-observation.v1';
    directory_opened=[bool]$opened;
    directory_open_error=[int]$openError;
    directory_flush_returned=[bool]$flushOk;
    directory_flush_error=[int]$flushError;
    move_write_through_returned=[bool]$moved;
    move_write_through_error=[int]$moveError;
    power_loss_verified=$false;
    original_outbox_durable=$false;
    authorize_signed_tx=$false
  } | ConvertTo-Json -Compress))
} catch {
  # We deliberately do not publish errors containing file or user paths.
  [Console]::Out.Write('{"schema":"ts.v56.windows-durability-observation.v1",'+
    '"probe_failed_closed":true,"power_loss_verified":false,'+
    '"original_outbox_durable":false,"authorize_signed_tx":false}')
  exit 20
}
`;
const SCRIPT=Buffer.from(POWERSHELL,'utf16le').toString('base64');
const SAFE_OBSERVATION_KEYS=[
  'schema','directory_opened','directory_open_error',
  'directory_flush_returned','directory_flush_error',
  'move_write_through_returned','move_write_through_error',
  'power_loss_verified','original_outbox_durable','authorize_signed_tx'
].sort().join(',');

function trustedPowerShell(){
  const root=process.env.SystemRoot;
  if(typeof root!=='string'||!/^[A-Z]:\\Windows$/i.test(root))
    throw Error('Trusted Windows system PowerShell path required');
  return join(root,'System32','WindowsPowerShell','v1.0','powershell.exe');
}
function validateNativeObservation(reply){
  if(!reply||typeof reply!=='object'||Array.isArray(reply)||
     Object.keys(reply).sort().join(',')!==SAFE_OBSERVATION_KEYS||
     reply.schema!=='ts.v56.windows-durability-observation.v1'||
     ['directory_opened','directory_flush_returned','move_write_through_returned',
      'power_loss_verified','original_outbox_durable','authorize_signed_tx'].
       some(key=>typeof reply[key]!=='boolean')||
     ['directory_open_error','directory_flush_error','move_write_through_error'].
       some(key=>!Number.isSafeInteger(reply[key])||reply[key]<0||reply[key]>65535)||
     reply.power_loss_verified!==false||reply.original_outbox_durable!==false||
     reply.authorize_signed_tx!==false)
    throw Error('Invalid Windows durability capability evidence');
  return Object.freeze(reply);
}
// Probe is explicitly test-fixture only; NO public API to flush Wallet outbox.
export async function inspectIsolatedWin32Durability({directory,source,destination}={}){
  if(process.platform!=='win32')throw Error('Windows-only candidate');
  if(typeof directory!=='string'||typeof source!=='string'||
     typeof destination!=='string'||!win32.isAbsolute(directory)||
     !win32.isAbsolute(source)||!win32.isAbsolute(destination)||
     dirname(source)!==directory||dirname(destination)!==directory||
     source===destination)
    throw Error('Noncanonical isolated Windows durability fixture rejected');
  const expectedDir=await realpath(directory);
  const expectedSource=await realpath(source);
  if(win32.normalize(expectedDir).toLowerCase()!==win32.normalize(directory).toLowerCase()||
     win32.normalize(expectedSource).toLowerCase()!==win32.normalize(source).toLowerCase())
    throw Error('Redirected Windows durability fixture rejected');
  const st=await lstat(source);
  if(!st.isFile()||st.isSymbolicLink()||st.size!==32)
    throw Error('Unsafe isolated durability source rejected');
  let output;
  try {
    output=execFileSync(trustedPowerShell(),
      ['-NoProfile','-NonInteractive','-EncodedCommand',SCRIPT],
      {input:JSON.stringify({source,destination}),encoding:'utf8',
       windowsHide:true,timeout:30000,maxBuffer:8192,
       stdio:['pipe','pipe','pipe']});
  }catch{
    throw Error('Win32 durability capability probe failed closed');
  }
  if(output.length>4096)throw Error('Oversized Windows durability evidence');
  const observation=validateNativeObservation(JSON.parse(output));
  if(observation.move_write_through_returned){
    const data=await readFile(destination);
    if(data.length!==32||!data.equals(Buffer.alloc(32,0x56)))
      throw Error('Native write-through move data mismatch');
  }
  return observation;
}
export async function inspectNodeDirectorySync(directory){
  if(typeof directory!=='string')throw Error('Directory required');
  const file=await open(directory,constants.O_RDONLY);
  try{
    await file.sync();
    return Object.freeze({node_directory_sync:'RETURNED_SUCCESS',
      original_outbox_durable:false,power_loss_verified:false});
  }catch(error){
    return Object.freeze({node_directory_sync:'FAILED',
      reason:['EPERM','EINVAL','EACCES','EBADF'].includes(error?.code)?
        error.code:'OTHER',
      original_outbox_durable:false,power_loss_verified:false});
  }finally{await file.close()}
}
