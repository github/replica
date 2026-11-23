import { randomUUID } from "node:crypto"
import { mkdir, readFile, rm } from "node:fs/promises"
import { join, resolve } from "node:path"
import { afterEach, expect, it, vi } from "vitest"

import * as azureConfiguration from "../../azure/install/configure/index.ts"
import * as azureInstaller from "../../azure/install/index.ts"
import * as previewInstaller from "../../azure/install/private-preview/index.ts"
import { loadConfig, saveConfig } from "../config/index.ts"
import { openSession } from "../session/index.ts"
import type { DeploymentConfig, RunCommand, WizardUI } from "../types.ts"
import { runWizard } from "./index.ts"

const directories: string[] = []
const sessions: Awaited<ReturnType<typeof openSession>>[] = []

afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.close()))
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

async function fixture(saved: boolean) {
  const directory = resolve(`.installer-wizard-preview-test-${randomUUID()}`)
  directories.push(directory)
  await mkdir(directory, { mode: 0o700 })
  const path = join(directory, "installation.json")
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
  if (saved) await saveConfig(path, config, { exclusive: true })
  vi.spyOn(azureConfiguration, "configureAzure").mockResolvedValue(config)
  const group = `/subscriptions/${config.azure.subscriptionId}/resourceGroups/${config.azure.resourceGroup}`
  const hub = vi.spyOn(azureInstaller, "installAzure").mockResolvedValue({
    name: config.name,
    subscriptionId: config.azure.subscriptionId,
    tenantId: config.azure.tenantId,
    location: config.azure.location,
    url: "https://hub.example.com",
    image: `testhubregistry.azurecr.io/replica-hub@sha256:${"a".repeat(64)}`,
    resources: {
      resourceGroup: group,
      app: `${group}/providers/Microsoft.App/containerApps/test-hub`,
      environment: `${group}/providers/Microsoft.App/managedEnvironments/test-hub`,
      database: `${group}/providers/Microsoft.DBforPostgreSQL/flexibleServers/test-hub`,
      storage: `${group}/providers/Microsoft.Storage/storageAccounts/testhub`,
      registry: `${group}/providers/Microsoft.ContainerRegistry/registries/testhubregistry`,
      vault: `${group}/providers/Microsoft.KeyVault/vaults/testvault`,
      stateStorage: `${group}/providers/Microsoft.Storage/storageAccounts/teststate`,
    },
  })
  const interrupted = new Error("Synthetic interruption in preview staging")
  const preview = vi.spyOn(previewInstaller, "installAzurePrivatePreview")
    .mockRejectedValue(interrupted)
  const run = vi.fn<RunCommand>(async (executable, args) => {
    throw new Error(`Unexpected command ${executable} ${args.join(" ")}`)
  })
  const ui: WizardUI = {
    cloud: async () => "azure",
    text: vi.fn(),
    select: vi.fn(),
    confirm: vi.fn(),
    wait: vi.fn(),
    status: vi.fn(),
  }
  const signal = new AbortController().signal
  const options = { directory, path, run, ui, signal, ...(saved && { existing: config }) }
  return { options, config, hub, preview, interrupted }
}

async function resumeSession(path: string, stage: "after-create" | "prepare") {
  const session = await openSession(path)
  sessions.push(session)
  await session.answer("privatePreviewStage", stage)
  await session.close()
  const reopened = await openSession(path)
  sessions.push(reopened)
  return reopened
}

it("creates Hub without staging preview by default", async () => {
  const { options, hub, preview } = await fixture(false)

  await expect(runWizard({ ...options, entryAction: "create" }))
    .resolves.toContain("https://hub.example.com")

  expect(hub).toHaveBeenCalledOnce()
  expect(preview).not.toHaveBeenCalled()
})

it("stages opted-in preview after creating Hub and checkpoints a preview-only retry", async () => {
  const { options, config, hub, preview, interrupted } = await fixture(false)
  const session = await openSession(options.path)
  sessions.push(session)

  await expect(runWizard({ ...options, session, entryAction: "create", preparePrivatePreview: true }))
    .rejects.toBe(interrupted)

  expect(hub).toHaveBeenCalledBefore(preview)
  expect(hub).toHaveBeenCalledOnce()
  expect(preview).toHaveBeenCalledExactlyOnceWith(
    config,
    expect.objectContaining({
      directory: options.directory,
      run: options.run,
      signal: options.signal,
      ui: expect.objectContaining({ status: options.ui.status }),
    }),
  )
  expect(JSON.parse(await readFile(session.path, "utf8"))).toMatchObject({
    answers: { privatePreviewStage: "prepare" },
  })
})

it("rejects resuming an interrupted preview-only Update after its saved target changes", async () => {
  const { options, config, hub, preview, interrupted } = await fixture(true)
  const session = await openSession(options.path)
  sessions.push(session)

  await expect(
    runWizard({ ...options, session, entryAction: "update", preparePrivatePreview: true }),
  ).rejects.toBe(interrupted)

  expect(preview).toHaveBeenCalledOnce()
  expect(hub).not.toHaveBeenCalled()
  await session.close()
  await saveConfig(options.path, {
    ...config,
    azure: { ...config.azure, resourceGroup: "other-hub-rg" },
  })
  const reopened = await openSession(options.path)
  sessions.push(reopened)
  const existing = await loadConfig(options.path)

  await expect(runWizard({ ...options, existing, session: reopened }))
    .rejects.toThrow(/draft conflicts with the saved installation target/i)

  expect(preview).toHaveBeenCalledOnce()
  expect(hub).not.toHaveBeenCalled()
})

it.each([
  { stage: "after-create", runsHub: true },
  { stage: "prepare", runsHub: false },
] as const)("resumes the persisted $stage path without needing the flag again", async ({ stage, runsHub }) => {
  const { options, hub, preview, interrupted } = await fixture(true)
  const session = await resumeSession(options.path, stage)

  await expect(runWizard({ ...options, session })).rejects.toBe(interrupted)

  expect(preview).toHaveBeenCalledOnce()
  if (runsHub) expect(hub).toHaveBeenCalledBefore(preview)
  else expect(hub).not.toHaveBeenCalled()
})

it("rejects preview opt-in in configure-only mode without deploying", async () => {
  const { options, hub, preview } = await fixture(true)

  await expect(runWizard({ ...options, configureOnly: true, preparePrivatePreview: true }))
    .rejects.toThrow(/configuration-only/i)

  expect(hub).not.toHaveBeenCalled()
  expect(preview).not.toHaveBeenCalled()
  expect(options.run).not.toHaveBeenCalled()
})

it("leaves a pending preview draft intact in configure-only mode", async () => {
  const { options, config, hub, preview } = await fixture(true)
  const session = await resumeSession(options.path, "prepare")
  const draft = await readFile(session.path, "utf8")

  await expect(runWizard({ ...options, session, configureOnly: true }))
    .rejects.toThrow(/configuration-only/i)

  expect(await readFile(session.path, "utf8")).toBe(draft)
  expect(JSON.parse(await readFile(options.path, "utf8"))).toEqual(config)
  expect(hub).not.toHaveBeenCalled()
  expect(preview).not.toHaveBeenCalled()
  expect(options.run).not.toHaveBeenCalled()
})
