import { randomUUID } from "node:crypto"
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { afterEach, expect, it, vi } from "vitest"

import * as azureInstaller from "../../azure/install/index.ts"
import * as azureConfiguration from "../../azure/install/configure/index.ts"
import type { DeploymentResult } from "../../azure/install/types.ts"
import { guidedPostgresProfile } from "../../azure/install/profile.ts"
import { openSession } from "../session/index.ts"
import type { DeploymentConfig, RunCommand, WizardUI } from "../types.ts"
import { runWizard } from "./index.ts"

const directories: string[] = []
const sessions: Awaited<ReturnType<typeof openSession>>[] = []

function postgresCatalogue() {
  return JSON.stringify([{
    status: null, reason: null, restricted: null,
    supportedServerVersions: [{ name: "17", status: null, reason: null }],
    supportedServerEditions: [{
      name: "Burstable", status: null, reason: null,
      supportedServerSkus: [{ name: "Standard_B1ms", status: null, reason: null }],
    }],
  }])
}

async function targetDirectory() {
  const directory = resolve(`.replica-wizard-${randomUUID()}`)
  directories.push(directory)
  await mkdir(directory, { mode: 0o700 })
  return directory
}

afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.close()))
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

function deployment(config: DeploymentConfig): DeploymentResult {
  const group = `/subscriptions/${config.azure.subscriptionId}/resourceGroups/${config.azure.resourceGroup}`
  return {
    name: config.name,
    url: "https://hub.example.com",
    subscriptionId: config.azure.subscriptionId,
    tenantId: config.azure.tenantId,
    location: config.azure.location,
    image: `registry.azurecr.io/replica-hub@sha256:${"d".repeat(64)}`,
    resources: {
      resourceGroup: group,
      app: `${group}/providers/Microsoft.App/containerApps/actual-hub`,
      environment: `${group}/providers/Microsoft.App/managedEnvironments/actual-environment`,
      database: `${group}/providers/Microsoft.DBforPostgreSQL/flexibleServers/actual-database`,
      storage: `${group}/providers/Microsoft.Storage/storageAccounts/actualartifacts`,
      registry: `${group}/providers/Microsoft.ContainerRegistry/registries/actualregistry`,
      vault: `${group}/providers/Microsoft.KeyVault/vaults/actualvault`,
      stateStorage: `${group}/providers/Microsoft.Storage/storageAccounts/actualstate`,
    },
  }
}

it.each(["before startup", "during configuration"] as const)(
  "stops a wizard cancelled %s without saving configuration or provisioning",
  async (when) => {
    const directory = await targetDirectory()
    const path = join(directory, "installation.json")
    const controller = new AbortController()
    const config: DeploymentConfig = {
      version: 1, cloud: "azure", name: "test-hub", owner: "test-team",
      azure: {
        subscriptionId: "00000000-0000-0000-0000-000000000001",
        tenantId: "00000000-0000-0000-0000-000000000002",
        location: "eastus2", resourceGroup: "test-hub-hub",
      },
    }
    const configure = vi.spyOn(azureConfiguration, "configureAzure").mockImplementation(async () => {
      controller.abort()
      return config
    })
    const install = vi.spyOn(azureInstaller, "installAzure")
    const ui: WizardUI = {
      cloud: vi.fn<WizardUI["cloud"]>(async () => "azure"), text: vi.fn(), select: vi.fn(),
      confirm: vi.fn(), wait: vi.fn(), status: vi.fn(), complete: vi.fn(),
    }
    const run = vi.fn<RunCommand>()
    if (when === "before startup") controller.abort()

    await expect(
      runWizard({ ui, run, path, directory, configureOnly: true, signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" })

    await expect(readFile(path, "utf8")).rejects.toMatchObject({ code: "ENOENT" })
    expect(install).not.toHaveBeenCalled()
    expect(ui.complete).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
    expect(configure).toHaveBeenCalledTimes(when === "before startup" ? 0 : 1)
  },
)

it("selects the cloud before Azure discovery and saves a configure-only run without provisioning", async () => {
  const directory = await targetDirectory()
  const events: string[] = []
  const answers = ["test-hub", "test-team", "https://proxy.example/npm/"]
  const install = vi.spyOn(azureInstaller, "installAzure")
  const ui: WizardUI = {
    cloud: async () => {
      events.push("cloud")
      return "azure"
    },
    text: vi.fn(async () => answers.shift()!),
    select: async (_message, options) => options[0]!.value,
    confirm: async () => true,
    wait: async (message) => {
      throw new Error(message)
    },
    status: () => undefined,
    complete: vi.fn(),
  }
  const run: RunCommand = async (executable, args) => {
    events.push([executable, ...args].join(" "))
    if (executable === "terraform") return JSON.stringify({ terraform_version: "1.13.4" })
    if (executable === "docker") return ""
    if (args[0] === "version") return "{}"
    if (args[0] === "containerapp" && args.includes("--help")) return ""
    if (args.slice(0, 3).join(" ") === "postgres flexible-server list-skus")
      return postgresCatalogue()
    if (
      args[0] === "provider" &&
      args[1] === "show" &&
      args[args.indexOf("--subscription") + 1] === "00000000-0000-0000-0000-000000000001"
    )
      return JSON.stringify({
        resourceTypes: ["managedEnvironments", "flexibleServers", "registries", "vaults"].map(
          (resourceType) => ({
            resourceType,
            locations: ["East US 2"],
          }),
        ),
      })
    if (args[0] === "account" && args[1] === "list")
      return JSON.stringify([
        {
          id: "00000000-0000-0000-0000-000000000001",
          tenantId: "00000000-0000-0000-0000-000000000002",
          name: "Test",
          state: "Enabled",
        },
      ])
    if (
      args[0] === "rest" &&
      args[args.indexOf("--method") + 1]?.toLowerCase() === "get" &&
      args[args.indexOf("--url") + 1]?.startsWith(
        "/subscriptions/00000000-0000-0000-0000-000000000001/locations?",
      ) &&
      args[args.indexOf("--subscription") + 1] === "00000000-0000-0000-0000-000000000001" &&
      args[args.indexOf("--query") + 1] === "value" &&
      args[args.indexOf("--output") + 1] === "json"
    )
      return JSON.stringify([{ name: "eastus2", displayName: "East US 2" }])
    throw new Error(`Unexpected operation ${executable} ${args.join(" ")}`)
  }
  const path = join(directory, "installation.json")
  const summary = await runWizard({ ui, run, path, directory, configureOnly: true })
  expect(summary).toContain(path)
  expect(summary).not.toMatch(/https:\/\/|portal\.azure\.com|sha256:/i)
  expect(install).not.toHaveBeenCalled()
  expect(ui.complete).toHaveBeenCalledOnce()
  expect(events[0]).toBe("cloud")
  const saved = JSON.parse(await readFile(path, "utf8"))
  expect(saved).toMatchObject({
    cloud: "azure",
    npmRegistry: "https://proxy.example/npm/",
    azure: {
      subscriptionId: "00000000-0000-0000-0000-000000000001",
      resourceGroup: "test-hub-hub",
    },
  })
  expect(saved.azure).not.toHaveProperty("stateAllowedIp")
  expect(ui.text).toHaveBeenCalledTimes(3)
  expect((await stat(path)).mode & 0o777).toBe(0o600)
  expect(events).not.toContainEqual(
    expect.stringMatching(/\bcreate\b|\bapply\b|provider register|docker buildx build/),
  )
})

it("completes the draft and reports the structured deployment only after the installer succeeds", async () => {
  const directory = await targetDirectory()
  const path = join(directory, "installation.json")
  const session = await openSession(path)
  sessions.push(session)
  const config: DeploymentConfig = {
    version: 1,
    cloud: "azure",
    name: "test-hub",
    owner: "test-team",
    azure: {
      subscriptionId: "00000000-0000-0000-0000-000000000001",
      tenantId: "00000000-0000-0000-0000-000000000002",
      location: "eastus2",
      resourceGroup: "test-hub-rg",
    },
  }
  const result = deployment(config)
  const configure = vi.spyOn(azureConfiguration, "configureAzure").mockImplementation(
    async (_ui, _run, _existing, _session, availability) => {
      expect(availability).toEqual(expect.any(Function))
      await expect(availability!(
        config.azure.subscriptionId, config.azure.location, guidedPostgresProfile,
      )).resolves.toBe(true)
      return config
    },
  )
  const started = Promise.withResolvers<void>()
  const finished = Promise.withResolvers<DeploymentResult>()
  vi.spyOn(azureInstaller, "installAzure").mockImplementation(async (_config, options) => {
    expect(options.availability).toBe(configure.mock.calls[0]![4])
    await expect(options.availability!(
      config.azure.subscriptionId, config.azure.location, guidedPostgresProfile,
    )).resolves.toBe(true)
    started.resolve()
    return finished.promise
  })
  const ui: WizardUI = {
    cloud: vi.fn(async () => "azure" as const),
    text: vi.fn(),
    select: vi.fn(),
    confirm: vi.fn(),
    wait: vi.fn(),
    status: vi.fn(),
    complete: vi.fn(),
  }
  const run = vi.fn<RunCommand>(async (executable, args) => {
    if (executable === "az" && args.slice(0, 3).join(" ") === "postgres flexible-server list-skus")
      return postgresCatalogue()
    throw new Error("Shared availability test attempted an unexpected operation")
  })
  const controller = new AbortController()
  let reported = false
  const installing = runWizard({
    ui, run, path, directory, session, signal: controller.signal,
  }).then((summary) => {
    reported = true
    return summary
  })
  await started.promise
  expect(azureInstaller.installAzure).toHaveBeenCalledWith(
    config,
    expect.objectContaining({ directory, signal: controller.signal }),
  )
  expect(reported).toBe(false)
  expect(ui.complete).not.toHaveBeenCalled()
  expect(session.draft).toBeDefined()
  finished.resolve(result)

  const summary = await installing

  expect(summary).toContain(result.url)
  expect(summary).toContain(result.image)
  expect(summary).toContain(path)
  expect(summary).toContain(
    `https://portal.azure.com/#@${result.tenantId}/resource${result.resources.app}`,
  )
  expect(ui.complete).toHaveBeenCalledOnce()
  await expect(readFile(session.path, "utf8")).rejects.toMatchObject({ code: "ENOENT" })
  expect(JSON.parse(await readFile(path, "utf8"))).toEqual(config)
  expect(run).toHaveBeenCalledOnce()
})

it("does not discover or mutate a cloud when the first screen is cancelled", async () => {
  const run = vi.fn<RunCommand>()
  const ui: WizardUI = {
    cloud: async () => {
      throw new Error("Cancelled")
    },
    text: vi.fn(),
    select: vi.fn(),
    confirm: vi.fn(),
    wait: vi.fn(),
    status: vi.fn(),
  }
  await expect(runWizard({ ui, run, path: "/unused", directory: "/unused" })).rejects.toThrow(
    "Cancelled",
  )
  expect(run).not.toHaveBeenCalled()
})

it("preserves the saved configuration if configuration returns a different immutable installation", async () => {
  const directory = await targetDirectory()
  const path = join(directory, "installation.json")
  const existing = {
    version: 1,
    cloud: "azure",
    name: "test-hub",
    owner: "test-team",
    azure: {
      subscriptionId: "00000000-0000-0000-0000-000000000001",
      tenantId: "00000000-0000-0000-0000-000000000002",
      location: "eastus2",
      resourceGroup: "test-hub-rg",
    },
  } as const
  await writeFile(path, JSON.stringify(existing), { mode: 0o600 })
  vi.spyOn(azureConfiguration, "configureAzure").mockResolvedValue({
    ...existing,
    name: "other-hub",
    azure: { ...existing.azure, resourceGroup: "other-hub-rg" },
  })
  const ui: WizardUI = {
    cloud: async () => "azure",
    text: vi.fn(),
    select: async (_message, options) => options[0]!.value,
    confirm: async () => false,
    wait: async (message) => {
      throw new Error(message)
    },
    status: () => undefined,
  }
  const run = vi.fn<RunCommand>()
  await expect(
    runWizard({ ui, run, path, directory, existing, configureOnly: true }),
  ).rejects.toThrow("not overwritten")
  expect(JSON.parse(await readFile(path, "utf8"))).toEqual(existing)
  expect(run).not.toHaveBeenCalled()
})

it("normalizes saved legacy configuration before provisioning without asking to edit its identity", async () => {
  const directory = await targetDirectory()
  const path = join(directory, "installation.json")
  const existing = {
    version: 1,
    cloud: "azure",
    name: "test-hub",
    owner: "test-team",
    azure: {
      subscriptionId: "00000000-0000-0000-0000-000000000001",
      tenantId: "00000000-0000-0000-0000-000000000002",
      location: "eastus2",
      resourceGroup: "test-hub-rg",
      stateAllowedIp: "203.0.113.10",
    },
  } as const
  await writeFile(path, JSON.stringify(existing), { mode: 0o600 })
  const ui: WizardUI = {
    cloud: vi.fn(async () => "azure" as const),
    text: vi.fn(async () => { throw new Error("Existing installation must not prompt for identity") }),
    select: async (_message, options) => options[0]!.value,
    confirm: async () => false,
    wait: async () => {
      throw new Error("Unexpected retry")
    },
    status: () => undefined,
  }
  const stopped = new Error("Synthetic failure after configuration is saved")
  let savedBeforeProvisioning: unknown
  const run: RunCommand = async (executable, args) => {
    if (executable === "terraform") return JSON.stringify({ terraform_version: "1.17.1" })
    if (executable === "docker" || args.includes("--help")) return ""
    if (args[0] === "version") return "{}"
    if (args[0] === "account" && args[1] === "list")
      return JSON.stringify([
        {
          id: existing.azure.subscriptionId,
          tenantId: existing.azure.tenantId,
          name: "Test",
          state: "Enabled",
        },
      ])
    if (args[0] === "rest") return JSON.stringify([{ name: "eastus2", displayName: "East US 2" }])
    if (args[0] === "provider" && args[1] === "show")
      return JSON.stringify({
        resourceTypes: ["managedEnvironments", "flexibleServers", "registries", "vaults"].map(
          (resourceType) => ({ resourceType, locations: ["East US 2"] }),
        ),
      })
    if (args[0] === "account" && args[1] === "show") {
      savedBeforeProvisioning = JSON.parse(await readFile(path, "utf8"))
      throw stopped
    }
    throw new Error(`Unexpected operation ${executable} ${args.join(" ")}`)
  }

  await expect(runWizard({ ui, run, path, directory, existing })).rejects.toBe(stopped)

  const { stateAllowedIp: _retired, ...azure } = existing.azure
  const expected = { ...existing, azure }
  expect(savedBeforeProvisioning).toEqual(expected)
  expect(JSON.parse(await readFile(path, "utf8"))).toEqual(expected)
  expect((await stat(path)).mode & 0o777).toBe(0o600)
  expect(ui.cloud).not.toHaveBeenCalled()
  expect(ui.text).not.toHaveBeenCalled()
})

it("checkpoints a corrected build proxy in the draft and complete config before retry, then restores it after another failure", async () => {
  const directory = await targetDirectory()
  const path = join(directory, "installation.json")
  const registry = "https://packages.example/npm/"
  const updatedRegistry = "https://packages.example/next/"
  const existing: DeploymentConfig = {
    version: 1,
    cloud: "azure",
    name: "test-hub",
    owner: "test-team",
    azure: {
      subscriptionId: "00000000-0000-0000-0000-000000000001",
      tenantId: "00000000-0000-0000-0000-000000000002",
      location: "eastus2",
      resourceGroup: "test-hub-rg",
    },
  }
  await writeFile(path, JSON.stringify(existing), { mode: 0o600 })
  const session = await openSession(path)
  sessions.push(session)
  let repaired = false
  const answer = session.answer
  vi.spyOn(session, "answer").mockImplementation(async (key, value) => {
    if (key === "npmRegistry" && !repaired)
      throw Object.assign(new Error("Synthetic disk failure"), { code: "EACCES" })
    await answer(key, value)
  })
  const ui: WizardUI = {
    cloud: vi.fn(async () => "azure" as const),
    text: vi.fn(async () => { throw new Error("Existing installation must not prompt for identity") }),
    select: vi.fn(async (_message, options) => options[0]!.value),
    confirm: vi.fn(async () => false),
    wait: vi.fn(async (message) => {
      if (message.includes("EACCES")) {
        expect(JSON.parse(await readFile(path, "utf8"))).toEqual(existing)
        expect(session.draft?.answers).toMatchObject({ useProxy: true })
        expect(session.draft?.answers.npmRegistry).toBeUndefined()
        repaired = true
      }
    }),
    status: vi.fn(),
    complete: vi.fn(),
  }
  const run = vi.fn<RunCommand>(async (executable, args) => {
    if (executable === "terraform") return JSON.stringify({ terraform_version: "1.13.4" })
    if (executable === "docker" || args.includes("--help")) return ""
    if (executable !== "az") throw new Error(`Unexpected executable ${executable}`)
    if (args[0] === "version") return "{}"
    if (args[0] === "account" && args[1] === "list")
      return JSON.stringify([
        {
          id: existing.azure.subscriptionId,
          tenantId: existing.azure.tenantId,
          name: "Test",
          state: "Enabled",
        },
      ])
    if (args[0] === "rest") return JSON.stringify([{ name: "eastus2", displayName: "East US 2" }])
    if (args[0] === "provider" && args[1] === "show")
      return JSON.stringify({
        resourceTypes: ["managedEnvironments", "flexibleServers", "registries", "vaults"].map(
          (resourceType) => ({ resourceType, locations: ["East US 2"] }),
        ),
      })
    throw new Error(`Unexpected Azure operation ${args.join(" ")}`)
  })
  const laterFailure = new Error("Synthetic second image build failure")
  const install = vi.spyOn(azureInstaller, "installAzure")
  install.mockImplementationOnce(async (config, options) => {
    expect(session.draft?.answers.useProxy).toBe(false)
    await options.ui.phase?.("provision")
    expect(options.saveNpmRegistry).toEqual(expect.any(Function))
    await options.saveNpmRegistry!(registry)
    expect(repaired).toBe(true)
    expect(config).toEqual({ ...existing, npmRegistry: registry })
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(config)
    await options.saveNpmRegistry!(updatedRegistry)
    expect(config).toEqual({ ...existing, npmRegistry: updatedRegistry })
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(config)
    expect(JSON.parse(await readFile(session.path, "utf8"))).toMatchObject({
      phase: "provision",
      deploymentStarted: true,
      answers: { useProxy: true, npmRegistry: updatedRegistry },
    })
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect((await stat(session.path)).mode & 0o777).toBe(0o600)
    throw laterFailure
  })

  await expect(runWizard({ ui, run, path, directory, existing, session })).rejects.toBe(
    laterFailure,
  )
  expect(ui.complete).not.toHaveBeenCalled()
  expect(session.draft).toMatchObject({ deploymentStarted: true, phase: "provision" })

  await session.close()
  const reopened = await openSession(path)
  sessions.push(reopened)
  expect(reopened.draft?.answers).toMatchObject({
    useProxy: true,
    npmRegistry: updatedRegistry,
  })
  const saved = JSON.parse(await readFile(path, "utf8")) as DeploymentConfig
  install.mockImplementationOnce(async (config) => {
    expect(config).toEqual(saved)
    expect(config.npmRegistry).toBe(updatedRegistry)
    return deployment(config)
  })

  await expect(
    runWizard({ ui, run, path, directory, existing: saved, session: reopened }),
  ).resolves.toContain("https://hub.example.com")

  expect(ui.text).not.toHaveBeenCalled()
  expect(ui.confirm).toHaveBeenCalledTimes(1)
  expect(ui.cloud).not.toHaveBeenCalled()
  expect(install).toHaveBeenCalledTimes(2)
})

it("does not overwrite a config appearing after fresh questions or begin deployment", async () => {
  const directory = await targetDirectory()
  const path = join(directory, "installation.json")
  const config: DeploymentConfig = {
    version: 1, cloud: "azure", name: "test-hub", owner: "test-team",
    azure: {
      subscriptionId: "00000000-0000-0000-0000-000000000001",
      tenantId: "00000000-0000-0000-0000-000000000002",
      location: "eastus2", resourceGroup: "test-hub-rg",
    },
  }
  const concurrent = JSON.stringify({ ...config, owner: "concurrent-team" })
  vi.spyOn(azureConfiguration, "configureAzure").mockImplementation(async () => {
    await writeFile(path, concurrent, { mode: 0o600 })
    return config
  })
  const install = vi.spyOn(azureInstaller, "installAzure")
  const ui: WizardUI = {
    cloud: vi.fn(async () => "azure" as const), text: vi.fn(), select: vi.fn(),
    confirm: vi.fn(), wait: vi.fn(), status: vi.fn(), complete: vi.fn(),
  }

  await expect(runWizard({ ui, run: vi.fn(), path, directory })).rejects.toThrow()

  expect(await readFile(path, "utf8")).toBe(concurrent)
  expect(install).not.toHaveBeenCalled()
  expect(ui.complete).not.toHaveBeenCalled()
})
