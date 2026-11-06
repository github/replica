import { randomUUID } from "node:crypto"
import { readdirSync } from "node:fs"
import { mkdir, readdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { CommandExecutionError } from "../installer/command/index.ts"
import type { CommandOptions, InstallerUI, RunCommand } from "../installer/types.ts"
import { terraformModule } from "./index.ts"

const directories: string[] = []
type Select = NonNullable<InstallerUI["select"]>
type ResourceChange = {
  address: string
  change: {
    actions: string[]
    replace_paths?: (string | number)[][]
    before?: unknown
    after?: unknown
  }
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

async function scenario({
  actions = ["create"],
  approved = true,
  failure,
  error = new Error("Synthetic Terraform failure"),
  failureCount = Infinity,
  resourceChanges,
}: {
  actions?: string[]
  approved?: boolean
  failure?: "plan" | "show" | "apply"
  error?: Error
  failureCount?: number
  resourceChanges?: ResourceChange[]
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
  const run = vi.fn<RunCommand>(async (executable, args, options) => {
    calls.push({ executable, args, options })
    const operation = args[1]
    events.push(operation)
    if (operation === "plan") {
      const output = args.find((argument) => argument.startsWith("-out="))?.slice(5)
      if (!output) throw new Error("The plan needs an output file")
      await writeFile(output, secret)
    }
    if (operation === failure && failureCount-- > 0) throw error
    if (operation === "state") return "azurerm_resource_group.hub\nazurerm_storage_account.hub\n"
    if (operation === "output") return JSON.stringify({ value: "non-secret-output" })
    if (operation === "show") {
      return JSON.stringify({
        resource_changes: resourceChanges ?? [
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
  })
  const module = terraformModule({
    directory,
    dataDirectory,
    env: { REPLICA_TEST_ENV: "installation-value", TF_DATA_DIR: "wrong-directory" },
    run,
    ui,
  })
  return { module, run, calls, events, ui, directory, dataDirectory, secret }
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
      test.ui.select = vi.fn(async () => "exit")

      await expect(test.module.apply("installation.tfvars")).rejects.toThrow()

      expect(test.ui.confirm).not.toHaveBeenCalled()
      expect(test.ui.select).not.toHaveBeenCalled()
      expect(test.events).not.toContain("apply")
      expect(await readdir(test.dataDirectory)).toEqual([])
    },
  )

  it("explains every blocked action and replacement path without exposing plan values or offering retry", async () => {
    const secret = "synthetic-blocked-plan-secret"
    const test = await scenario({
      resourceChanges: [
        {
          address: "azurerm_container_app_environment.hub",
          change: {
            actions: ["delete", "create"],
            replace_paths: [["infrastructure_resource_group_name"]],
            before: { infrastructure_resource_group_name: secret },
            after: { infrastructure_resource_group_name: null },
          },
        },
        {
          address: "azurerm_container_app_job.setup",
          change: {
            actions: ["create", "delete"],
            replace_paths: [
              ["container_app_environment_id"],
              ["template", 0, "container", 0, "image"],
            ],
            before: { password: secret },
            after: { password: secret },
          },
        },
        {
          address: "azurerm_role_assignment.obsolete",
          change: { actions: ["delete"], before: { principal_id: secret }, after: null },
        },
        {
          address: "azurerm_storage_blob.release_lock",
          change: { actions: ["create"], after: { content: secret } },
        },
      ],
    })
    test.ui.notice = vi.fn()
    test.ui.select = vi.fn(async () => "exit")
    const error = await test.module.apply("installation.tfvars").catch((error: unknown) => error)

    expect(error).toBeInstanceOf(Error)
    const message = (error as Error).message
    for (const resource of [
      "azurerm_container_app_environment.hub",
      "azurerm_container_app_job.setup",
      "azurerm_role_assignment.obsolete",
    ])
      expect(message).toContain(resource)
    for (const attribute of [
      "infrastructure_resource_group_name",
      "container_app_environment_id",
      "template",
      "container",
      "image",
    ])
      expect(message).toContain(attribute)
    expect(message).toMatch(/template[^a-z0-9]+0[^a-z0-9]+container[^a-z0-9]+0[^a-z0-9]+image/)
    expect(message).toMatch(/delete.*create/)
    expect(message).toMatch(/create.*delete/)
    const displayed = JSON.stringify({
      message,
      status: vi.mocked(test.ui.status).mock.calls,
      notices: vi.mocked(test.ui.notice).mock.calls,
      confirmations: vi.mocked(test.ui.confirm).mock.calls,
      details: vi.mocked(test.ui.wait).mock.calls,
    })
    expect(displayed).not.toContain(secret)
    expect(displayed).not.toContain(test.secret)
    expect(displayed).not.toMatch(/"(?:before|after|output_changes)"\s*:/)
    expect(test.ui.confirm).not.toHaveBeenCalled()
    expect(test.ui.select).not.toHaveBeenCalled()
    expect(test.ui.wait).not.toHaveBeenCalled()
    expect(test.events).toEqual(["plan", "show"])
    expect(await readdir(test.dataDirectory)).toEqual([])
  })

  it("does not apply when the operator refuses, and removes the sensitive plan", async () => {
    const test = await scenario({ approved: false })
    test.ui.select = vi.fn(async () => "exit")

    await expect(test.module.apply("installation.tfvars")).rejects.toThrow()

    expect(test.ui.confirm).toHaveBeenCalledOnce()
    expect(test.ui.select).not.toHaveBeenCalled()
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
    "fails immediately and removes the sensitive plan without a recovery menu if %s fails",
    async (failure) => {
      const error = new CommandExecutionError("Synthetic Terraform failure", false, 1)
      const test = await scenario({ failure, error })

      await expect(test.module.apply("installation.tfvars")).rejects.toBe(error)

      expect(test.events.filter((event) => event === "plan")).toHaveLength(1)
      expect(await readdir(test.dataDirectory)).toEqual([])
      if (failure !== "apply") expect(test.events).not.toContain("apply")
    },
  )

  it.each(["plan", "show", "apply"] as const)(
    "replans only the current Terraform step after an explicit retry of a failed %s",
    async (failure) => {
      const error = new CommandExecutionError(
        "Synthetic Azure Blob authorization failure",
        false,
        1,
      )
      const test = await scenario({ failure, error, failureCount: 1 })
      const run = test.run.getMockImplementation()!
      test.run.mockImplementation(async (executable, args, options) => {
        const result = await run(executable, args, options)
        if (args[1] !== "show" || test.events.filter((event) => event === "plan").length < 2)
          return result
        return result.replaceAll("azurerm_resource_group.hub", "azurerm_storage_blob.release_lock")
      })
      let beforeRetry = 0
      test.ui.select = vi.fn<Select>(async (_question, actions) => {
        expect(await readdir(test.dataDirectory)).toEqual([])
        expect(test.events.filter((event) => event === "plan")).toHaveLength(1)
        expect(actions).toContainEqual({
          label: expect.stringMatching(/replan.*review/i),
          value: "retry",
        })
        beforeRetry = vi.mocked(test.ui.status).mock.calls.length
        return "retry"
      })
      const variables = path.join(test.directory, "installation.tfvars")

      await expect(test.module.apply(variables)).resolves.toBeUndefined()

      expect(test.ui.select).toHaveBeenCalledOnce()
      expect(test.ui.confirm).toHaveBeenCalledTimes(failure === "apply" ? 2 : 1)
      const plans = test.calls.filter(({ args }) => args[1] === "plan")
      const savedPlans = plans.map(({ args }) =>
        args.find((argument) => argument.startsWith("-out="))?.slice(5),
      )
      expect(plans).toHaveLength(2)
      expect(savedPlans.every(Boolean)).toBe(true)
      expect(new Set(savedPlans).size).toBe(2)
      expect(test.calls.at(-1)?.args.at(-1)).toBe(savedPlans[1])
      expect(
        test.calls
          .filter(({ args }) => args[1] === "show")
          .at(-1)
          ?.args.at(-1),
      ).toBe(savedPlans[1])
      const review = vi.mocked(test.ui.status).mock.calls.slice(beforeRetry).flat().join("\n")
      expect(review).toContain("create azurerm_storage_blob.release_lock")
      expect(review).not.toContain("azurerm_resource_group.hub")
      expect(review).not.toContain(test.secret)
      expect(test.events.slice(test.events.lastIndexOf("plan"))).toEqual([
        "plan",
        "show",
        "confirm",
        "apply",
      ])
      for (const call of test.calls) {
        expect(call.executable).toBe("terraform")
        expect(call.args[0]).toBe(`-chdir=${test.directory}`)
        expect(call.options?.env).toMatchObject({
          REPLICA_TEST_ENV: "installation-value",
          TF_DATA_DIR: test.dataDirectory,
        })
        expect(["plan", "show", "apply"]).toContain(call.args[1])
        if (call.args[1] !== "show") expect(call.args).toContain("-lock-timeout=60s")
      }
      for (const plan of plans) expect(plan.args).toContain(`-var-file=${variables}`)
      expect(await readdir(test.dataDirectory)).toEqual([])
    },
  )

  it("removes the failed plan before displaying bounded recovery controls and full local details", async () => {
    const headline = `Terraform apply failed. ${"Synthetic headline ".repeat(30)}`
    const detail = Array.from({ length: 80 }, (_, index) => `Synthetic error detail ${index}`).join(
      "\n",
    )
    const error = new CommandExecutionError(`${headline}\n${detail}`, false, 1)
    const test = await scenario({ failure: "apply", error })
    test.ui.notice = vi.fn((level, message) => {
      if (level !== "error") return
      expect(readdirSync(test.dataDirectory)).toEqual([])
      expect(message).toContain("Terraform apply failed.")
      expect(message.length).toBeLessThan(1_000)
      expect(message).not.toContain(headline)
      expect(message).not.toContain(detail)
      expect(message).toMatch(/partial|may.*(?:created|changed|applied)/i)
    })
    test.ui.wait = vi.fn(async (message) => {
      expect(message).toContain(error.message)
      expect(test.events).toEqual(["plan", "show", "confirm", "apply"])
      expect(await readdir(test.dataDirectory)).toEqual([])
    })
    let menus = 0
    test.ui.select = vi.fn<Select>(async (_question, actions) => {
      expect(actions.map(({ value }) => value)).toEqual(
        expect.arrayContaining(["retry", "details", "exit"]),
      )
      expect(test.events).toEqual(["plan", "show", "confirm", "apply"])
      expect(await readdir(test.dataDirectory)).toEqual([])
      return menus++ === 0 ? "details" : "exit"
    })

    await expect(test.module.apply("installation.tfvars")).rejects.toBe(error)

    expect(test.ui.notice).toHaveBeenCalledWith("error", expect.any(String))
    expect(test.ui.wait).toHaveBeenCalledOnce()
    expect(test.ui.select).toHaveBeenCalledTimes(2)
    expect(await readdir(test.dataDirectory)).toEqual([])
  })

  it("rejects replacements discovered by a fresh plan without another recovery or approval", async () => {
    const actions = ["create"]
    const test = await scenario({
      actions,
      failure: "apply",
      error: new CommandExecutionError("Synthetic partial apply", false, 1),
      failureCount: 1,
    })
    test.ui.select = vi.fn(async () => {
      actions.splice(0, actions.length, "delete", "create")
      return "retry"
    })

    await expect(test.module.apply("installation.tfvars")).rejects.toThrow(/delete|replace/i)

    expect(test.events).toEqual(["plan", "show", "confirm", "apply", "plan", "show"])
    expect(test.ui.select).toHaveBeenCalledOnce()
    expect(test.ui.confirm).toHaveBeenCalledOnce()
    expect(await readdir(test.dataDirectory)).toEqual([])
  })

  it("does not apply again or reopen recovery when approval of the fresh plan is declined", async () => {
    const test = await scenario({
      failure: "apply",
      error: new CommandExecutionError("Synthetic partial apply", false, 1),
      failureCount: 1,
    })
    test.ui.select = vi.fn(async () => "retry")
    test.ui.confirm = vi.fn().mockResolvedValueOnce(true).mockResolvedValue(false)

    await expect(test.module.apply("installation.tfvars")).rejects.toThrow(/cancel/i)

    expect(test.ui.confirm).toHaveBeenCalledTimes(2)
    expect(test.ui.select).toHaveBeenCalledOnce()
    expect(test.events.filter((event) => event === "apply")).toHaveLength(1)
    expect(await readdir(test.dataDirectory)).toEqual([])
  })

  it.each([
    new Error("Synthetic non-command failure"),
    new DOMException("Synthetic cancellation", "AbortError"),
    new CommandExecutionError("Synthetic command cancellation", true),
  ])("propagates $name without offering command recovery", async (error) => {
    const test = await scenario({ failure: "apply", error })
    test.ui.select = vi.fn(async () => "exit")

    await expect(test.module.apply("installation.tfvars")).rejects.toBe(error)

    expect(test.ui.select).not.toHaveBeenCalled()
    expect(test.events.filter((event) => event === "plan")).toHaveLength(1)
    expect(await readdir(test.dataDirectory)).toEqual([])
  })

  it("does not treat a command-shaped approval failure as a Terraform command failure", async () => {
    const error = new CommandExecutionError("Synthetic confirmation failure", false, 1)
    const test = await scenario()
    test.ui.confirm = vi.fn(async () => {
      throw error
    })
    test.ui.select = vi.fn(async () => "exit")

    await expect(test.module.apply("installation.tfvars")).rejects.toBe(error)

    expect(test.ui.select).not.toHaveBeenCalled()
    expect(test.events).not.toContain("apply")
    expect(await readdir(test.dataDirectory)).toEqual([])
  })

  it.each(["plan", "show", "apply"] as const)(
    "keeps temporary-resource destroy fail-fast if %s fails even with a recovery menu",
    async (failure) => {
      const error = new CommandExecutionError("Synthetic destroy failure", false, 1)
      const test = await scenario({ actions: ["delete"], failure, error })
      test.ui.select = vi.fn(async () => "exit")

      await expect(test.module.apply("installation.tfvars", { destroy: true })).rejects.toBe(error)

      expect(test.ui.select).not.toHaveBeenCalled()
      expect(test.events.filter((event) => event === "plan")).toHaveLength(1)
      expect(await readdir(test.dataDirectory)).toEqual([])
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
