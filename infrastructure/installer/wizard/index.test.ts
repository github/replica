import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { afterEach, expect, it, vi } from "vitest"

import * as azureInstaller from "../../azure/install/index.ts"
import * as azureConfiguration from "../../azure/install/configure/index.ts"
import type { DeploymentResult } from "../../azure/install/types.ts"
import { openSession } from "../session/index.ts"
import type { DeploymentConfig, RunCommand, WizardUI } from "../types.ts"
import { runWizard } from "./index.ts"

const directories: string[] = []
const sessions: Awaited<ReturnType<typeof openSession>>[] = []
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

it("selects the cloud before Azure discovery and saves a configure-only run without provisioning", async () => {
  const directory = await mkdtemp(join(process.cwd(), ".replica-wizard-"))
  directories.push(directory)
  const events: string[] = []
  const answers = ["test-hub", "test-team", "test-hub-rg", "https://proxy.example/npm/"]
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
    },
  })
  expect(saved.azure).not.toHaveProperty("stateAllowedIp")
  expect(ui.text).toHaveBeenCalledTimes(4)
  expect((await stat(path)).mode & 0o777).toBe(0o600)
  expect(events).not.toContainEqual(
    expect.stringMatching(/\bcreate\b|\bapply\b|provider register|docker buildx build/),
  )
})

it("completes the draft and reports the structured deployment only after the installer succeeds", async () => {
  const directory = await mkdtemp(join(process.cwd(), ".replica-wizard-"))
  directories.push(directory)
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
  vi.spyOn(azureConfiguration, "configureAzure").mockResolvedValue(config)
  const started = Promise.withResolvers<void>()
  const finished = Promise.withResolvers<DeploymentResult>()
  vi.spyOn(azureInstaller, "installAzure").mockImplementation(async () => {
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
  const run = vi.fn<RunCommand>()
  let reported = false
  const installing = runWizard({ ui, run, path, directory, session }).then((summary) => {
    reported = true
    return summary
  })
  await started.promise
  expect(azureInstaller.installAzure).toHaveBeenCalledWith(
    config,
    expect.objectContaining({ directory }),
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

it("preserves a saved configuration when the operator chooses a different installation", async () => {
  const directory = await mkdtemp(join(process.cwd(), ".replica-wizard-"))
  directories.push(directory)
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
  await writeFile(path, JSON.stringify(existing))
  const answers = ["other-hub", "test-team", "other-hub-rg"]
  const ui: WizardUI = {
    cloud: async () => "azure",
    text: async () => answers.shift()!,
    select: async (_message, options) => options[0]!.value,
    confirm: async () => false,
    wait: async (message) => {
      throw new Error(message)
    },
    status: () => undefined,
  }
  const run: RunCommand = async (executable, args) => {
    if (executable === "terraform") return JSON.stringify({ terraform_version: "1.13.4" })
    if (executable === "docker" || args.includes("--help")) return ""
    if (args[0] === "version") return "{}"
    if (
      args[0] === "provider" &&
      args[1] === "show" &&
      args[args.indexOf("--subscription") + 1] === existing.azure.subscriptionId
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
          id: existing.azure.subscriptionId,
          tenantId: existing.azure.tenantId,
          name: "Test",
          state: "Enabled",
        },
      ])
    if (
      args[0] === "rest" &&
      args[args.indexOf("--method") + 1]?.toLowerCase() === "get" &&
      args[args.indexOf("--url") + 1]?.startsWith(
        `/subscriptions/${existing.azure.subscriptionId}/locations?`,
      ) &&
      args[args.indexOf("--subscription") + 1] === existing.azure.subscriptionId &&
      args[args.indexOf("--query") + 1] === "value" &&
      args[args.indexOf("--output") + 1] === "json"
    )
      return JSON.stringify([{ name: "eastus2", displayName: "East US 2" }])
    throw new Error(`Unexpected operation ${executable} ${args.join(" ")}`)
  }
  await expect(
    runWizard({ ui, run, path, directory, existing, configureOnly: true }),
  ).rejects.toThrow("not overwritten")
  expect(JSON.parse(await readFile(path, "utf8"))).toEqual(existing)
})

it("saves corrected legacy configuration privately before beginning provisioning", async () => {
  const directory = await mkdtemp(join(process.cwd(), ".replica-wizard-"))
  directories.push(directory)
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
  const answers = ["Bad Name", existing.name, existing.owner, existing.azure.resourceGroup]
  const ui: WizardUI = {
    cloud: async () => "azure",
    text: async () => {
      if (!answers.length) throw new Error("Unexpected input prompt")
      return answers.shift()!
    },
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
})

it("checkpoints a corrected build proxy in the draft and complete config before retry, then restores it after another failure", async () => {
  const directory = await mkdtemp(join(process.cwd(), ".replica-wizard-"))
  directories.push(directory)
  const path = join(directory, "installation.json")
  const registry = "https://packages.example/npm/"
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
  const answers = [existing.name, existing.owner, existing.azure.resourceGroup]
  const ui: WizardUI = {
    cloud: vi.fn(async () => "azure" as const),
    text: vi.fn(async () => {
      if (!answers.length) throw new Error("Unexpected repeated configuration question")
      return answers.shift()!
    }),
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
    expect(JSON.parse(await readFile(session.path, "utf8"))).toMatchObject({
      phase: "provision",
      deploymentStarted: true,
      answers: { useProxy: true, npmRegistry: registry },
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
  expect(reopened.draft?.answers).toMatchObject({ useProxy: true, npmRegistry: registry })
  const saved = JSON.parse(await readFile(path, "utf8")) as DeploymentConfig
  install.mockImplementationOnce(async (config) => {
    expect(config).toEqual(saved)
    expect(config.npmRegistry).toBe(registry)
    return deployment(config)
  })

  await expect(
    runWizard({ ui, run, path, directory, existing: saved, session: reopened }),
  ).resolves.toContain("https://hub.example.com")

  expect(ui.text).toHaveBeenCalledTimes(3)
  expect(ui.confirm).toHaveBeenCalledTimes(1)
  expect(ui.cloud).toHaveBeenCalledTimes(1)
  expect(install).toHaveBeenCalledTimes(2)
})
