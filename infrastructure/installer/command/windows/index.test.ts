import { randomUUID } from "node:crypto"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { delimiter, join, resolve } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { resolveWindowsCommand } from "./index.ts"

const directories: string[] = []

async function directory(): Promise<string> {
  const path = resolve(`.installer-command-test-${randomUUID()}`)
  directories.push(path)
  await mkdir(path)
  return path
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe.skipIf(process.platform !== "win32")("native Windows Azure CLI resolution", () => {
  it("finds a native az.exe through a case-insensitive PATH without interpreting arguments", async () => {
    const root = await directory()
    const bin = join(root, "native CLI")
    await mkdir(bin)
    const native = join(bin, "az.exe")
    await writeFile(native, "")
    await writeFile(join(bin, "az.cmd"), "")
    const args = ["account", "show", "--query", "a & b | c", "%PATH%", "$(injected)", '"quoted"']
    const env = { Path: [join(root, "missing"), bin].join(delimiter) }

    expect(resolveWindowsCommand("az", args, env)).toEqual({
      executable: native,
      args,
      env,
    })
  })

  it("runs the official az.cmd sibling Python module directly with literal arguments and MSI environment", async () => {
    const root = await directory()
    const bin = join(root, "Azure CLI", "wbin")
    await mkdir(bin, { recursive: true })
    await writeFile(join(bin, "az.cmd"), "")
    const python = resolve(bin, "..", "python.exe")
    await writeFile(python, "")
    const args = ["keyvault", "secret", "set", "--file", "a & b; %PATH% $(injected).json"]
    const env = {
      PATH: bin,
      REPLICA_TEST: "retained",
      AZ_INSTALLER: "previous",
    }

    expect(resolveWindowsCommand("az", args, env)).toEqual({
      executable: python,
      args: ["-IBm", "azure.cli", ...args],
      env: { ...env, AZ_INSTALLER: "MSI" },
    })
    expect(env.AZ_INSTALLER).toBe("previous")
  })

  it("refuses an unsupported batch launcher rather than falling back to cmd.exe", async () => {
    const root = await directory()
    await writeFile(join(root, "az.cmd"), "")

    expect(() => resolveWindowsCommand("az", ["account", "show"], { PATH: root })).toThrow(
      /Python|official Windows Azure CLI/i,
    )
  })

  it("leaves generic commands and explicit executable paths unchanged", async () => {
    const root = await directory()
    await writeFile(join(root, "az.cmd"), "")
    const args = ["a & b", "%PATH%", '"quoted"']
    const env = { PATH: root }

    for (const executable of ["terraform", "az.cmd", join(root, "az.exe")])
      expect(resolveWindowsCommand(executable, args, env)).toEqual({
        executable,
        args,
        env,
      })
  })
})
