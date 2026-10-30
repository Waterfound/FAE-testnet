// Windows NTFS counterpart to POSIX 0600 for the original Wallet #342.
// SECURITY-OWNER PROPOSAL ONLY. No production admission or permission waiver.
// Fail closed when NTFS ACLs cannot be inspected/owned/hardened.
import {execFileSync} from 'node:child_process';
import {realpath,lstat} from 'node:fs/promises';
import {join,win32} from 'node:path';

const POWERSHELL=String.raw`
$ErrorActionPreference='Stop'
$req=ConvertFrom-Json -InputObject ([Console]::In.ReadToEnd())
$p=[string]$req.path
if(-not [System.IO.Path]::IsPathRooted($p)){throw 'path_must_be_absolute'}
$item=Get-Item -LiteralPath $p -Force
if(($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0 -or
   ($item.Attributes -band [System.IO.FileAttributes]::Directory) -ne 0){
  throw 'not_plain_file'
}
$user=[System.Security.Principal.WindowsIdentity]::GetCurrent().User
$acl=Get-Acl -LiteralPath $p
if($acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $user.Value){
  throw 'file_owner_not_current_user'
}
if([string]$req.action -eq 'harden'){
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
  Set-Acl -LiteralPath $p -AclObject $acl
}
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
  }catch{
    // Never expose paths, ACLs, stdout/stderr or untrusted error text.
    throw Error('Windows original Wallet private ACL refused');
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
