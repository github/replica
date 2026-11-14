import { randomUUID } from "node:crypto"
import { readdirSync } from "node:fs"
import { mkdir, readdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { CommandExecutionError } from "../installer/command/index.ts"
import type { CommandOptions, InstallerUI, RunCommand } from "../installer/types.ts"
import { terraformModule } from "./index.ts"

vi.mock("node:timers/promises", async (importOriginal) => {
  const timers = await importOriginal<typeof import("node:timers/promises")>()
  return {
    ...timers,
    // Bridge promise timers to the fake clock so cooldown tests never wait in real time.
    setTimeout: (milliseconds: number, value?: unknown, { signal }: { signal?: AbortSignal } = {}) =>
      new Promise((resolve, reject) => {
        signal?.throwIfAborted()
        const abort = () => {
          clearTimeout(timer)
          reject(signal?.reason)
        }
        const timer = setTimeout(() => {
          signal?.removeEventListener("abort", abort)
          resolve(value)
        }, milliseconds)
        signal?.addEventListener("abort", abort, { once: true })
      }),
  }
})

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
type RetryPlan = {
  variables?: { image: { value: string } }
  configuration?: { root_module: { resources: unknown[] } }
  resource_changes: ResourceChange[]
}

function fakeRetryTimers() {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
}

afterEach(async () => {
  vi.useRealTimers()
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
  preapproved,
  planVariables,
  planConfiguration = { root_module: { resources: [] } },
  retryApply,
  signal,
}: {
  actions?: string[]
  approved?: boolean
  failure?: "init" | "plan" | "show" | "apply"
  error?: Error
  failureCount?: number
  resourceChanges?: ResourceChange[]
  preapproved?: boolean
  planVariables?: Record<string, unknown>
  planConfiguration?: Record<string, unknown> | null
  retryApply?(error: CommandExecutionError): boolean
  signal?: AbortSignal
} = {}) {
  const root = path.resolve(`.installer-terraform-test-${randomUUID()}`)
  directories.push(root)
  const directory = path.join(root, "module")
  const dataDirectory = path.join(root, "installation-data")
  await mkdir(directory, { recursive: true })
  await mkdir(dataDirectory, { mode: 0o700 })
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
        ...(planVariables && { variables: planVariables }),
        configuration: planConfiguration,
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
    preapproved,
    retryApply,
    signal,
  })
  return { module, run, calls, events, ui, directory, dataDirectory, secret }
}

describe("Terraform module", () => {
  it("shows initialization details only on request and exits without repeating initialization", async () => {
    const diagnostic = "synthetic-private-backend-diagnostic"
    const error = new CommandExecutionError("Initialize Terraform failed.", false, 1, diagnostic)
    const test = await scenario({ failure: "init", error })
    test.ui.notice = vi.fn()
    test.ui.select = vi
      .fn<Select>()
      .mockImplementationOnce(async (_question, actions) => {
        expect(actions.map(({ value }) => value)).toEqual(["retry", "details", "exit"])
        expect(test.ui.wait).not.toHaveBeenCalled()
        return "details"
      })
      .mockImplementationOnce(async () => {
        expect(test.events).toEqual(["init"])
        return "exit"
      })

    await expect(test.module.init("backend.hcl")).rejects.toBe(error)

    expect(test.ui.wait).toHaveBeenCalledExactlyOnceWith(expect.stringContaining(diagnostic))
    expect(JSON.stringify(vi.mocked(test.ui.notice).mock.calls)).not.toContain(diagnostic)
    expect(JSON.stringify(vi.mocked(test.ui.status).mock.calls)).not.toContain(diagnostic)
    expect(test.ui.select).toHaveBeenCalledTimes(2)
    expect(test.events).toEqual(["init"])
  })

  it("retries only initialization with the same backend after explicit recovery selection", async () => {
    const error = new CommandExecutionError("Initialize Terraform failed.", false, 1)
    const test = await scenario({ failure: "init", failureCount: 1, error, preapproved: true })
    test.ui.select = vi.fn(async () => {
      expect(test.events).toEqual(["init"])
      return "retry"
    })

    await test.module.init("backend.hcl")

    expect(test.events).toEqual(["init", "init"])
    expect(test.calls[1]).toEqual(test.calls[0])
    expect(test.calls[0]?.args).toEqual([
      `-chdir=${test.directory}`,
      "init",
      "-input=false",
      "-lock-timeout=60s",
      "-backend-config=backend.hcl",
    ])
    expect(test.ui.select).toHaveBeenCalledOnce()
    expect(test.ui.confirm).not.toHaveBeenCalled()
  })

  it.each([
    {
      reason: "unattended failure",
      error: new CommandExecutionError("Synthetic failure", false, 1),
      interactive: false,
    },
    {
      reason: "cancellation",
      error: new CommandExecutionError("Synthetic cancellation", true),
      interactive: true,
    },
    { reason: "non-command failure", error: new Error("Synthetic failure"), interactive: true },
  ])("stops initialization without recovery for $reason", async ({ error, interactive }) => {
    const test = await scenario({ failure: "init", error })
    const select = vi.fn(async () => "retry")
    if (interactive) test.ui.select = select

    await expect(test.module.init("backend.hcl")).rejects.toBe(error)

    expect(select).not.toHaveBeenCalled()
    expect(test.events).toEqual(["init"])
  })

  it("waits 15 seconds, discards the failed plan, and applies a fresh approved subset without new consent", async () => {
    fakeRetryTimers()
    const error = new CommandExecutionError(
      "Synthetic apply failure", false, 1, "synthetic-raw-provider-error",
    )
    const retryApply = vi.fn(() => true)
    const controller = new AbortController()
    const test = await scenario({
      preapproved: true,
      failure: "apply",
      failureCount: 1,
      error,
      retryApply,
      signal: controller.signal,
      planVariables: { image: { value: "synthetic-immutable-image" } },
      planConfiguration: {
        root_module: { outputs: { private: { expression: "synthetic-config-metadata" } } },
      },
      resourceChanges: [
        { address: "azurerm_storage_blob.release_lock", change: { actions: ["create"] } },
        { address: "azurerm_container_app_job.setup", change: { actions: ["create"] } },
      ],
    })
    const waiting = Promise.withResolvers<void>()
    test.ui.notice = vi.fn((level) => {
      if (level === "info") waiting.resolve()
    })
    test.ui.select = vi.fn(async () => "exit")
    const run = test.run.getMockImplementation()!
    test.run.mockImplementation(async (executable, args, options) => {
      if (args[1] === "plan") expect(await readdir(test.dataDirectory)).toEqual([])
      const result = await run(executable, args, options)
      if (args[1] !== "show" || test.events.filter((event) => event === "plan").length < 2)
        return result
      const plan = JSON.parse(result)
      plan.resource_changes[1].change.actions = ["no-op"]
      return JSON.stringify(plan)
    })
    const variables = path.join(test.directory, "installation.tfvars")
    const applying = test.module.apply(variables)

    await Promise.race([waiting.promise, applying])
    expect(retryApply).toHaveBeenCalledExactlyOnceWith(error)
    expect(test.events).toEqual(["plan", "show", "apply"])
    expect(await readdir(test.dataDirectory)).toEqual([])
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(14_999)
    expect(test.events).toEqual(["plan", "show", "apply"])
    await vi.advanceTimersByTimeAsync(1)
    await applying

    expect(test.events).toEqual(["plan", "show", "apply", "plan", "show", "apply"])
    expect(test.ui.confirm).not.toHaveBeenCalled()
    expect(test.ui.select).not.toHaveBeenCalled()
    const plans = test.calls.filter(({ args }) => args[1] === "plan")
    const paths = plans.map(({ args }) => args.find((arg) => arg.startsWith("-out="))!.slice(5))
    expect(new Set(paths).size).toBe(2)
    for (const operation of ["apply", "show"])
      expect(
        test.calls.filter(({ args }) => args[1] === operation).map(({ args }) => args.at(-1)),
      ).toEqual(paths)
    for (const call of test.calls) {
      expect(call.args[0]).toBe(`-chdir=${test.directory}`)
      expect(call.options?.signal).toBe(controller.signal)
      expect(call.options?.env).toMatchObject({
        REPLICA_TEST_ENV: "installation-value",
        TF_DATA_DIR: test.dataDirectory,
      })
    }
    for (const plan of plans) expect(plan.args).toContain(`-var-file=${variables}`)
    const displayed = JSON.stringify([
      vi.mocked(test.ui.notice).mock.calls,
      vi.mocked(test.ui.status).mock.calls,
    ])
    for (const privateValue of [
      "synthetic-immutable-image", "synthetic-config-metadata", "synthetic-raw-provider-error",
    ])
      expect(displayed).not.toContain(privateValue)
    expect(await readdir(test.dataDirectory)).toEqual([])
  })

  it("exhausts the automatic budget before manual recovery and does not reset it on manual retry", async () => {
    fakeRetryTimers()
    const error = new CommandExecutionError("Synthetic apply failure", false, 1)
    const test = await scenario({
      preapproved: true,
      failure: "apply",
      failureCount: 3,
      error,
      retryApply: () => true,
      planVariables: {},
    })
    const waiting = Promise.withResolvers<void>()
    test.ui.notice = vi.fn((level) => {
      if (level === "info") waiting.resolve()
    })
    const attemptsAtRecovery: number[] = []
    test.ui.select = vi.fn(async () => {
      attemptsAtRecovery.push(test.events.filter((event) => event === "apply").length)
      expect(await readdir(test.dataDirectory)).toEqual([])
      return attemptsAtRecovery.length === 1 ? "retry" : "exit"
    })
    const result = test.module.apply("installation.tfvars").catch((failure: unknown) => failure)

    await Promise.race([waiting.promise, result])
    await vi.advanceTimersByTimeAsync(15_000)

    expect(await result).toBe(error)
    expect(attemptsAtRecovery).toEqual([2, 3])
    expect(test.events).toEqual([
      "plan", "show", "apply",
      "plan", "show", "apply",
      "plan", "show", "confirm", "apply",
    ])
    expect(test.ui.confirm).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
    expect(await readdir(test.dataDirectory)).toEqual([])
  })

  it.each([
    {
      reason: "changed variables",
      mutate: (plan: RetryPlan) => { plan.variables!.image.value = "synthetic-other-image" },
    },
    { reason: "missing variables", mutate: (plan: RetryPlan) => { delete plan.variables } },
    {
      reason: "changed configuration",
      mutate: (plan: RetryPlan) => {
        plan.configuration!.root_module.resources.push({
          address: "azurerm_resource_group.hub", name: "synthetic-other-name",
        })
      },
    },
    { reason: "missing configuration", mutate: (plan: RetryPlan) => { delete plan.configuration } },
    {
      reason: "wider resource scope",
      mutate: (plan: RetryPlan) => {
        plan.resource_changes.push({
          address: "azurerm_key_vault.extra", change: { actions: ["create"] },
        })
      },
    },
    {
      reason: "deletion",
      mutate: (plan: RetryPlan) => { plan.resource_changes[0]!.change.actions = ["delete"] },
    },
    {
      reason: "replacement",
      mutate: (plan: RetryPlan) => {
        plan.resource_changes[0]!.change.actions = ["create", "delete"]
      },
    },
    { reason: "unreadable JSON", mutate: () => "{" },
  ])("blocks an automatic fresh plan with $reason before apply or manual recovery", async ({ mutate }) => {
    fakeRetryTimers()
    const test = await scenario({
      preapproved: true,
      failure: "apply",
      failureCount: 1,
      error: new CommandExecutionError("Synthetic apply failure", false, 1),
      retryApply: () => true,
      planVariables: { image: { value: "synthetic-original-image" } },
    })
    const waiting = Promise.withResolvers<void>()
    test.ui.notice = vi.fn((level) => {
      if (level === "info") waiting.resolve()
    })
    test.ui.select = vi.fn(async () => "exit")
    const run = test.run.getMockImplementation()!
    test.run.mockImplementation(async (executable, args, options) => {
      const result = await run(executable, args, options)
      if (args[1] !== "show" || test.events.filter((event) => event === "plan").length < 2)
        return result
      const plan = JSON.parse(result)
      return mutate(plan) ?? JSON.stringify(plan)
    })
    const result = test.module.apply("installation.tfvars").catch((failure: unknown) => failure)

    await Promise.race([waiting.promise, result])
    await vi.advanceTimersByTimeAsync(15_000)

    expect(await result).toBeInstanceOf(Error)
    expect(test.events).toEqual(["plan", "show", "apply", "plan", "show"])
    expect(test.ui.confirm).not.toHaveBeenCalled()
    expect(test.ui.select).not.toHaveBeenCalled()
    expect(await readdir(test.dataDirectory)).toEqual([])
  })

  it.each([
    {
      reason: "standalone consumer", preapproved: false, planVariables: {}, failure: "apply" as const,
    },
    {
      reason: "missing initial inputs", preapproved: true,
      planVariables: undefined, failure: "apply" as const,
    },
    {
      reason: "missing initial configuration", preapproved: true,
      planVariables: {}, planConfiguration: null, failure: "apply" as const,
    },
    { reason: "plan failure", preapproved: true, planVariables: {}, failure: "plan" as const },
    { reason: "show failure", preapproved: true, planVariables: {}, failure: "show" as const },
  ])("does not automatically retry a $reason even with a permissive classifier", async (options) => {
    fakeRetryTimers()
    const error = new CommandExecutionError("Synthetic command failure", false, 1)
    const retryApply = vi.fn(() => true)
    const test = await scenario({ ...options, error, retryApply })

    await expect(test.module.apply("installation.tfvars")).rejects.toBe(error)

    expect(test.events.filter((event) => event === "plan")).toHaveLength(1)
    expect(retryApply).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    expect(await readdir(test.dataDirectory)).toEqual([])
  })

  it("cancels the delay without fresh commands or recovery and removes the failed private plan", async () => {
    fakeRetryTimers()
    const controller = new AbortController()
    const test = await scenario({
      preapproved: true,
      failure: "apply",
      error: new CommandExecutionError("Synthetic apply failure", false, 1),
      retryApply: () => true,
      planVariables: {},
      signal: controller.signal,
    })
    const waiting = Promise.withResolvers<void>()
    test.ui.notice = vi.fn((level) => {
      if (level === "info") waiting.resolve()
    })
    test.ui.select = vi.fn(async () => "exit")
    const result = test.module.apply("installation.tfvars").catch((failure: unknown) => failure)

    await Promise.race([waiting.promise, result])
    expect(vi.getTimerCount()).toBe(1)
    controller.abort()
    await vi.advanceTimersByTimeAsync(15_000)

    expect(await result).toMatchObject({ name: "AbortError" })
    expect(test.events).toEqual(["plan", "show", "apply"])
    expect(test.ui.select).not.toHaveBeenCalled()
    expect(await readdir(test.dataDirectory)).toEqual([])
  })

  it("checks cancellation again before executing the retry apply", async () => {
    fakeRetryTimers()
    const controller = new AbortController()
    const test = await scenario({
      preapproved: true,
      failure: "apply",
      failureCount: 1,
      error: new CommandExecutionError("Synthetic apply failure", false, 1),
      retryApply: () => true,
      planVariables: {},
      signal: controller.signal,
    })
    const waiting = Promise.withResolvers<void>()
    test.ui.notice = vi.fn((level) => {
      if (level === "info") waiting.resolve()
    })
    const run = test.run.getMockImplementation()!
    test.run.mockImplementation(async (executable, args, options) => {
      const result = await run(executable, args, options)
      if (args[1] === "show" && test.events.filter((event) => event === "plan").length === 2)
        controller.abort()
      return result
    })
    const result = test.module.apply("installation.tfvars").catch((failure: unknown) => failure)

    await Promise.race([waiting.promise, result])
    await vi.advanceTimersByTimeAsync(15_000)

    expect(await result).toMatchObject({ name: "AbortError" })
    expect(test.events).toEqual(["plan", "show", "apply", "plan", "show"])
    expect(await readdir(test.dataDirectory)).toEqual([])
  })

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
    "rejects destructive normal-plan actions $actions even after deployment approval",
    async ({ actions }) => {
      const test = await scenario({ actions, preapproved: true })
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

  it.each([false, true])(
    "displays safe creation and update plans without values, and honors preapproval %s",
    async (preapproved) => {
      const secret = "synthetic-safe-plan-secret"
      const test = await scenario({
        preapproved,
        resourceChanges: [
          {
            address: "azurerm_resource_group.hub",
            change: { actions: ["create"], after: { password: secret } },
          },
          {
            address: "azurerm_key_vault.hub",
            change: {
              actions: ["update"],
              before: { password: secret },
              after: { password: secret },
            },
          },
          { address: "azurerm_storage_account.unchanged", change: { actions: ["no-op"] } },
          { address: "data.azurerm_client_config.current", change: { actions: ["read"] } },
        ],
      })

      await test.module.apply("installation.tfvars")

      const status = vi.mocked(test.ui.status).mock.calls.flat().join("\n")
      expect(status).toContain("create azurerm_resource_group.hub")
      expect(status).toContain("update azurerm_key_vault.hub")
      expect(status).not.toContain(secret)
      expect(status).not.toContain(test.secret)
      expect(status).not.toContain("unchanged")
      expect(status).not.toContain("data.azurerm_client_config")
      expect(test.ui.confirm).toHaveBeenCalledTimes(preapproved ? 0 : 1)
      expect(test.events).toContain("apply")
      expect(JSON.stringify(vi.mocked(test.ui.confirm).mock.calls)).not.toContain(secret)
      expect(JSON.stringify(vi.mocked(test.ui.confirm).mock.calls)).not.toContain(test.secret)
      expect(await readdir(test.dataDirectory)).toEqual([])
    },
  )

  it("removes only explicitly allowed temporary resources without another deployment confirmation", async () => {
    const allowedDeletions = [
      "azurerm_container_app_job.provision",
      "azurerm_user_assigned_identity.provision",
    ]
    const test = await scenario({
      preapproved: true,
      resourceChanges: allowedDeletions.map((address) => ({
        address,
        change: { actions: ["delete"] },
      })),
    })

    await test.module.apply("installation.tfvars", { destroy: true, allowedDeletions })

    expect(test.calls.find(({ args }) => args[1] === "plan")?.args).toContain("-destroy")
    expect(test.ui.confirm).not.toHaveBeenCalled()
    expect(test.events).toEqual(["plan", "show", "apply"])
    expect(await readdir(test.dataDirectory)).toEqual([])
  })

  it.each([
    {
      kind: "persistent resource",
      address: "azurerm_postgresql_flexible_server.hub",
      actions: ["delete"],
    },
    {
      kind: "different indexed grant",
      address: "azurerm_role_assignment.image[1]",
      actions: ["delete"],
    },
    {
      kind: "delete-before-create replacement",
      address: "azurerm_role_assignment.image[0]",
      actions: ["delete", "create"],
    },
    {
      kind: "create-before-delete replacement",
      address: "azurerm_role_assignment.image[0]",
      actions: ["create", "delete"],
    },
    { kind: "update", address: "azurerm_role_assignment.image[0]", actions: ["update"] },
    {
      kind: "missing allowlist",
      address: "azurerm_role_assignment.image[0]",
      actions: ["delete"],
    },
  ])(
    "blocks a preapproved cleanup containing a $kind without applying or offering recovery",
    async ({ kind, address, actions }) => {
      const test = await scenario({
        preapproved: true,
        resourceChanges: [{ address, change: { actions } }],
      })
      test.ui.select = vi.fn(async () => "exit")

      await expect(
        test.module.apply("installation.tfvars", {
          destroy: true,
          ...(kind === "missing allowlist"
            ? {}
            : { allowedDeletions: ["azurerm_role_assignment.image[0]"] }),
        }),
      ).rejects.toThrow()

      expect(test.ui.confirm).not.toHaveBeenCalled()
      expect(test.ui.select).not.toHaveBeenCalled()
      expect(test.events).toEqual(["plan", "show"])
      expect(await readdir(test.dataDirectory)).toEqual([])
    },
  )

  it.each(["plan", "show", "apply"] as const)(
    "fails immediately without automatic retry when a preapproved %s fails without recovery controls",
    async (failure) => {
      const error = new CommandExecutionError("Synthetic Terraform failure", false, 1)
      const test = await scenario({ failure, error, preapproved: true })

      await expect(test.module.apply("installation.tfvars")).rejects.toBe(error)

      expect(test.events.filter((event) => event === "plan")).toHaveLength(1)
      expect(await readdir(test.dataDirectory)).toEqual([])
      if (failure !== "apply") expect(test.events).not.toContain("apply")
    },
  )

  it.each(["plan", "show", "apply"] as const)(
    "requires fresh-plan approval after explicitly retrying a failed preapproved %s",
    async (failure) => {
      const error = new CommandExecutionError(
        "Synthetic Azure Blob authorization failure",
        false,
        1,
      )
      const test = await scenario({ failure, error, failureCount: 1, preapproved: true })
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
        expect(test.ui.confirm).not.toHaveBeenCalled()
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
      expect(test.ui.confirm).toHaveBeenCalledOnce()
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

  it.each([
    ["plan", "Terraform did not apply changes in this step.", "may have applied"],
    ["apply", "Terraform may have applied some changes.", "did not apply"],
  ] as const)(
    "describes possible changes accurately after a failed %s",
    async (failure, expected, unexpected) => {
      const error = new CommandExecutionError(`Terraform ${failure} failed.`, false, 1)
      const test = await scenario({ failure, error })
      test.ui.notice = vi.fn()
      test.ui.select = vi.fn<Select>(async () => "exit")

      await expect(test.module.apply("installation.tfvars")).rejects.toBe(error)

      const [, message] = vi.mocked(test.ui.notice).mock.calls.find(([level]) => level === "error")!
      expect(message).toContain(expected)
      expect(message).not.toContain(unexpected)
    },
  )

  it("rejects replacements discovered by a fresh plan without another recovery or approval", async () => {
    const actions = ["create"]
    const test = await scenario({
      actions,
      failure: "apply",
      error: new CommandExecutionError("Synthetic partial apply", false, 1),
      failureCount: 1,
      preapproved: true,
    })
    test.ui.select = vi.fn(async () => {
      actions.splice(0, actions.length, "delete", "create")
      return "retry"
    })

    await expect(test.module.apply("installation.tfvars")).rejects.toThrow(/delete|replace/i)

    expect(test.events).toEqual(["plan", "show", "apply", "plan", "show"])
    expect(test.ui.select).toHaveBeenCalledOnce()
    expect(test.ui.confirm).not.toHaveBeenCalled()
    expect(await readdir(test.dataDirectory)).toEqual([])
  })

  it("does not apply again or reopen recovery when approval of the fresh plan is declined", async () => {
    const test = await scenario({
      failure: "apply",
      error: new CommandExecutionError("Synthetic partial apply", false, 1),
      failureCount: 1,
      preapproved: true,
    })
    test.ui.select = vi.fn(async () => "retry")
    test.ui.confirm = vi.fn(async () => false)

    await expect(test.module.apply("installation.tfvars")).rejects.toThrow(/cancel/i)

    expect(test.ui.confirm).toHaveBeenCalledOnce()
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
      fakeRetryTimers()
      const error = new CommandExecutionError("Synthetic destroy failure", false, 1)
      const allowedDeletions = ["azurerm_container_app_job.provision"]
      const test = await scenario({
        failure,
        error,
        preapproved: true,
        retryApply: () => true,
        planVariables: {},
        resourceChanges: [
          { address: allowedDeletions[0]!, change: { actions: ["delete"] } },
        ],
      })
      test.ui.select = vi.fn(async () => "exit")

      await expect(
        test.module.apply("installation.tfvars", { destroy: true, allowedDeletions }),
      ).rejects.toBe(error)

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
