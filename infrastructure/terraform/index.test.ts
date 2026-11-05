import { randomUUID } from "node:crypto"
import { mkdir, readdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { CommandOptions, InstallerUI, RunCommand } from "../installer/types.ts"
import { terraformModule } from "./index.ts"

const directories: string[] = []

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

async function scenario({
  actions = ["create"],
  approved = true,
  failure,
}: {
  actions?: string[]
  approved?: boolean
  failure?: "plan" | "show" | "apply"
} = {}) {
  const root = path.resolve(`.installer-terraform-test-${randomUUID()}`)
  directories.push(root)
  const directory = path.join(root, "module")
  const dataDirectory = path.join(root, "installation-data")
  await mkdir(directory, { recursive: true })
  await mkdir(dataDirectory)
  const events: string[] = []
  const calls: { executable: string; args: string[]; options?: CommandOptions }[] = []
  const secret = "synthetic-sensitive-plan-value"
  const ui: InstallerUI = {
    status: vi.fn(),
    confirm: vi.fn(async () => {
      events.push("confirm")
      return approved
    }),
    wait: vi.fn(async () => {}),
  }
  const run: RunCommand = async (executable, args, options) => {
    calls.push({ executable, args, options })
    const operation = args[1]
    events.push(operation)
    if (operation === "plan") {
      const output = args.find((argument) => argument.startsWith("-out="))?.slice(5)
      if (!output) throw new Error("The plan needs an output file")
      await writeFile(output, secret)
    }
    if (operation === failure) throw new Error("Synthetic Terraform failure")
    if (operation === "state") return "azurerm_resource_group.hub\nazurerm_storage_account.hub\n"
    if (operation === "output") return JSON.stringify({ value: "non-secret-output" })
    if (operation === "show") {
      return JSON.stringify({
        resource_changes: [
          {
            address: "azurerm_resource_group.hub",
            change: { actions, before: { password: secret }, after: { password: secret } },
          },
          { address: "azurerm_storage_account.unchanged", change: { actions: ["no-op"] } },
          { address: "data.azurerm_client_config.current", change: { actions: ["read"] } },
        ],
        output_changes: { password: { after: secret, after_sensitive: true } },
      })
    }
    return ""
  }
  const module = terraformModule({
    directory,
    dataDirectory,
    env: { REPLICA_TEST_ENV: "installation-value", TF_DATA_DIR: "wrong-directory" },
    run,
    ui,
  })
  return { module, calls, events, ui, directory, dataDirectory, secret }
}

describe("Terraform module", () => {
  it("keeps all operations in the selected module and installation data directory", async () => {
    const test = await scenario()
    const backend = path.join(test.directory, "backend.hcl")
    const variables = path.join(test.directory, "installation.tfvars")

    await test.module.init(backend)
    expect(await test.module.state()).toEqual([
      "azurerm_resource_group.hub",
      "azurerm_storage_account.hub",
    ])
    expect(await test.module.output("installation")).toEqual({ value: "non-secret-output" })
    await test.module.apply(variables)

    for (const call of test.calls) {
      expect(call.executable).toBe("terraform")
      expect(call.args[0]).toBe(`-chdir=${test.directory}`)
      expect(call.options?.env).toMatchObject({
        REPLICA_TEST_ENV: "installation-value",
        TF_DATA_DIR: test.dataDirectory,
      })
    }
    expect(test.calls.find(({ args }) => args[1] === "init")?.args).toContain(
      `-backend-config=${backend}`,
    )
    const plan = test.calls.find(({ args }) => args[1] === "plan")
    expect(plan?.args).toContain(`-var-file=${variables}`)
    const savedPlan = plan?.args.find((argument) => argument.startsWith("-out="))?.slice(5)
    expect(savedPlan).toBeDefined()
    expect(test.calls.find(({ args }) => args[1] === "apply")?.args.at(-1)).toBe(savedPlan)
    expect(test.events.indexOf("confirm")).toBeLessThan(test.events.indexOf("apply"))
    expect(await readdir(test.dataDirectory)).toEqual([])
  })

  it.each([
    { actions: ["delete"] },
    { actions: ["delete", "create"] },
    { actions: ["create", "delete"] },
  ])(
    "rejects destructive normal-plan actions $actions before confirmation or apply",
    async ({ actions }) => {
      const test = await scenario({ actions })

      await expect(test.module.apply("installation.tfvars")).rejects.toThrow()

      expect(test.ui.confirm).not.toHaveBeenCalled()
      expect(test.events).not.toContain("apply")
      expect(await readdir(test.dataDirectory)).toEqual([])
    },
  )

  it("does not apply when the operator refuses, and removes the sensitive plan", async () => {
    const test = await scenario({ approved: false })

    await expect(test.module.apply("installation.tfvars")).rejects.toThrow()

    expect(test.ui.confirm).toHaveBeenCalledOnce()
    expect(test.events).not.toContain("apply")
    expect(await readdir(test.dataDirectory)).toEqual([])
  })

  it("shows only resource actions and addresses, without plan values or unchanged resources", async () => {
    const test = await scenario()

    await test.module.apply("installation.tfvars")

    const status = vi.mocked(test.ui.status).mock.calls.flat().join("\n")
    expect(status).toContain("create")
    expect(status).toContain("azurerm_resource_group.hub")
    expect(status).not.toContain(test.secret)
    expect(status).not.toContain("unchanged")
    expect(status).not.toContain("data.azurerm_client_config")
    expect(JSON.stringify(vi.mocked(test.ui.confirm).mock.calls)).not.toContain(test.secret)
  })

  it.each(["plan", "show", "apply"] as const)(
    "removes the sensitive plan if %s fails",
    async (failure) => {
      const test = await scenario({ failure })

      await expect(test.module.apply("installation.tfvars")).rejects.toThrow()

      expect(await readdir(test.dataDirectory)).toEqual([])
      if (failure !== "apply") expect(test.events).not.toContain("apply")
    },
  )

  it.each([true, false])(
    "requires separate explicit confirmation for destroy; approval is %s",
    async (approved) => {
      const test = await scenario({ actions: ["delete"], approved })
      const result = test.module.apply("installation.tfvars", { destroy: true })

      if (approved) await result
      else await expect(result).rejects.toThrow()

      expect(test.calls.find(({ args }) => args[1] === "plan")?.args).toContain("-destroy")
      expect(test.ui.confirm).toHaveBeenCalledOnce()
      expect(vi.mocked(test.ui.confirm).mock.calls[0][0]).toMatch(/remove|destroy/i)
      expect(test.events.includes("apply")).toBe(approved)
      if (approved)
        expect(test.events.indexOf("confirm")).toBeLessThan(test.events.indexOf("apply"))
      expect(await readdir(test.dataDirectory)).toEqual([])
    },
  )
})
