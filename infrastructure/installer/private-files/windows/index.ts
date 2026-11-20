import { execFile } from "node:child_process"
import { join } from "node:path"
import { promisify } from "node:util"

const execute = promisify(execFile)
const accessScript = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$user = [Security.Principal.WindowsIdentity]::GetCurrent().User
$system = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
$administrators = [Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
$trusted = @($user.Value, $system.Value, $administrators.Value)
function Assert-Access([string]$path, [bool]$private) {
  $attributes = [IO.File]::GetAttributes($path)
  if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "Setup refuses redirected Windows paths: $path. Existing paths were not changed."
  }
  $acl = if (($attributes -band [IO.FileAttributes]::Directory) -ne 0) {
    [IO.Directory]::GetAccessControl($path)
  } else { [IO.File]::GetAccessControl($path) }
  $owner = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
  if (($private -and $owner -ne $user.Value) -or (!$private -and $owner -notin $trusted)) {
    throw "Setup requires a trusted Windows owner at $path. Private files and directories must be owned by the current user. Existing paths were not changed."
  }
  $sddl = $acl.GetSecurityDescriptorSddlForm('Access')
  if ($sddl -notmatch 'D:' -or $sddl -match 'NO_ACCESS_CONTROL') {
    throw "Setup cannot verify the Windows access rules at $path. Existing paths were not changed."
  }
  $write = [int64]0x500D0156
  foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
    if ($rule.AccessControlType -ne 'Allow' -or (!$private -and ($rule.PropagationFlags -band 2) -ne 0)) { continue }
    if ($rule.IdentityReference.Value -notin $trusted -and
        ($private -or ([int64]$rule.FileSystemRights -band $write) -ne 0)) {
      throw "Setup requires private Windows ACLs at \${path}: allow access only to the current user, SYSTEM, and Administrators; parent directories must not be writable by other users. Existing paths were not changed."
    }
  }
}
function Assert-Parents([string]$path) {
  $parent = [IO.Path]::GetDirectoryName($path)
  while ($parent -and $parent -ne [IO.Path]::GetPathRoot($parent)) {
    if ([IO.Directory]::Exists($parent) -or [IO.File]::Exists($parent)) { Assert-Access $parent $false }
    $parent = [IO.Path]::GetDirectoryName($parent)
  }
}
`

async function windowsAccess(path: string, script: string): Promise<void> {
  const executable = join(
    process.env.SystemRoot ?? "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  )
  try {
    await execute(
      executable,
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-OutputFormat",
        "Text",
        "-EncodedCommand",
        Buffer.from(
          `try {\n${accessScript}\n${script}\n} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }`,
          "utf16le",
        ).toString("base64"),
      ],
      {
        env: { ...process.env, REPLICA_PRIVATE_PATH: path },
        windowsHide: true,
        timeout: 30_000,
      },
    )
  } catch (error) {
    if (!(error instanceof Error)) throw error
    const detail = "stderr" in error && typeof error.stderr === "string" ? error.stderr.trim() : ""
    throw new Error(
      `Setup could not verify or create private Windows storage at ${path}. ${detail || "Check Windows PowerShell availability and directory access."}`,
    )
  }
}

export async function assertWindowsAccess(path: string, privateAccess: boolean): Promise<void> {
  await windowsAccess(
    path,
    `Assert-Access $env:REPLICA_PRIVATE_PATH $${privateAccess}; Assert-Parents $env:REPLICA_PRIVATE_PATH`,
  )
}

export async function createWindowsDirectory(path: string): Promise<void> {
  await windowsAccess(
    path,
    `
Assert-Parents $env:REPLICA_PRIVATE_PATH
$missing = [Collections.Generic.List[string]]::new()
$next = $env:REPLICA_PRIVATE_PATH
while (![IO.Directory]::Exists($next) -and ![IO.File]::Exists($next)) {
  $missing.Add($next)
  $next = [IO.Path]::GetDirectoryName($next)
}
for ($index = $missing.Count - 1; $index -ge 0; $index--) {
  $security = [Security.AccessControl.DirectorySecurity]::new()
  $security.SetOwner($user)
  $security.SetAccessRuleProtection($true, $false)
  foreach ($identity in @($user, $system, $administrators)) {
    $security.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
      $identity, 'FullControl', 'ContainerInherit, ObjectInherit', 'None', 'Allow'))
  }
  [void][IO.Directory]::CreateDirectory($missing[$index], $security)
}
Assert-Access $env:REPLICA_PRIVATE_PATH $true
`,
  )
}
