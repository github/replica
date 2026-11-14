import { randomUUID } from "node:crypto"
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { afterEach, expect, it, vi } from "vitest"

import { CommandExecutionError } from "../../../installer/command/index.ts"
import type { DeploymentConfig, RunCommand, WizardUI } from "../../../installer/types.ts"
import { installationNames } from "../../install/settings.ts"
import { parseTerraformLock } from "../parse-state-lock/index.ts"
import type { RemovalContext } from "../types.ts"
import { recoverTerraformState } from "./index.ts"

vi.mock("node:timers/promises", () => ({ setTimeout: vi.fn(async () => {}) }))

const directories: string[] = []
afterEach(async () => {
  vi.resetAllMocks()
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function scenario() {
  const root = resolve(`.state-recovery-test-${randomUUID()}`)
  directories.push(root)
  await mkdir(root, { mode: 0o700 })
  const directory = join(root, "original")
  const staging = join(root, "staging")
  await mkdir(directory, { mode: 0o700 })
  await mkdir(staging, { mode: 0o700 })
  const originals = new Map([
    ["backend.hcl", 'storage_account_name = "foreign-account"\nkey = "foreign/key"\n'],
    ["terraform.tfstate", '{"synthetic":"original backend cache"}'],
    ["installation.tfvars.json", '{"synthetic":"retained inputs"}'],
  ])
  for (const [name, content] of originals)
    await writeFile(join(directory, name), content, { mode: 0o600 })
  const config: DeploymentConfig = {
    version: 1, cloud: "azure", name: "sample-hub", owner: "sample-team",
    azure: {
      subscriptionId: "00000000-0000-0000-0000-000000000001",
      tenantId: "00000000-0000-0000-0000-000000000002",
      location: "eastus2", resourceGroup: "sample-hub-rg",
    },
  }
  const info = {
    ID: "00000000-0000-0000-0000-000000000003",
    Path: "terraform/sample-hub/app.tfstate",
    Who: "synthetic-private-operator@synthetic-host",
    Operation: "OperationTypeApply", Version: "1.13.4", Created: "2026-11-10T18:00:00Z",
  }
  const head = {
    lease: { status: "locked", state: "leased", duration: "infinite" },
    lock: Buffer.from(JSON.stringify(info)).toString("base64"),
    etag: '"synthetic-etag"', modified: "2026-11-10T18:00:00Z", size: 128,
  }
  const state = {
    head: head as unknown,
    forceError: undefined as Error | undefined,
    leaveLocked: false,
  }
  const expected = parseTerraformLock(head, info.Path)!
  const azure = vi.fn(async (...args: string[]) => {
    expect(args).toEqual([
      "storage", "blob", "show",
      "--account-name", installationNames(config).stateAccount,
      "--container-name", "terraform", "--name", "sample-hub/app.tfstate",
      "--auth-mode", "login", "--query",
      "{lease:properties.lease,lock:metadata.terraformlockid,etag:properties.etag,modified:properties.lastModified,size:properties.contentLength}",
    ])
    return JSON.stringify(state.head)
  })
  const run = vi.fn<RunCommand>(async (executable, args) => {
    expect(executable).toBe("terraform")
    if (args[1] === "init") return ""
    if (args[1] !== "force-unlock") throw new Error("Unexpected synthetic recovery operation")
    if (state.forceError) throw state.forceError
    if (!state.leaveLocked)
      state.head = { lease: { status: "unlocked", state: "available", duration: null } }
    return ""
  })
  const ui: WizardUI = {
    cloud: vi.fn(), select: vi.fn(), confirm: vi.fn(), text: vi.fn(),
    wait: vi.fn(), status: vi.fn(), notice: vi.fn(),
  }
  const abort = new AbortController()
  const context: RemovalContext = {
    config, target: { path: join(root, "config.json"), config },
    directory, run, ui, azure, signal: abort.signal,
    env: {
      ARM_SUBSCRIPTION_ID: config.azure.subscriptionId,
      SYNTHETIC_ENV: "retained", TF_WORKSPACE: "foreign-workspace",
    },
  }
  const verify = vi.fn(async () => "synthetic-stable-safety-evidence")
  vi.mocked(delay).mockImplementation(async () => {})
  return {
    context, run, azure, verify, abort, head, info, state, expected, staging, originals,
    recover: () => recoverTerraformState(context, { kind: "app", staging, expected, verify }),
  }
}

it("unlocks only the stable exact lease after canonical private initialization and two unchanged safety observations", async () => {
  const test = await scenario()
  const trustedPath = resolve("azure/application.tf")
  const trustedBefore = await readFile(trustedPath, "utf8")
  let release = () => {}
  const waiting = new Promise<void>((resolve) => { release = resolve })
  vi.mocked(delay).mockImplementationOnce(async () => waiting)
  const pending = test.recover()

  await vi.waitFor(() => expect(delay).toHaveBeenCalledOnce())
  expect(test.run.mock.calls.map(([, args]) => args[1])).toEqual(["init"])
  expect(delay).toHaveBeenCalledWith(1_000, undefined, { signal: test.abort.signal })
  release()
  await pending

  const recovery = join(test.staging, "recover-app")
  const source = join(recovery, "app")
  const data = join(recovery, "app-data")
  const backend = join(recovery, "app-backend.hcl")
  expect(test.run.mock.calls).toEqual([
    ["terraform", [`-chdir=${source}`, "init", "-input=false", "-lock-timeout=60s", `-backend-config=${backend}`], {
      env: { ...test.context.env, TF_DATA_DIR: data, TF_WORKSPACE: "default" },
      signal: test.abort.signal,
    }],
    ["terraform", [`-chdir=${source}`, "force-unlock", "-force", test.info.ID], {
      env: { ...test.context.env, TF_DATA_DIR: data, TF_WORKSPACE: "default" },
      signal: test.abort.signal,
    }],
  ])
  const names = installationNames(test.context.config)
  expect(await readFile(backend, "utf8")).toBe([
    `resource_group_name = "${names.stateGroup}"`,
    `storage_account_name = "${names.stateAccount}"`,
    'container_name = "terraform"', 'key = "sample-hub/app.tfstate"',
    "use_azuread_auth = true", "use_oidc = false",
    `subscription_id = "${test.context.config.azure.subscriptionId}"`,
    `tenant_id = "${test.context.config.azure.tenantId}"`,
  ].join("\n"))
  for (const directory of [recovery, source, data])
    expect((await stat(directory)).mode & 0o777).toBe(0o700)
  for (const name of await readdir(source))
    expect((await stat(join(source, name))).mode & 0o777).toBe(0o600)
  expect((await stat(backend)).mode & 0o777).toBe(0o600)
  expect(await readFile(join(source, "application.tf"), "utf8"))
    .toBe(trustedBefore.replace("prevent_destroy = true", "prevent_destroy = false"))
  expect(await readFile(trustedPath, "utf8")).toBe(trustedBefore)
  for (const [name, content] of test.originals)
    expect(await readFile(join(test.context.directory, name), "utf8")).toBe(content)
  expect(test.verify).toHaveBeenCalledTimes(4)
  expect(test.context.ui.confirm).not.toHaveBeenCalled()
  expect(test.context.ui.select).not.toHaveBeenCalled()
})

it("skips an already unlocked state before staging or initialization", async () => {
  const test = await scenario()
  test.state.head = { lease: { status: "unlocked", state: "expired" } }

  await test.recover()

  expect(test.verify).toHaveBeenCalledOnce()
  expect(test.run).not.toHaveBeenCalled()
  expect(await readdir(test.staging)).toEqual([])
})

it("rejects a replaced lock before initialization rather than unlocking the replacement ID", async () => {
  const test = await scenario()
  test.state.head = {
    ...test.head,
    lock: Buffer.from(JSON.stringify({
      ...test.info, ID: "00000000-0000-0000-0000-000000000099",
    })).toString("base64"),
  }

  await expect(test.recover()).rejects.toThrow(/changed/i)

  expect(test.run).not.toHaveBeenCalled()
  expect(await readdir(test.staging)).toEqual([])
})

it.each(["etag", "metadata", "size", "modified", "safety evidence", "active job"] as const)(
  "never unlocks when %s changes during the stability interval",
  async (change) => {
    const test = await scenario()
    vi.mocked(delay).mockImplementationOnce(async () => {
      if (change === "etag") test.state.head = { ...test.head, etag: '"another-etag"' }
      if (change === "metadata")
        test.state.head = {
          ...test.head,
          lock: Buffer.from(JSON.stringify({ ...test.info, Created: "2026-11-10T18:00:01Z" }))
            .toString("base64"),
        }
      if (change === "size") test.state.head = { ...test.head, size: 129 }
      if (change === "modified")
        test.state.head = { ...test.head, modified: "2026-11-10T18:00:01Z" }
      if (change === "safety evidence") test.verify.mockResolvedValue("changed-safety-evidence")
      if (change === "active job") test.verify.mockRejectedValue(new Error("Active database job"))
    })

    await expect(test.recover()).rejects.toThrow(change === "active job" ? /active/i : /changed/i)

    expect(test.run.mock.calls.map(([, args]) => args[1])).toEqual(["init"])
    expect(test.context.ui.confirm).not.toHaveBeenCalled()
  },
)

it("rechecks the lock after initialization before waiting or unlocking", async () => {
  const test = await scenario()
  test.verify.mockImplementationOnce(async () => "stable").mockImplementationOnce(async () => {
    test.state.head = { ...test.head, etag: '"changed-during-init"' }
    return "stable"
  })

  await expect(test.recover()).rejects.toThrow(/changed/i)

  expect(test.run.mock.calls.map(([, args]) => args[1])).toEqual(["init"])
  expect(delay).not.toHaveBeenCalled()
})

it("does not unlock if the safety proof fails before initialization", async () => {
  const test = await scenario()
  test.verify.mockRejectedValue(new Error("Ownership could not be verified"))

  await expect(test.recover()).rejects.toThrow(/ownership/i)

  expect(test.azure).not.toHaveBeenCalled()
  expect(test.run).not.toHaveBeenCalled()
  expect(await readdir(test.staging)).toEqual([])
})

it.each(["before recovery", "during stability interval"] as const)(
  "honors cancellation %s without an unlock",
  async (when) => {
    const test = await scenario()
    if (when === "before recovery") test.abort.abort()
    else vi.mocked(delay).mockImplementationOnce(async (_ms, _value, options) => {
      expect(options?.signal).toBe(test.abort.signal)
      test.abort.abort()
      options!.signal!.throwIfAborted()
    })

    await expect(test.recover()).rejects.toThrow()

    expect(test.run.mock.calls.some(([, args]) => args[1] === "force-unlock")).toBe(false)
    if (when === "before recovery") expect(test.verify).not.toHaveBeenCalled()
  },
)

it("does not force-unlock a state released by its original writer during the stability interval", async () => {
  const test = await scenario()
  vi.mocked(delay).mockImplementationOnce(async () => {
    test.state.head = { lease: { status: "unlocked", state: "available" } }
  })

  await test.recover()

  expect(test.run.mock.calls.map(([, args]) => args[1])).toEqual(["init"])
})

it.each([false, true])("never retries an ambiguous force-unlock failure and sanitizes diagnostics (aborted=%s)", async (aborted) => {
  const test = await scenario()
  const raw = `synthetic-private-command-output ${test.info.ID} ${test.info.Who}`
  test.state.forceError = new CommandExecutionError(raw, aborted, 2, raw)
  const error = await test.recover().catch((error: unknown) => error)

  expect(error).toBeInstanceOf(CommandExecutionError)
  expect(error).toMatchObject({ aborted, exitCode: 2 })
  const displayed = `${String(error)} ${(error as CommandExecutionError).details()} ${
    JSON.stringify(vi.mocked(test.context.ui.status).mock.calls)
  }`
  for (const privateValue of [raw, test.info.ID, test.info.Who])
    expect(displayed).not.toContain(privateValue)
  expect(test.run.mock.calls.filter(([, args]) => args[1] === "force-unlock")).toHaveLength(1)
  expect(test.context.ui.select).not.toHaveBeenCalled()
})

it("refuses success after force-unlock unless fresh HEAD verifies the state is unlocked", async () => {
  const test = await scenario()
  test.state.leaveLocked = true

  await expect(test.recover()).rejects.toThrow(/unlocked/i)

  expect(test.run.mock.calls.filter(([, args]) => args[1] === "force-unlock")).toHaveLength(1)
  expect(test.verify).toHaveBeenCalledTimes(3)
})

it("rechecks safety after a verified unlock rather than treating command success as completed recovery", async () => {
  const test = await scenario()
  test.verify.mockResolvedValueOnce("stable").mockResolvedValueOnce("stable")
    .mockResolvedValueOnce("stable").mockRejectedValueOnce(new Error("Ownership changed after unlock"))

  await expect(test.recover()).rejects.toThrow(/ownership changed/i)

  expect(test.run.mock.calls.filter(([, args]) => args[1] === "force-unlock")).toHaveLength(1)
})
