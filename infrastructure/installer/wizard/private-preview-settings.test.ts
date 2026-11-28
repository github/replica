import { randomUUID } from "node:crypto"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { afterEach, expect, it, vi } from "vitest"

import * as azureConfiguration from "../../azure/install/configure/index.ts"
import * as azureInstaller from "../../azure/install/index.ts"
import type { DeploymentResult } from "../../azure/install/types.ts"
import { saveConfig } from "../config/index.ts"
import { openSession, readSession } from "../session/index.ts"
import { installationWorkspace } from "../workspace/index.ts"
import type { DeploymentConfig, PrivatePreviewChoice, RunCommand, WizardUI } from "../types.ts"
import { runWizard } from "./index.ts"

const directories: string[] = []
const sessions: Awaited<ReturnType<typeof openSession>>[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(sessions.splice(0).map((session) => session.close()))
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

const target: DeploymentConfig = {
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

async function fixture({
  privatePreview,
  selects = [],
  texts = [],
  saved: savedConfig = true,
  hubSignIn = true,
}: {
  privatePreview?: PrivatePreviewChoice
  selects?: string[]
  texts?: string[]
  saved?: boolean
  hubSignIn?: boolean
}) {
  const directory = resolve(`.installer-wizard-preview-test-${randomUUID()}`)
  directories.push(directory)
  await mkdir(directory, { mode: 0o700 })
  const path = join(directory, "installation.json")
  const existing: DeploymentConfig = { ...target, ...(privatePreview && { privatePreview }) }
  if (savedConfig) await saveConfig(path, existing, { exclusive: true })
  const vaultReference = (secret: string) => ({
    key_vault_id: `/subscriptions/${target.azure.subscriptionId}/resourceGroups/test-hub-foundation/providers/Microsoft.KeyVault/vaults/testvault`,
    secret_id: `https://testvault.vault.azure.net/secrets/${secret}/${"a".repeat(32)}`,
  })
  if (hubSignIn) {
    // Hub's sign-in settings, saved by post-setup in the installation workspace that installAzure reads.
    const workspace = installationWorkspace(target, directory)
    await mkdir(workspace, { mode: 0o700 })
    await writeFile(
      join(workspace, "installation.tfvars.json"),
      JSON.stringify({
        subscription_id: target.azure.subscriptionId,
        name: target.name,
        owner: target.owner,
        location: target.azure.location,
        resource_group_name: target.azure.resourceGroup,
        hub_application_origin: "https://replica.coreai.design",
        runtime_environment_variables: { HUB_TRUSTED_PROXY_HOPS: "1" },
        setup_database_secret: vaultReference("setup-database"),
        runtime_secret_references: {
          HUB_AUTHENTICATION_ENCRYPTION_KEY: vaultReference("hub-authentication-encryption-key"),
          HUB_BOOTSTRAP_SECRET: vaultReference("hub-bootstrap-secret"),
        },
      }),
      { mode: 0o600 },
    )
  }
  // Like the real step, Azure configuration returns only the target, without private preview.
  vi.spyOn(azureConfiguration, "configureAzure").mockResolvedValue(structuredClone(target))
  const group = `/subscriptions/${target.azure.subscriptionId}/resourceGroups/${target.azure.resourceGroup}`
  const result: DeploymentResult = {
    name: target.name,
    subscriptionId: target.azure.subscriptionId,
    tenantId: target.azure.tenantId,
    location: target.azure.location,
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
  const install = vi.spyOn(azureInstaller, "installAzure").mockResolvedValue(result)
  // A wizard that keeps asking would otherwise loop forever on the default answers.
  let prompts = 0
  const limit = () => {
    if (++prompts > 20) throw new Error("The wizard kept asking the same questions.")
  }
  const ui = {
    cloud: vi.fn(async () => "azure" as const),
    select: vi.fn(async (_: string, options: { value: string }[]) => {
      limit()
      return selects.shift() ?? options[0]!.value
    }),
    text: vi.fn(async (_message: string, _initial?: string) => {
      limit()
      return texts.shift() ?? ""
    }),
    confirm: vi.fn(async () => true),
    wait: vi.fn(),
    status: vi.fn(),
    notice: vi.fn(),
  } satisfies WizardUI
  const run = vi.fn<RunCommand>(async (executable, args) => {
    throw new Error(`Unexpected command ${executable} ${args.join(" ")}`)
  })
  const saved = async () => JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>
  return {
    options: { directory, path, run, ui, ...(savedConfig && { existing }) },
    path,
    install,
    ui,
    saved,
  }
}

async function draftWith(path: string, prepare: (session: Awaited<ReturnType<typeof openSession>>) => Promise<void>) {
  const first = await openSession(path)
  await prepare(first)
  await first.close()
  const session = await openSession(path)
  sessions.push(session)
  return session
}

it("saves a private preview choice made during Update and deploys with it", async () => {
  const { options, install, saved } = await fixture({
    selects: ["on", "on"],
    texts: ["preview.replica.coreai.design", "123"],
  })
  const choice = { reader: "on", inline: true, hostname: "preview.replica.coreai.design", writerRepositoryIds: ["123"] }

  await runWizard({ ...options, entryAction: "update" })

  expect((await saved()).privatePreview).toEqual(choice)
  expect(install.mock.calls[0]![0].privatePreview).toEqual(choice)
})

it("leaves an earlier configuration without private preview settings when Update keeps the defaults", async () => {
  const { options, install, saved } = await fixture({})

  await runWizard({ ...options, entryAction: "update" })

  expect(await saved()).not.toHaveProperty("privatePreview")
  expect(install.mock.calls[0]![0]).not.toHaveProperty("privatePreview")
})

it("resumes an interrupted deployment with the saved choice without asking again", async () => {
  const privatePreview: PrivatePreviewChoice = { reader: "on", inline: false, writerRepositoryIds: ["123"] }
  const { options, path, install, ui, saved } = await fixture({ privatePreview })
  const session = await draftWith(path, (draft) => draft.phase("release"))

  await runWizard({ ...options, session, entryAction: "resume" })

  expect(ui.text).not.toHaveBeenCalled()
  expect(ui.select).not.toHaveBeenCalled()
  expect((await saved()).privatePreview).toEqual(privatePreview)
  expect(install.mock.calls[0]![0].privatePreview).toEqual(privatePreview)
})

it("rejects a draft from the earlier private preview step and preserves it", async () => {
  const { options, path, install, saved } = await fixture({})
  const session = await draftWith(path, (draft) => draft.answer("privatePreviewStage", "prepare"))
  const before = await saved()

  await expect(runWizard({ ...options, session, entryAction: "resume" })).rejects.toThrow(/draft was preserved/)

  await session.close()
  expect((await readSession(path)).draft?.answers.privatePreviewStage).toBe("prepare")
  expect(await saved()).toEqual(before)
  expect(install).not.toHaveBeenCalled()
})

const readerPrompts = (ui: { select: { mock: { calls: [string, ...unknown[]][] } } }) =>
  ui.select.mock.calls.filter(([message]) => message.startsWith("Private prototype service"))

it("keeps the reader off on Create without offering it", async () => {
  const { options, install, ui, saved } = await fixture({ saved: false, hubSignIn: false })

  await runWizard({ ...options, entryAction: "create" })

  expect(readerPrompts(ui)).toEqual([])
  expect(await saved()).not.toHaveProperty("privatePreview")
  expect(install).toHaveBeenCalledOnce()
})

it("asks again when On needs Hub sign-in settings, then deploys only the valid choice", async () => {
  const { options, install, ui, saved } = await fixture({ hubSignIn: false, selects: ["on", "off", "off"] })

  await runWizard({ ...options, entryAction: "update" })

  expect(readerPrompts(ui)).toHaveLength(2)
  expect(ui.notice).toHaveBeenCalledWith("error", expect.stringMatching(/^Private preview blocked: .*sign-in settings/))
  expect(ui.notice.mock.invocationCallOrder[0]).toBeLessThan(install.mock.invocationCallOrder[0]!)
  expect(await saved()).not.toHaveProperty("privatePreview")
  expect(install).toHaveBeenCalledOnce()
  expect(install.mock.calls[0]![0]).not.toHaveProperty("privatePreview")
})
