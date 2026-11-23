import { randomUUID } from "node:crypto"
import { mkdir, readFile, rm } from "node:fs/promises"
import { join, resolve } from "node:path"
import { afterEach, expect, it, vi } from "vitest"

import * as azureConfiguration from "../../azure/install/configure/index.ts"
import * as azureInstaller from "../../azure/install/index.ts"
import * as previewInstaller from "../../azure/install/private-preview/index.ts"
import type { DeploymentResult } from "../../azure/install/types.ts"
import { loadConfig, saveConfig } from "../config/index.ts"
import { formatDeploymentSummary } from "../deployment-summary/index.ts"
import { openSession, readSession } from "../session/index.ts"
import type { DeploymentConfig, RunCommand, WizardUI } from "../types.ts"
import * as privateJson from "../write-private-json/index.ts"
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
  const result: DeploymentResult = {
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
  }
  const hub = vi.spyOn(azureInstaller, "installAzure").mockImplementation(async (_, { ui }) => {
    await ui.phase?.("provision")
    await ui.phase?.("verify")
    return result
  })
  const interrupted = new Error("Synthetic interruption in preview staging")
  const preview = vi.spyOn(previewInstaller, "installAzurePrivatePreview")
    .mockImplementation(async (_, { ui }) => {
      await ui.phase?.("provision")
      throw interrupted
    })
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
    notice: vi.fn(),
    preview: vi.fn(),
  }
  const controller = new AbortController()
  const options = { directory, path, run, ui, signal: controller.signal, ...(saved && { existing: config }) }
  return { options, config, result, hub, preview, interrupted, controller }
}

function targetAnswers({ cloud, name, owner, azure }: DeploymentConfig) {
  return { cloud, name, owner, ...azure, privatePreviewStage: "prepare" }
}

async function startSession(path: string) {
  const session = await openSession(path)
  sessions.push(session)
  return session
}

async function resumeSession(
  path: string, stage: "after-create" | "prepare", deploymentStarted = false,
) {
  const session = await startSession(path)
  await session.answer("privatePreviewStage", stage)
  await session.phase(deploymentStarted ? "verify" : "review")
  await session.close()
  return startSession(path)
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
  const session = await startSession(options.path)

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

it("checkpoints preview-only Update before cloud work and rejects Resume after a target change", async () => {
  const { options, config, hub, preview, interrupted } = await fixture(true)
  const session = await startSession(options.path)
  preview.mockImplementation(async (_, { ui }) => {
    await ui.phase?.("review")
    expect(await readSession(options.path)).toEqual({})
    const saveDraft = vi.spyOn(privateJson, "writePrivateJson")
    await ui.phase?.("provision")
    expect(saveDraft).toHaveBeenCalledOnce()
    expect((await readSession(options.path)).draft).toMatchObject({
      phase: "provision",
      deploymentStarted: true,
      answers: targetAnswers(config),
    })
    throw interrupted
  })

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
  const reopened = await startSession(options.path)
  const existing = await loadConfig(options.path)

  await expect(runWizard({ ...options, existing, session: reopened }))
    .rejects.toThrow(/draft conflicts with the saved installation target/i)

  expect(preview).toHaveBeenCalledOnce()
  expect(hub).not.toHaveBeenCalled()
})

it.each(["before approval", "failed approval checkpoint"] as const)(
  "cannot route preview-only Update into Hub Resume after interruption at %s",
  async (interruption) => {
    const { options, controller, interrupted, hub, preview } = await fixture(true)
    const session = await startSession(options.path)
    vi.mocked(options.ui.wait).mockImplementation(async () => {
      controller.abort(interrupted)
      controller.signal.throwIfAborted()
    })
    const cloudWrite = vi.fn()
    preview.mockImplementation(async (_, { ui, signal }) => {
      await ui.phase?.("review")
      if (interruption === "before approval") controller.abort(interrupted)
      signal?.throwIfAborted()
      vi.spyOn(privateJson, "writePrivateJson").mockRejectedValueOnce(
        Object.assign(new Error("Synthetic disk failure"), { code: "EIO" }),
      )
      await ui.phase?.("provision")
      cloudWrite()
      return "staged"
    })

    await expect(runWizard({ ...options, session, entryAction: "update", preparePrivatePreview: true }))
      .rejects.toBe(interrupted)
    if (interruption === "failed approval checkpoint") expect(options.ui.wait).toHaveBeenCalledOnce()
    expect(cloudWrite).not.toHaveBeenCalled()
    await session.close()
    const reopened = await startSession(options.path)
    expect(reopened.draft).toBeUndefined()
    await expect(runWizard({
      ...options, signal: undefined, session: reopened, entryAction: "resume",
    })).rejects.toThrow()
    expect(hub).not.toHaveBeenCalled()
  },
)

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

it("cleans up a declined preview-only Update and permits an ordinary Update", async () => {
  const { options, config, result, hub, preview } = await fixture(true)
  const session = await startSession(options.path)
  preview.mockImplementation(async (_, { ui }) => {
    await ui.phase?.("review")
    return "declined"
  })

  await expect(runWizard({ ...options, session, entryAction: "update", preparePrivatePreview: true }))
    .resolves.toMatch(/skip|declin|not (?:approved|staged|prepared)/i)

  expect(preview).toHaveBeenCalledOnce()
  expect(hub).not.toHaveBeenCalled()
  expect(vi.mocked(options.ui.preview!).mock.calls).toEqual([["review"], ["skipped"]])
  await expect(readFile(session.path, "utf8")).rejects.toMatchObject({ code: "ENOENT" })
  await expect(loadConfig(options.path)).resolves.toEqual(config)

  await session.close()
  const reopened = await startSession(options.path)
  await expect(runWizard({ ...options, session: reopened, entryAction: "update" }))
    .resolves.toBe(formatDeploymentSummary(result, options.path))
  expect(hub).toHaveBeenCalledOnce()
  expect(preview).toHaveBeenCalledOnce()
})

it.each(["create", "resume"] as const)(
  "returns the full Hub summary and removes the draft when preview is declined after Hub succeeds on %s",
  async (entryAction) => {
    const { options, config, result, hub, preview } = await fixture(entryAction === "resume")
    const session = entryAction === "create"
      ? await startSession(options.path)
      : await resumeSession(options.path, "after-create")
    const onHubDeployed = vi.fn()
    preview.mockImplementation(async () => {
      expect(onHubDeployed).toHaveBeenCalledExactlyOnceWith(formatDeploymentSummary(result, options.path))
      expect((await readSession(options.path)).draft).toMatchObject({
        phase: "review", deploymentStarted: false, answers: targetAnswers(config),
      })
      return "declined"
    })

    const summary = await runWizard({
      ...options, session, entryAction, preparePrivatePreview: entryAction === "create", onHubDeployed,
    })

    expect(summary).toContain(formatDeploymentSummary(result, options.path))
    expect(summary).not.toMatch(/reader is staged/i)
    expect(hub).toHaveBeenCalledOnce()
    expect(preview).toHaveBeenCalledOnce()
    expect(hub).toHaveBeenCalledBefore(preview)
    await expect(readFile(session.path, "utf8")).rejects.toMatchObject({ code: "ENOENT" })
    await expect(loadConfig(options.path)).resolves.toEqual(config)
  },
)

it.each(["legacy started draft", "failed Hub-to-preview checkpoint"] as const)(
  "preserves and blocks a Hub replay after %s",
  async (interruption) => {
    const { options, hub, preview, interrupted } = await fixture(interruption === "legacy started draft")
    const session = interruption === "legacy started draft"
      ? await resumeSession(options.path, "after-create", true)
      : await startSession(options.path)
    if (interruption === "failed Hub-to-preview checkpoint") {
      vi.mocked(options.ui.wait).mockRejectedValue(interrupted)
      await expect(runWizard({
        ...options,
        session,
        entryAction: "create",
        preparePrivatePreview: true,
        onHubDeployed: () => {
          vi.spyOn(privateJson, "writePrivateJson").mockRejectedValueOnce(
            Object.assign(new Error("Synthetic disk failure"), { code: "EIO" }),
          )
        },
      })).rejects.toBe(interrupted)
      expect(hub).toHaveBeenCalledOnce()
    }

    const draft = await readFile(session.path, "utf8")
    await session.close()
    const reopened = await startSession(options.path)
    expect(reopened.draft).toMatchObject({
      deploymentStarted: true, answers: { privatePreviewStage: "after-create" },
    })
    hub.mockClear()
    await expect(runWizard({ ...options, existing: await loadConfig(options.path), session: reopened }))
      .rejects.toThrow(/will not replay/i)
    expect(await readFile(reopened.path, "utf8")).toBe(draft)
    expect(hub).not.toHaveBeenCalled()
    expect(preview).not.toHaveBeenCalled()
  },
)

it.each(["preflight failure", "abort"] as const)(
  "reports completed Hub independently of a preview %s",
  async (outcome) => {
    const { options, config, result, preview, controller, interrupted } = await fixture(false)
    const session = await startSession(options.path)
    const onHubDeployed = vi.fn()
    preview.mockImplementation(async (_, { ui, signal }) => {
      expect(onHubDeployed).toHaveBeenCalledExactlyOnceWith(formatDeploymentSummary(result, options.path))
      expect((await readSession(options.path)).draft).toMatchObject({
        phase: "review", deploymentStarted: false, answers: targetAnswers(config),
      })
      await ui.phase?.("review")
      if (outcome === "abort") controller.abort(interrupted)
      signal?.throwIfAborted()
      throw interrupted
    })

    await expect(runWizard({
      ...options, session, entryAction: "create", preparePrivatePreview: true, onHubDeployed,
    })).rejects.toBe(interrupted)

    await expect(loadConfig(options.path)).resolves.toEqual(config)
    if (outcome === "preflight failure")
      expect(await readSession(options.path)).toEqual({})
    else
      expect((await readSession(options.path)).draft).toMatchObject({
        phase: "review", deploymentStarted: false, answers: targetAnswers(config),
      })
  },
)

it("preserves previously started preview progress when a new preflight fails", async () => {
  const { options, hub, preview, interrupted } = await fixture(true)
  const session = await resumeSession(options.path, "prepare", true)
  const draft = await readFile(session.path, "utf8")
  preview.mockImplementation(async (_, { ui }) => {
    await ui.phase?.("review")
    throw interrupted
  })

  await expect(runWizard({ ...options, session })).rejects.toBe(interrupted)

  expect(await readFile(session.path, "utf8")).toBe(draft)
  expect(hub).not.toHaveBeenCalled()
})

it.each([false, true])(
  "declines resumed preview without rerunning Hub (prior deploymentStarted: %s)",
  async (deploymentStarted) => {
    const { options, hub, preview } = await fixture(true)
    const session = await resumeSession(options.path, "prepare", deploymentStarted)
    const originalDraft = session.draft
    preview.mockImplementation(async (_, { ui }) => {
      await ui.phase?.("review")
      return "declined"
    })

    const summary = await runWizard({ ...options, session })

    expect(preview).toHaveBeenCalledOnce()
    expect(hub).not.toHaveBeenCalled()
    if (deploymentStarted) {
      expect(JSON.parse(await readFile(session.path, "utf8"))).toEqual(originalDraft)
      const messages = [
        summary, ...vi.mocked(options.ui.notice!).mock.calls.map(([, message]) => message),
        ...vi.mocked(options.ui.status).mock.calls.flat(),
      ]
      expect(messages.join("\n")).toMatch(
        /(?:draft|progress).*(?:kept|preserved|retained)|(?:kept|preserved|retained).*(?:draft|progress)/i,
      )
    } else {
      await expect(readFile(session.path, "utf8")).rejects.toMatchObject({ code: "ENOENT" })
    }
    expect(summary).not.toMatch(/reader is staged/i)
  },
)

it("keeps the preview-only draft for a flagless Resume when readiness must be rechecked", async () => {
  const { options, hub, preview } = await fixture(true)
  const session = await startSession(options.path)
  const pending = new Error("Resume to recheck")
  preview.mockImplementation(async (_, { ui }) => {
    await ui.phase?.("provision")
    await ui.phase?.("verify")
    throw pending
  })

  await expect(runWizard({ ...options, session, entryAction: "update", preparePrivatePreview: true }))
    .rejects.toBe(pending)

  expect(hub).not.toHaveBeenCalled()
  expect(vi.mocked(options.ui.preview!).mock.calls).toEqual([["provision"], ["verify"]])
  expect(JSON.parse(await readFile(session.path, "utf8"))).toMatchObject({
    phase: "verify",
    deploymentStarted: true,
    answers: { privatePreviewStage: "prepare" },
  })

  await session.close()
  const reopened = await startSession(options.path)
  preview.mockResolvedValueOnce("staged")
  await expect(runWizard({ ...options, session: reopened })).resolves.toMatch(/reader is staged/i)
  expect(hub).not.toHaveBeenCalled()
  expect(options.ui.preview).toHaveBeenLastCalledWith("staged")
  await expect(readFile(reopened.path, "utf8")).rejects.toMatchObject({ code: "ENOENT" })
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
