// Windows NTFS counterpart to POSIX 0600 for the original Wallet #342.
// SECURITY-OWNER PROPOSAL ONLY. No production admission or permission waiver.
// Fail closed when NTFS ACLs cannot be inspected/owned/hardened.
import {execFileSync} from 'node:child_process';
import {realpath,lstat} from 'node:fs/promises';
import {join,win32} from 'node:path';

const POWERSHELL=String.raw`
$ErrorActionPreference='Stop'
$phase='INPUT'
try {
$req=ConvertFrom-Json -InputObject ([Console]::In.ReadToEnd())
$p=[string]$req.path
if(-not [System.IO.Path]::IsPathRooted($p)){throw 'path_must_be_absolute'}
$phase='RESOLVE_FILE'
$item=Get-Item -LiteralPath $p -Force
if(($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0 -or
   ($item.Attributes -band [System.IO.FileAttributes]::Directory) -ne 0){
  throw 'not_plain_file'
}
$phase='OWNER_IDENTITY'
$identity=[System.Security.Principal.WindowsIdentity]::GetCurrent()
$user=$identity.User
$phase='ACL_READ'
$acl=Get-Acl -LiteralPath $p
$phase='OWNER_MATCH'
$currentOwner=$acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
if($currentOwner -ne $user.Value){
  # Elevated Windows process tokens can create a new file with the
  # BUILTIN\\Administrators owner. Only freshly created files entering the
  # explicit hardening path may be reassigned; existing vault READS never do.
  $principal=[System.Security.Principal.WindowsPrincipal]::new($identity)
  $authorizedAdministrator=$principal.IsInRole(
    [System.Security.Principal.WindowsBuiltInRole]::Administrator)
  if([string]$req.action -ne 'harden' -or
     $currentOwner -ne 'S-1-5-32-544' -or -not $authorizedAdministrator){
    throw 'file_owner_not_current_user'
  }
  $phase='SET_OWNER'
  $acl.SetOwner($user)
}
if([string]$req.action -eq 'harden'){
  $phase='SET_ACL'
  $acl.SetAccessRuleProtection($true,$false)
  foreach($rule in @($acl.GetAccessRules($true,$true,
    [System.Security.Principal.SecurityIdentifier]))){
    $acl.RemoveAccessRuleSpecific($rule)
  }
  foreach($sid in @($user,
    [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18'))){
    $grant=[System.Security.AccessControl.FileSystemAccessRule]::new(
      $sid,[System.Security.AccessControl.FileSystemRights]::FullControl,
      [System.Security.AccessControl.AccessControlType]::Allow)
    $acl.AddAccessRule($grant)
  }
  $phase='COMMIT_ACL'
  Set-Acl -LiteralPath $p -AclObject $acl
}
$phase='VERIFY_ACL'
$final=Get-Acl -LiteralPath $p
if($final.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $user.Value){
  throw 'file_owner_changed'
}
if(-not $final.AreAccessRulesProtected){throw 'inherited_access_not_blocked'}
$allowed=@($user.Value,'S-1-5-18')
$ownerAllow=$false
$systemAllow=$false
foreach($rule in @($final.GetAccessRules($true,$true,
  [System.Security.Principal.SecurityIdentifier]))){
  $sid=$rule.IdentityReference.Value
  if($rule.IsInherited -or
     $rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow -or
     $sid -notin $allowed){
    throw 'unexpected_ace'
  }
  if(($rule.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::ReadData) -eq 0){
    throw 'insufficient_ace'
  }
  if($sid -eq $user.Value){$ownerAllow=$true}
  if($sid -eq 'S-1-5-18'){$systemAllow=$true}
}
if(-not ($ownerAllow -and $systemAllow)){throw 'expected_aces_missing'}
[Console]::Out.Write('PRIVATE_FILE_ACL_OK')
} catch {
  # Expose ONLY the finite exception class; never a path, SID or message.
  $class=$_.Exception.GetType().Name
  if($class -notmatch '^[A-Za-z]{3,48}
`;
const SCRIPT=Buffer.from(POWERSHELL,'utf16le').toString('base64');
function powerShellExecutable(){
  const root=process.env.SystemRoot;
  // Do not execute a lookalike binary chosen by PATH or renderer environment.
  if(typeof root!=='string'||!/^[A-Z]:\\Windows$/i.test(root))
    throw Error('trusted Windows PowerShell location unavailable');
  return join(root,'System32','WindowsPowerShell','v1.0','powershell.exe');
}
async function canonicalPrivatePath(target){
  if(typeof target!=='string'||!win32.isAbsolute(target)||
     target.includes('\u0000')||target.includes('\n')||target.includes('\r'))
    throw Error('absolute Windows private-file path required');
  const real=await realpath(target);
  if(win32.normalize(target).toLowerCase()!==win32.normalize(real).toLowerCase())
    throw Error('Windows private-file path redirected');
  const st=await lstat(target);
  if(!st.isFile()||st.isSymbolicLink())
    throw Error('Windows private-file target not regular');
  return {real,st};
}
async function check(target,action){
  if(process.platform!=='win32')
    throw Error('NTFS checks may only run on Windows');
  const before=await canonicalPrivatePath(target);
  let proof;
  try{
    proof=execFileSync(powerShellExecutable(),[
      '-NoProfile','-NonInteractive','-EncodedCommand',SCRIPT
    ],{input:JSON.stringify({path:before.real,action}),
      windowsHide:true,timeout:20000,maxBuffer:4096,encoding:'utf8',
      stdio:['pipe','pipe','pipe']});
  }catch(error){
    // Only a known hardcoded phase name can cross diagnostics; no raw
    // exceptions, SIDs, paths, ACL rules, vaults or other child text.
    const match=/PRIVATE_ACL_PHASE:(INPUT|RESOLVE_FILE|OWNER_IDENTITY|ACL_READ|OWNER_MATCH|SET_OWNER|SET_ACL|COMMIT_ACL|VERIFY_ACL):([A-Za-z]{3,48})/.
      exec(String(error?.stderr||''));
    throw Error('Windows original Wallet private ACL refused at '+
      (match?match[1]+':'+match[2]:'UNCLASSIFIED'));
  }
  if(proof!=='PRIVATE_FILE_ACL_OK')
    throw Error('Windows original Wallet private ACL receipt invalid');
  const after=await canonicalPrivatePath(target);
  if(before.st.dev!==after.st.dev||before.st.ino!==after.st.ino)
    throw Error('Windows private-file identity changed during ACL operation');
  return true;
}
export async function hardenWindowsPrivateFile(path,handle){
  if(process.platform!=='win32')return;
  if(!handle||typeof handle.stat!=='function')
    throw Error('Original Wallet owned private file handle required');
  const st=await handle.stat();
  if(!st.isFile())throw Error('Windows private-file original handle invalid');
  await check(path,'harden');
  const after=await handle.stat();
  if(st.dev!==after.dev||st.ino!==after.ino)
    throw Error('Windows private-file handle changed during ACL hardening');
}
export async function verifyWindowsPrivateFile(path){
  if(process.platform!=='win32')return;
  await check(path,'verify');
}
){$class='Unknown'}
  [Console]::Error.Write('PRIVATE_ACL_PHASE:'+$phase+':'+$class)
  exit 21
}
`;
const SCRIPT=Buffer.from(POWERSHELL,'utf16le').toString('base64');
function powerShellExecutable(){
  const root=process.env.SystemRoot;
  // Do not execute a lookalike binary chosen by PATH or renderer environment.
  if(typeof root!=='string'||!/^[A-Z]:\\Windows$/i.test(root))
    throw Error('trusted Windows PowerShell location unavailable');
  return join(root,'System32','WindowsPowerShell','v1.0','powershell.exe');
}
async function canonicalPrivatePath(target){
  if(typeof target!=='string'||!win32.isAbsolute(target)||
     target.includes('\u0000')||target.includes('\n')||target.includes('\r'))
    throw Error('absolute Windows private-file path required');
  const real=await realpath(target);
  if(win32.normalize(target).toLowerCase()!==win32.normalize(real).toLowerCase())
    throw Error('Windows private-file path redirected');
  const st=await lstat(target);
  if(!st.isFile()||st.isSymbolicLink())
    throw Error('Windows private-file target not regular');
  return {real,st};
}
async function check(target,action){
  if(process.platform!=='win32')
    throw Error('NTFS checks may only run on Windows');
  const before=await canonicalPrivatePath(target);
  let proof;
  try{
    proof=execFileSync(powerShellExecutable(),[
      '-NoProfile','-NonInteractive','-EncodedCommand',SCRIPT
    ],{input:JSON.stringify({path:before.real,action}),
      windowsHide:true,timeout:20000,maxBuffer:4096,encoding:'utf8',
      stdio:['pipe','pipe','pipe']});
  }catch(error){
    // Only a known hardcoded phase name can cross diagnostics; no raw
    // exceptions, SIDs, paths, ACL rules, vaults or other child text.
    const match=/PRIVATE_ACL_PHASE:(INPUT|RESOLVE_FILE|OWNER_IDENTITY|ACL_READ|OWNER_MATCH|SET_OWNER|SET_ACL|COMMIT_ACL|VERIFY_ACL)/.
      exec(String(error?.stderr||''));
    throw Error('Windows original Wallet private ACL refused at '+
      (match?match[1]:'UNCLASSIFIED'));
  }
  if(proof!=='PRIVATE_FILE_ACL_OK')
    throw Error('Windows original Wallet private ACL receipt invalid');
  const after=await canonicalPrivatePath(target);
  if(before.st.dev!==after.st.dev||before.st.ino!==after.st.ino)
    throw Error('Windows private-file identity changed during ACL operation');
  return true;
}
export async function hardenWindowsPrivateFile(path,handle){
  if(process.platform!=='win32')return;
  if(!handle||typeof handle.stat!=='function')
    throw Error('Original Wallet owned private file handle required');
  const st=await handle.stat();
  if(!st.isFile())throw Error('Windows private-file original handle invalid');
  await check(path,'harden');
  const after=await handle.stat();
  if(st.dev!==after.dev||st.ino!==after.ino)
    throw Error('Windows private-file handle changed during ACL hardening');
}
export async function verifyWindowsPrivateFile(path){
  if(process.platform!=='win32')return;
  await check(path,'verify');
}
