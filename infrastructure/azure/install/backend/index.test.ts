import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { join } from "node:path"
import { afterEach, expect, it, vi } from "vitest"

import type { DeploymentConfig, InstallerUI, RunCommand } from "../../../installer/types.ts"
import { installationNames } from "../settings.ts"
import type { AzureInstallation } from "../types.ts"
import { prepareBackend } from "./index.ts"

interface StateStorage {
  id: string
  tags?: Record<string, string>
  allowSharedKeyAccess: boolean
  allowBlobPublicAccess: boolean
  minimumTlsVersion: string
  publicNetworkAccess?: string
  networkRuleSet: { defaultAction: string }
}

const directories: string[] = []
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

async function scenario({
  existing = false,
  afterUpdate,
}: {
  existing?: boolean
  afterUpdate?: (storage: StateStorage) => void
} = {}) {
  const directory = await mkdtemp(join(process.cwd(), ".replica-backend-"))
  directories.push(directory)
  const config: DeploymentConfig = {
    version: 1,
    cloud: "azure",
    name: "test-hub",
    owner: "test-team",
    azure: {
      subscriptionId: "00000000-0000-0000-0000-000000000001",
      tenantId: "00000000-0000-0000-0000-000000000002",
      location: "eastus2",
      resourceGroup: "test-hub-group",
    },
  }
  const names = installationNames(config)
  const tags = {
    application: "replica-hub",
    installation: config.name,
    owner: config.owner,
    managed_by: "replica-installer",
  }
  const groupTags = { ...tags }
  const storage: StateStorage = {
    id: `/subscriptions/${config.azure.subscriptionId}/resourceGroups/${names.stateGroup}/providers/Microsoft.Storage/storageAccounts/${names.stateAccount}`,
    tags: { ...tags },
    allowSharedKeyAccess: false,
    allowBlobPublicAccess: false,
    minimumTlsVersion: "TLS1_2",
    publicNetworkAccess: "Enabled",
    networkRuleSet: { defaultAction: "Allow" },
  }
  const commands: string[][] = []
  const principal = "00000000-0000-0000-0000-000000000003"
  const accounts = existing ? [{ name: names.stateAccount }] : []
  const azure = vi.fn(async (...args: string[]) => {
    commands.push([...args])
    const operation = args.slice(0, 3).join(" ")
    if (operation.startsWith("group exists")) return JSON.stringify(existing)
    if (operation.startsWith("group show")) return JSON.stringify({ tags: groupTags })
    if (operation.startsWith("group create")) return "{}"
    if (operation === "storage account list") return JSON.stringify(accounts)
    if (operation === "storage account show") return JSON.stringify(storage)
    if (operation === "storage account create") {
      storage.allowSharedKeyAccess = args[args.indexOf("--allow-shared-key-access") + 1] !== "false"
      storage.allowBlobPublicAccess =
        args[args.indexOf("--allow-blob-public-access") + 1] !== "false"
      storage.minimumTlsVersion = args[args.indexOf("--min-tls-version") + 1]!
      storage.publicNetworkAccess = args[args.indexOf("--public-network-access") + 1]
      storage.networkRuleSet.defaultAction = args[args.indexOf("--default-action") + 1]!
      return "{}"
    }
    if (operation === "storage account update") {
      if (args.includes("--default-action"))
        storage.networkRuleSet.defaultAction = args[args.indexOf("--default-action") + 1]!
      afterUpdate?.(storage)
      return JSON.stringify(storage)
    }
    if (operation.startsWith("account get-access-token"))
      return JSON.stringify({
        accessToken: `synthetic.${Buffer.from(JSON.stringify({ oid: principal })).toString("base64url")}.synthetic`,
      })
    if (operation === "role assignment list") return "[]"
    if (
      operation === "role assignment create" ||
      operation === "storage account blob-service-properties" ||
      operation === "storage container create"
    )
      return "{}"
    throw new Error(`Unexpected Azure command ${args.join(" ")}`)
  })
  const ui: InstallerUI = {
    status: vi.fn(),
    confirm: vi.fn(async () => true),
    select: vi.fn(async (_message, options) => options[0]!.value),
    wait: vi.fn(async () => {
      throw new Error("Unexpected retry")
    }),
  }
  const run = vi.fn<RunCommand>(async () => {
    throw new Error("Only the fake Azure interface may run in backend tests")
  })
  const context: AzureInstallation = { config, directory, azure, ui, run, env: {} }
  return { context, commands, config, storage, groupTags, accounts, names, principal, ui }
}

it("creates identity-only state storage without an IP rule and writes a private Entra-authenticated backend", async () => {
  const s = await scenario()

  const prepared = await prepareBackend(s.context)
  const filename = await prepared.backend("foundation")

  expect(prepared.account).toBe(s.names.stateAccount)
  const create = s.commands.find((args) => args.slice(0, 3).join(" ") === "storage account create")!
  for (const [flag, expected] of [
    ["--default-action", "Allow"],
    ["--public-network-access", "Enabled"],
    ["--allow-shared-key-access", "false"],
    ["--allow-blob-public-access", "false"],
    ["--min-tls-version", "TLS1_2"],
  ])
    expect(create[create.indexOf(flag!) + 1]).toBe(expected)
  for (const [key, value] of Object.entries(s.groupTags))
    expect(create).toContain(`${key}=${value}`)
  expect(s.commands.some((args) => args.includes("network-rule"))).toBe(false)
  const grant = s.commands.find((args) => args.slice(0, 3).join(" ") === "role assignment create")!
  expect(grant[grant.indexOf("--scope") + 1]).toBe(s.storage.id)
  expect(grant[grant.indexOf("--assignee-object-id") + 1]).toBe(s.principal)
  expect(grant[grant.indexOf("--role") + 1]).toBe("Storage Blob Data Contributor")
  const container = s.commands.find(
    (args) => args.slice(0, 3).join(" ") === "storage container create",
  )!
  expect(container[container.indexOf("--auth-mode") + 1]).toBe("login")
  expect(container[container.indexOf("--public-access") + 1]).toBe("off")
  const backend = await readFile(filename, "utf8")
  expect(backend).toContain("use_azuread_auth = true")
  expect(backend).toContain(`subscription_id = "${s.config.azure.subscriptionId}"`)
  expect(backend).toContain(`tenant_id = "${s.config.azure.tenantId}"`)
  expect(backend).not.toMatch(/access_key|sas_token/)
  expect((await stat(filename)).mode & 0o777).toBe(0o600)
  expect(s.ui.confirm).not.toHaveBeenCalled()
})

it("reuses an already identity-only state account without changing its network settings", async () => {
  const s = await scenario({ existing: true })

  await prepareBackend(s.context)

  expect(s.ui.confirm).not.toHaveBeenCalled()
  expect(s.commands.some((args) => args.slice(0, 3).join(" ") === "storage account update")).toBe(
    false,
  )
  expect(s.commands.some((args) => args.includes("network-rule"))).toBe(false)
})

it("relaxes an installer-owned legacy account only after confirmation and verifies the update before data access", async () => {
  const s = await scenario({ existing: true })
  s.storage.networkRuleSet.defaultAction = "Deny"
  s.ui.confirm = vi.fn(async () => {
    expect(s.commands.some((args) => args.slice(0, 3).join(" ") === "storage account update")).toBe(
      false,
    )
    expect(s.storage.networkRuleSet.defaultAction).toBe("Deny")
    return true
  })

  await prepareBackend(s.context)

  expect(s.ui.confirm).toHaveBeenCalledOnce()
  const updateIndex = s.commands.findIndex(
    (args) => args.slice(0, 3).join(" ") === "storage account update",
  )
  const update = s.commands[updateIndex]!
  expect(update[update.indexOf("--default-action") + 1]).toBe("Allow")
  expect(update).not.toContain("--allow-shared-key-access")
  expect(update).not.toContain("--allow-blob-public-access")
  expect(update).not.toContain("--public-network-access")
  const verification = s.commands.findIndex(
    (args, index) => index > updateIndex && args.slice(0, 3).join(" ") === "storage account show",
  )
  const dataAccess = s.commands.findIndex(
    (args) => args.slice(0, 3).join(" ") === "storage container create",
  )
  expect(updateIndex).toBeGreaterThan(-1)
  expect(verification).toBeGreaterThan(updateIndex)
  expect(dataAccess).toBeGreaterThan(verification)
  expect(s.storage).toMatchObject({
    allowSharedKeyAccess: false,
    allowBlobPublicAccess: false,
    publicNetworkAccess: "Enabled",
    minimumTlsVersion: "TLS1_2",
    networkRuleSet: { defaultAction: "Allow" },
  })
})

it("leaves an existing account unchanged when the operator cancels network migration", async () => {
  const s = await scenario({ existing: true })
  s.storage.networkRuleSet.defaultAction = "Deny"
  s.ui.confirm = vi.fn(async () => false)
  const before = structuredClone(s.storage)

  await expect(prepareBackend(s.context)).rejects.toThrow()

  expect(s.ui.confirm).toHaveBeenCalledOnce()
  expect(s.storage).toEqual(before)
  expect(
    s.commands.some(
      (args) => args.includes("update") || args.includes("create") || args.includes("add"),
    ),
  ).toBe(false)
})

it("does not treat unattended deployment approval as consent to relax legacy state networking", async () => {
  const s = await scenario({ existing: true })
  s.storage.networkRuleSet.defaultAction = "Deny"
  delete s.ui.select
  const before = structuredClone(s.storage)

  await expect(prepareBackend(s.context)).rejects.toThrow(/interactive/i)

  expect(s.ui.confirm).not.toHaveBeenCalled()
  expect(s.storage).toEqual(before)
  expect(
    s.commands.some(
      (args) => args.includes("update") || args.includes("create") || args.includes("add"),
    ),
  ).toBe(false)
})

it.each([undefined, { owner: "another-team" }])(
  "refuses to relax an account without matching account ownership tags even when its resource group is owned",
  async (tags) => {
    const s = await scenario({ existing: true })
    s.storage.networkRuleSet.defaultAction = "Deny"
    s.storage.tags = tags

    await expect(prepareBackend(s.context)).rejects.toThrow()

    expect(s.ui.confirm).not.toHaveBeenCalled()
    expect(s.commands.some((args) => args.includes("update") || args.includes("create"))).toBe(
      false,
    )
  },
)

it("rejects a differently owned state resource group before inspecting or mutating its storage", async () => {
  const s = await scenario({ existing: true })
  s.groupTags.owner = "another-team"

  await expect(prepareBackend(s.context)).rejects.toThrow()

  expect(s.commands.some((args) => args[0] === "storage")).toBe(false)
})

it("does not adopt an unexpected account in the state resource group", async () => {
  const s = await scenario({ existing: true })
  s.accounts.push({ name: "unrelatedaccount" })

  await expect(prepareBackend(s.context)).rejects.toThrow()

  expect(s.commands.some((args) => args.includes("update") || args.includes("create"))).toBe(false)
})

it.each([
  { reason: "disabled endpoint", settings: { publicNetworkAccess: "Disabled" } },
  { reason: "network security perimeter", settings: { publicNetworkAccess: "SecuredByPerimeter" } },
  { reason: "unverified endpoint", settings: { publicNetworkAccess: undefined } },
  { reason: "shared keys", settings: { allowSharedKeyAccess: true } },
  { reason: "anonymous blobs", settings: { allowBlobPublicAccess: true } },
  { reason: "old TLS", settings: { minimumTlsVersion: "TLS1_1" } },
])(
  "refuses a legacy account with $reason instead of overriding its safeguards",
  async ({ settings }) => {
    const s = await scenario({ existing: true })
    s.storage.networkRuleSet.defaultAction = "Deny"
    Object.assign(s.storage, settings)
    const before = structuredClone(s.storage)

    await expect(prepareBackend(s.context)).rejects.toThrow()

    expect(s.storage).toEqual(before)
    expect(s.ui.confirm).not.toHaveBeenCalled()
    expect(s.commands.some((args) => args.includes("update") || args.includes("create"))).toBe(
      false,
    )
  },
)

it.each([
  { reason: "network rule unchanged", settings: { networkRuleSet: { defaultAction: "Deny" } } },
  { reason: "endpoint disabled", settings: { publicNetworkAccess: "Disabled" } },
  { reason: "shared keys enabled", settings: { allowSharedKeyAccess: true } },
  { reason: "anonymous blobs enabled", settings: { allowBlobPublicAccess: true } },
  { reason: "TLS downgraded", settings: { minimumTlsVersion: "TLS1_1" } },
])("rejects a post-update read with $reason before accessing state data", async ({ settings }) => {
  const s = await scenario({
    existing: true,
    afterUpdate: (storage) => Object.assign(storage, settings),
  })
  s.storage.networkRuleSet.defaultAction = "Deny"

  await expect(prepareBackend(s.context)).rejects.toThrow()

  expect(s.ui.confirm).toHaveBeenCalledOnce()
  expect(
    s.commands.filter((args) => args.slice(0, 3).join(" ") === "storage account show"),
  ).toHaveLength(2)
  expect(s.commands.some((args) => args.slice(0, 3).join(" ") === "storage container create")).toBe(
    false,
  )
  expect(s.commands.some((args) => args[0] === "role")).toBe(false)
})
