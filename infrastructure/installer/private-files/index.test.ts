import { execFile } from "node:child_process"
import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { link, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { promisify } from "node:util"
import { afterEach, describe, expect, it } from "vitest"

import { privateDirectory, readPrivateFile, writePrivateFile } from "./index.ts"

const execute = promisify(execFile)
const directories: string[] = []

async function powershell(script: string, path: string): Promise<string> {
  const { stdout } = await execute(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(
        `$ErrorActionPreference = 'Stop'
      function Get-TestAcl {
        if ([System.IO.Directory]::Exists($env:REPLICA_TEST_ACL_PATH)) {
          return [System.IO.Directory]::GetAccessControl($env:REPLICA_TEST_ACL_PATH)
        }
        return [System.IO.File]::GetAccessControl($env:REPLICA_TEST_ACL_PATH)
      }
      function Set-TestAcl($acl) {
        if ([System.IO.Directory]::Exists($env:REPLICA_TEST_ACL_PATH)) {
          [System.IO.Directory]::SetAccessControl($env:REPLICA_TEST_ACL_PATH, $acl)
        } else {
          [System.IO.File]::SetAccessControl($env:REPLICA_TEST_ACL_PATH, $acl)
        }
      }
      ${script}`,
        "utf16le",
      ).toString("base64"),
    ],
    { env: { ...process.env, REPLICA_TEST_ACL_PATH: path } },
  )
  return stdout.trim()
}

interface Access {
  owner: string
  current: string
  sddl: string
  rules: { sid: string; type: string; rights: number }[]
}

async function access(path: string): Promise<Access> {
  return JSON.parse(
    await powershell(
      `
    $acl = Get-TestAcl
    @{
      owner = $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
      current = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
      sddl = $acl.GetSecurityDescriptorSddlForm('All')
      rules = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) | ForEach-Object {
        @{ sid = $_.IdentityReference.Value; type = $_.AccessControlType.ToString(); rights = [int]$_.FileSystemRights }
      })
    } | ConvertTo-Json -Depth 4 -Compress
  `,
      path,
    ),
  )
}

async function directory(): Promise<string> {
  const path = resolve(`.installer-private-test-${randomUUID()}`)
  directories.push(path)
  await mkdir(path)
  await powershell(
    `
    $user = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
    $acl = [System.Security.AccessControl.DirectorySecurity]::new()
    $acl.SetOwner($user)
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($sid in @($user.Value, 'S-1-5-18', 'S-1-5-32-544')) {
      $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
        [System.Security.Principal.SecurityIdentifier]::new($sid),
        'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
      $acl.AddAccessRule($rule)
    }
    Set-TestAcl $acl
  `,
    path,
  )
  return path
}

async function grantEveryone(path: string, rights = "ReadAndExecute"): Promise<void> {
  await powershell(
    `
    $acl = Get-TestAcl
    $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new(
      [System.Security.Principal.SecurityIdentifier]::new('S-1-1-0'), '${rights}', 'Allow'))
    Set-TestAcl $acl
  `,
    path,
  )
}

function expectPrivate(acl: Access): void {
  expect(acl.owner).toBe(acl.current)
  const allowed = acl.rules.filter(({ type }) => type === "Allow").map(({ sid }) => sid)
  expect([...new Set(allowed)].sort()).toEqual([acl.current, "S-1-5-18", "S-1-5-32-544"].sort())
  expect(
    acl.rules.some(
      ({ sid, type, rights }) => sid === acl.current && type === "Allow" && (rights & 3) === 3,
    ),
  ).toBe(true)
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe.skipIf(process.platform !== "win32")("native Windows private installer files", () => {
  it("creates private nested directories and readable, writable files without changing the parent ACL", async () => {
    const root = await directory()
    const before = await access(root)
    const nested = join(root, "new directory", "private")
    const path = join(nested, "installation.json")

    expect(await privateDirectory(nested)).toBe(true)
    await writePrivateFile(path, "first", { exclusive: true })
    expect(await readPrivateFile(path)).toBe("first")
    await writePrivateFile(path, "updated")
    expect(await readPrivateFile(path)).toBe("updated")

    for (const target of [join(root, "new directory"), nested, path])
      expectPrivate(await access(target))
    expect(await access(root)).toEqual(before)
  }, 30_000)

  it("reads an existing private file and refuses exclusive replacement without changing its bytes or ACL", async () => {
    const root = await directory()
    const path = join(root, "existing.json")
    await writeFile(path, "preserved")
    const before = await access(path)

    expect(await readPrivateFile(path)).toBe("preserved")
    await expect(writePrivateFile(path, "replacement", { exclusive: true })).rejects.toThrow()

    expect(await readFile(path, "utf8")).toBe("preserved")
    expect(await access(path)).toEqual(before)
    expect(await readdir(root)).toEqual(["existing.json"])
  }, 30_000)

  it("publishes only one of two concurrent exclusive writes and leaves no temporary files", async () => {
    const root = await directory()
    const path = join(root, "installation.json")

    const results = await Promise.allSettled([
      writePrivateFile(path, "first", { exclusive: true }),
      writePrivateFile(path, "second", { exclusive: true }),
    ])

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1)
    const winner = results[0]!.status === "fulfilled" ? "first" : "second"
    expect(await readPrivateFile(path)).toBe(winner)
    expectPrivate(await access(path))
    expect(await readdir(root)).toEqual(["installation.json"])
  }, 30_000)

  it("refuses Everyone-readable existing files and directories without repairing their ACLs", async () => {
    const root = await directory()
    const path = join(root, "shared.json")
    await writeFile(path, "preserved")
    await grantEveryone(path)
    const fileBefore = await access(path)

    await expect(readPrivateFile(path)).rejects.toThrow()
    await expect(writePrivateFile(path, "replacement")).rejects.toThrow()
    expect(await readFile(path, "utf8")).toBe("preserved")
    expect(await access(path)).toEqual(fileBefore)

    await grantEveryone(root)
    const directoryBefore = await access(root)
    await expect(privateDirectory(root)).rejects.toThrow()
    await expect(writePrivateFile(join(root, "new.json"), "new")).rejects.toThrow()
    expect(await access(root)).toEqual(directoryBefore)
    expect(await readdir(root)).toEqual(["shared.json"])
  }, 30_000)

  it("refuses a writable shared parent rather than creating or securing a child under it", async () => {
    const root = await directory()
    await grantEveryone(root, "Modify")
    const before = await access(root)

    await expect(privateDirectory(join(root, "new", "private"))).rejects.toThrow()

    expect(await access(root)).toEqual(before)
    expect(await readdir(root)).toEqual([])
  }, 30_000)

  it("checks a mapped volume root for Everyone delete-child access without changing its ACL", async () => {
    const root = await directory()
    const letters = await powershell(
      "ConvertTo-Json -InputObject @([System.IO.DriveInfo]::GetDrives().Name) -Compress",
      root,
    )
    const occupied = new Set(
      (JSON.parse(letters) as string[]).map((path) => path[0]!.toUpperCase()),
    )
    const letter = [..."ZYXWVUTSRQPONMLKJIHGFED"].find(
      (value) => !occupied.has(value) && !existsSync(`${value}:\\`),
    )
    if (!letter) throw new Error("No unused drive letter is available for the isolated root ACL test")
    const drive = `${letter}:`
    const privatePath = join(root, "private")
    await mkdir(privatePath)
    await grantEveryone(root, "DeleteSubdirectoriesAndFiles")
    const before = await access(root)
    let mapped = false
    try {
      await execute("subst.exe", [drive, root])
      mapped = true
      expect(await access(`${drive}\\`)).toEqual(before)

      await expect(privateDirectory(`${drive}\\private`, { create: false })).rejects.toThrow()

      expect(await access(root)).toEqual(before)
      expect(await readdir(root)).toEqual(["private"])
    } finally {
      if (mapped) await execute("subst.exe", [drive, "/D"])
    }
  }, 30_000)

  it("refuses directory junctions and hard-linked files while preserving their targets", async () => {
    const root = await directory()
    const target = join(root, "target")
    await privateDirectory(target)
    const path = join(target, "installation.json")
    await writePrivateFile(path, "preserved")
    const before = await access(path)
    const redirected = join(root, "redirected")
    await symlink(target, redirected, "junction")

    await expect(privateDirectory(redirected)).rejects.toThrow()
    await expect(readPrivateFile(join(redirected, "installation.json"))).rejects.toThrow()
    await expect(
      writePrivateFile(join(redirected, "installation.json"), "replacement"),
    ).rejects.toThrow()

    const alias = join(target, "alias.json")
    await link(path, alias)
    await expect(readPrivateFile(path)).rejects.toThrow()
    await expect(writePrivateFile(alias, "replacement")).rejects.toThrow()
    expect(await readFile(path, "utf8")).toBe("preserved")
    expect(await readFile(alias, "utf8")).toBe("preserved")
    expect(await access(path)).toEqual(before)
    expect(await readdir(target)).toEqual(["alias.json", "installation.json"])
  }, 30_000)
})
