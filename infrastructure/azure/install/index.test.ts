import {
  chmod,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises"
import { join } from "node:path"
import { afterEach, expect, it, vi } from "vitest"

import { CommandExecutionError } from "../../installer/command/index.ts"
import { installationWorkspace } from "../../installer/workspace/index.ts"
import type { DeploymentConfig, InstallerUI, RunCommand } from "../../installer/types.ts"
import { installAzure } from "./index.ts"
import { installationNames } from "./settings.ts"
import { guidedPostgresProfile, type PostgresAvailability, type PostgresProfile } from "./profile.ts"
import type { DeploymentResult } from "./types.ts"

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
afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function scenario({
  existing = false,
  releaseFails = false,
  priorProvisioning = false,
  provisioningFails = false,
  retainedRelease = false,
  imageFailsOnce = false,
} = {}) {
  const directory = await mkdtemp(join(process.cwd(), ".replica-install-"))
  directories.push(directory)
  const config: DeploymentConfig = {
    version: 1,
    cloud: "azure",
    name: "test-hub",
    owner: "test-team",
    npmRegistry: "https://proxy.example/npm/",
    azure: {
      subscriptionId: "00000000-0000-0000-0000-000000000001",
      tenantId: "00000000-0000-0000-0000-000000000002",
      location: "eastus2",
      resourceGroup: "test-hub-group",
    },
  }
  const image = `registry.azurecr.io/replica-hub@sha256:${"a".repeat(64)}`
  const events: { command: string[]; env?: NodeJS.ProcessEnv }[] = []
  const messages: string[] = []
  const secretValues = new Map<string, string>(
    existing ? [["database-provisioned", config.azure.resourceGroup]] : [],
  )
  const vaultId = `/subscriptions/${config.azure.subscriptionId}/resourceGroups/foundation/providers/Microsoft.KeyVault/vaults/testvault`
  const foundation = {
    vault_id: vaultId,
    vault_url: "https://testvault.vault.azure.net/",
    registry_id: `/subscriptions/${config.azure.subscriptionId}/resourceGroups/foundation/providers/Microsoft.ContainerRegistry/registries/registry`,
    registry_url: "registry.azurecr.io",
  }
  let released = false
  let imageAttempts = 0
  let releaseLocked = retainedRelease
  const installation = {
    environment_id: `/subscriptions/${config.azure.subscriptionId}/resourceGroups/${config.azure.resourceGroup}/providers/Microsoft.App/managedEnvironments/test`,
    resource_group_id: `/subscriptions/${config.azure.subscriptionId}/resourceGroups/${config.azure.resourceGroup}`,
    app_id: null as string | null,
    postgres_server_id: `/subscriptions/${config.azure.subscriptionId}/resourceGroups/${config.azure.resourceGroup}/providers/Microsoft.DBforPostgreSQL/flexibleServers/test-hub-postgres`,
    storage_account_id: `/subscriptions/${config.azure.subscriptionId}/resourceGroups/${config.azure.resourceGroup}/providers/Microsoft.Storage/storageAccounts/artifactstore`,
    resource_group: config.azure.resourceGroup,
    storage_account: "artifactstore",
    postgres_host: "test-hub-postgres.postgres.database.azure.com",
    url: null as string | null,
  }
  const run: RunCommand = async (executable, args, options) => {
    events.push({ command: [executable, ...args], env: options?.env })
    if (executable === "terraform") {
      const module = args[0]!.endsWith("/foundation")
        ? "foundation"
        : args[0]!.endsWith("/provision")
          ? "provision"
          : "app"
      const operation = args[1]
      if (operation === "init" || operation === "plan" || operation === "apply") return ""
      if (operation === "state")
        return module === "app" && existing ? "azurerm_container_app.hub[0]" : ""
      if (operation === "show") return JSON.stringify({ resource_changes: [] })
      if (operation === "output") {
        if (module === "foundation") return JSON.stringify(foundation)
        if (module === "provision") return JSON.stringify("test-hub-provision")
        return JSON.stringify(installation)
      }
    }
    if (executable === "git") return args[0] === "rev-parse" ? "a".repeat(40) : ""
    if (executable === "docker") {
      imageAttempts++
      await writeFile(
        args[args.indexOf("--metadata-file") + 1]!,
        JSON.stringify({
          "containerimage.digest": `sha256:${"a".repeat(64)}`,
        }),
      )
      if (imageFailsOnce && imageAttempts === 1)
        throw new CommandExecutionError("npm ci failed: ECONNRESET registry.npmjs.org", false, 1)
      return ""
    }
    if (executable === process.execPath) {
      if (releaseLocked) throw new CommandExecutionError("The previous release lease is retained")
      if (releaseFails) throw new CommandExecutionError("Release failed")
      released = true
      installation.url = "https://hub.example.com"
      installation.app_id = `/subscriptions/${config.azure.subscriptionId}/resourceGroups/${config.azure.resourceGroup}/providers/Microsoft.App/containerApps/test-hub-hub`
      return ""
    }
    if (executable !== "az") throw new Error(`Unexpected executable ${executable}`)
    const operation = args.slice(0, 3).join(" ")
    if (operation === "postgres flexible-server list-skus")
      return JSON.stringify([{
        status: null, reason: null, restricted: null,
        supportedServerVersions: ["16", "17"].map((name) => ({ name, status: null, reason: null })),
        supportedServerEditions: [{
          name: "Burstable", status: null, reason: null,
          supportedServerSkus: ["Standard_B1ms", "Standard_B2s"].map((name) =>
            ({ name, status: null, reason: null })),
        }],
      }])
    if (operation.startsWith("account show"))
      return JSON.stringify({
        id: config.azure.subscriptionId,
        tenantId: config.azure.tenantId,
      })
    if (operation.startsWith("account get-access-token"))
      return JSON.stringify({
        accessToken: `header.${Buffer.from(JSON.stringify({ oid: "00000000-0000-0000-0000-000000000003" })).toString("base64url")}.signature`,
      })
    if (operation.startsWith("provider show"))
      return JSON.stringify({ registrationState: "Registered" })
    if (operation.startsWith("group exists"))
      return JSON.stringify(
        retainedRelease && args[args.indexOf("--name") + 1] === config.azure.resourceGroup,
      )
    if (operation.startsWith("group show"))
      return JSON.stringify({
        tags: {
          application: "replica-hub",
          installation: config.name,
          owner: config.owner,
          managed_by: "terraform",
        },
      })
    if (operation === "storage account list" || operation === "role assignment list") return "[]"
    if (operation === "storage account show" && args[args.indexOf("--query") + 1] === "tags")
      return JSON.stringify({
        application: "replica-hub",
        installation: config.name,
        owner: config.owner,
        managed_by: "terraform",
      })
    if (operation === "storage account show")
      return JSON.stringify({
        id: `/subscriptions/${config.azure.subscriptionId}/resourceGroups/state/providers/Microsoft.Storage/storageAccounts/state`,
        allowSharedKeyAccess: false,
        allowBlobPublicAccess: false,
        minimumTlsVersion: "TLS1_2",
        publicNetworkAccess: "Enabled",
        networkRuleSet: { defaultAction: "Allow" },
        tags: {
          application: "replica-hub",
          installation: config.name,
          owner: config.owner,
          managed_by: "replica-installer",
        },
      })
    if (operation === "storage blob exists") return JSON.stringify({ exists: true })
    if (operation === "storage blob show")
      return JSON.stringify(
        args[args.indexOf("--name") + 1] === "deployment.lock" && releaseLocked
          ? { state: "leased", status: "locked", duration: "infinite" }
          : { state: "available", status: "unlocked", duration: null },
      )
    if (operation === "storage blob list")
      return JSON.stringify(
        ["foundation", "app", "provision"].map((module) => ({
          name: `${config.name}/${module}.tfstate`,
          lease: { state: "available", status: "unlocked", duration: null },
        })),
      )
    if (operation === "storage blob lease" && args[3] === "break") {
      const account = args[args.indexOf("--account-name") + 1]
      const container = args[args.indexOf("--container-name") + 1]
      const blob = args[args.indexOf("--blob-name") + 1]
      if (account !== "artifactstore" || container !== "releases" || blob !== "deployment.lock")
        throw new Error("The installer tried to break a different lock")
      releaseLocked = false
      return "{}"
    }
    if (operation === "storage blob lease") return JSON.stringify("lease-id")
    if (operation === "containerapp job list" || args.slice(0, 2).join(" ") === "containerapp list")
      return "[]"
    if (operation === "keyvault secret list")
      return JSON.stringify([...secretValues.keys()].map((name) => ({ name })))
    if (operation === "keyvault secret set") {
      const name = args[args.indexOf("--name") + 1]!
      secretValues.set(name, await readFile(args[args.indexOf("--file") + 1]!, "utf8"))
      return JSON.stringify({
        id: `https://testvault.vault.azure.net/secrets/${name}/${"a".repeat(32)}`,
      })
    }
    if (operation === "keyvault secret show") {
      const name = args[args.indexOf("--name") + 1]!
      return JSON.stringify({
        id: `https://testvault.vault.azure.net/secrets/${name}/${"a".repeat(32)}`,
        value: secretValues.get(name),
      })
    }
    if (operation === "containerapp job execution") {
      return args[3] === "list"
        ? JSON.stringify(
            priorProvisioning ? [{ name: "prior", properties: { status: "Failed" } }] : [],
          )
        : JSON.stringify({ properties: { status: "Succeeded" } })
    }
    if (operation === "containerapp job start") {
      if (provisioningFails) throw new CommandExecutionError("Provisioning start failed")
      return JSON.stringify({ name: "execution-1" })
    }
    if (
      operation.startsWith("acr login") ||
      operation.startsWith("group create") ||
      operation === "storage account create" ||
      operation === "storage account blob-service-properties" ||
      operation === "storage container create" ||
      operation === "role assignment create"
    )
      return "{}"
    throw new Error(`Unexpected Azure command ${operation}`)
  }
  const ui: InstallerUI = {
    status: (message) => messages.push(message),
    confirm: async () => true,
    wait: vi.fn(async (message) => {
      throw new Error(message)
    }),
  }
  return {
    config,
    directory,
    run,
    ui,
    events,
    messages,
    secretValues,
    image,
    installation,
    expectedResult: (): DeploymentResult => ({
      name: config.name,
      url: "https://hub.example.com",
      subscriptionId: config.azure.subscriptionId,
      tenantId: config.azure.tenantId,
      location: config.azure.location,
      image,
      resources: {
        resourceGroup: installation.resource_group_id,
        app: installation.app_id!,
        environment: installation.environment_id,
        database: installation.postgres_server_id,
        storage: installation.storage_account_id,
        registry: foundation.registry_id,
        vault: foundation.vault_id,
        stateStorage: `/subscriptions/${config.azure.subscriptionId}/resourceGroups/state/providers/Microsoft.Storage/storageAccounts/state`,
      },
    }),
    released: () => released,
  }
}

function installationChanges(events: { command: string[] }[]) {
  return events.filter(
    ({ command }) =>
      command[0] === process.execPath ||
      command.some((argument) =>
        [
          "create",
          "update",
          "delete",
          "set",
          "start",
          "register",
          "login",
          "build",
          "apply",
          "plan",
          "init",
          "break",
          "release",
          "acquire",
        ].includes(argument),
      ),
  )
}

it("rejects an already cancelled installation before commands, approval, or workspace writes", async () => {
  const s = await scenario()
  const controller = new AbortController()
  controller.abort()
  const run = vi.fn(s.run)
  s.ui.confirm = vi.fn(async () => true)

  await expect(
    installAzure(s.config, { ...s, run, signal: controller.signal }),
  ).rejects.toMatchObject({ name: "AbortError" })

  expect(run).not.toHaveBeenCalled()
  expect(s.ui.confirm).not.toHaveBeenCalled()
  expect(await readdir(s.directory)).toEqual([])
})

it("stops after cancellation during compatibility lookup before approval or cloud mutation", async () => {
  const s = await scenario()
  const controller = new AbortController()
  const entered = Promise.withResolvers<void>()
  const finish = Promise.withResolvers<boolean>()
  const availability = vi.fn<PostgresAvailability>(async () => {
    entered.resolve()
    return finish.promise
  })
  s.ui.confirm = vi.fn(async () => true)
  const installing = installAzure(s.config, {
    ...s, availability, signal: controller.signal,
  }).catch((failure: unknown) => failure)

  await entered.promise
  controller.abort()
  finish.resolve(true)

  expect(await installing).toMatchObject({ name: "AbortError" })
  expect(s.ui.confirm).not.toHaveBeenCalled()
  expect(installationChanges(s.events)).toEqual([])
})

it("preserves supported runtime, database and TLS customization in privately replaced installation inputs", async () => {
  const s = await scenario({ existing: true })
  const checked: PostgresProfile[] = []
  const availability = vi.fn<PostgresAvailability>(async (subscription, region, profile) => {
    expect(subscription).toBe(s.config.azure.subscriptionId)
    expect(region).toBe("eastus2")
    expect(installationChanges(s.events)).toEqual([])
    expect(s.ui.confirm).not.toHaveBeenCalled()
    checked.push(profile)
    return true
  })
  s.ui.confirm = vi.fn(async () => true)
  await installAzure(s.config, { ...s, availability })
  const workspace = installationWorkspace(s.config, s.directory)
  const filename = join(workspace, "installation.tfvars.json")
  const original = JSON.parse(await readFile(filename, "utf8")) as Record<string, unknown>
  expect(checked).toEqual([guidedPostgresProfile])
  expect(original).toMatchObject(checked[0]!)
  expect(vi.mocked(s.ui.confirm).mock.calls[0]![0]).toContain(
    `${guidedPostgresProfile.postgres_sku}, version ${guidedPostgresProfile.postgres_version}`,
  )
  const customization = {
    runtime_environment_variables: {
      GITHUB_CLIENT_ID: "synthetic-public-client",
      HUB_APPLICATION_ORIGIN: "https://synthetic-public-hub.example.com",
      EMPTY_SETTING: "",
    },
    runtime_secret_references: {
      SERVICE_API_KEY: {
        key_vault_id: `/subscriptions/${s.config.azure.subscriptionId}/resourceGroups/secrets/providers/Microsoft.KeyVault/vaults/service`,
        secret_id: `https://service.vault.azure.net/secrets/api-key/${"c".repeat(32)}`,
      },
    },
    postgres_sku: "B_Standard_B2s",
    postgres_version: "16",
    backup_retention_days: 21,
    custom_hostname: "hub.example.com",
    certificate_id: `${s.installation.environment_id}/certificates/hub-tls`,
  }
  const previous = `${JSON.stringify({ ...original, ...customization }, null, 2)}\n  \n`
  await writeFile(filename, previous, { mode: 0o600 })
  const reader = await open(filename, "r")
  s.events.length = 0
  s.messages.length = 0
  vi.mocked(s.ui.confirm).mockClear()

  try {
    await expect(installAzure(s.config, { ...s, availability })).resolves.toEqual(s.expectedResult())

    const replacement = await readFile(filename, "utf8")
    expect(checked).toEqual([
      guidedPostgresProfile,
      { postgres_sku: customization.postgres_sku, postgres_version: customization.postgres_version },
    ])
    expect(JSON.parse(replacement)).toMatchObject(customization)
    expect(JSON.parse(replacement)).toMatchObject(checked[1]!)
    const review = vi.mocked(s.ui.confirm).mock.calls[0]![0]
    expect(review).toContain(`${customization.postgres_sku}, version ${customization.postgres_version}`)
    expect(review).not.toContain(guidedPostgresProfile.postgres_sku)
    const diagnostics = JSON.stringify([s.events, s.messages, vi.mocked(s.ui.confirm).mock.calls])
    expect(diagnostics).not.toMatch(/synthetic-public-client|synthetic-public-hub/)
    expect(replacement).not.toBe(previous)
    expect(await reader.readFile("utf8")).toBe(previous)
    expect((await stat(filename)).mode & 0o777).toBe(0o600)
    expect((await stat(workspace)).mode & 0o777).toBe(0o700)
    expect(await readdir(s.directory)).toEqual([workspace.slice(s.directory.length + 1)])
  } finally {
    await reader.close()
  }
})

it("refuses an unsupported retained PostgreSQL profile before approval, writes, or cloud mutation without retargeting", async () => {
  const s = await scenario({ existing: true })
  await installAzure(s.config, s)
  const workspace = installationWorkspace(s.config, s.directory)
  const filename = join(workspace, "installation.tfvars.json")
  const retained = { postgres_sku: "B_Standard_B2s", postgres_version: "16" }
  const previous = `${JSON.stringify({
    ...JSON.parse(await readFile(filename, "utf8")),
    ...retained,
  }, null, 2)}\n`
  await writeFile(filename, previous, { mode: 0o600 })
  const files = await readdir(workspace)
  const originalConfig = structuredClone(s.config)
  s.events.length = 0
  s.ui.confirm = vi.fn(async () => true)
  const availability = vi.fn<PostgresAvailability>(async () => false)

  await expect(installAzure(s.config, { ...s, availability })).rejects.toThrow(/region.*not advertise|not.*support/i)

  expect(availability).toHaveBeenCalledExactlyOnceWith(
    s.config.azure.subscriptionId, "eastus2", retained,
  )
  expect(s.ui.confirm).not.toHaveBeenCalled()
  expect(installationChanges(s.events)).toEqual([])
  expect(s.config).toEqual(originalConfig)
  expect(await readFile(filename, "utf8")).toBe(previous)
  expect(await readdir(workspace)).toEqual(files)
})

it.each([
  { reason: "unknown customization", change: { unsupported_runtime_setting: "synthetic-value" } },
  { reason: "invalid PostgreSQL SKU", change: { postgres_sku: "invalid" } },
  { reason: "unknown PostgreSQL SKU model", change: { postgres_sku: "B_Standard_B999ms" } },
  { reason: "unsupported PostgreSQL version", change: { postgres_version: "1" } },
  {
    reason: "PostgreSQL version outside the pinned provider contract",
    change: { postgres_version: "18" },
  },
  { reason: "invalid backup retention", change: { backup_retention_days: 0 } },
  {
    reason: "a deployment-owned runtime environment override",
    change: { runtime_environment_variables: { NODE_ENV: "synthetic-invalid-runtime-value" } },
  },
  { reason: "different stored installation name", change: { name: "another-hub" } },
  { reason: "different stored ownership", change: { owner: "another-team" } },
  { reason: "different stored region", change: { location: "westus2" } },
  { reason: "unpaired hostname", change: { custom_hostname: "hub.example.com" } },
  {
    reason: "invalid runtime secret URL",
    change: {
      runtime_secret_references: {
        SERVICE_API_KEY: {
          key_vault_id:
            "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/secrets/providers/Microsoft.KeyVault/vaults/service",
          secret_id: "http://service.vault.azure.net/secrets/api-key",
        },
      },
    },
  },
  {
    reason: "different stored target",
    change: { subscription_id: "cccccccc-dddd-4eee-8fff-aaaaaaaaaaaa" },
  },
])("refuses $reason before changing cloud resources or saved inputs", async ({ change }) => {
  const s = await scenario({ existing: true })
  await installAzure(s.config, s)
  const workspace = installationWorkspace(s.config, s.directory)
  const filename = join(workspace, "installation.tfvars.json")
  const original = JSON.parse(await readFile(filename, "utf8")) as Record<string, unknown>
  const previous = `${JSON.stringify({ ...original, ...change }, null, 2)}\n`
  await writeFile(filename, previous, { mode: 0o600 })
  const files = await readdir(workspace)
  s.events.length = 0
  s.messages.length = 0
  s.ui.confirm = vi.fn(async () => true)
  const availability = vi.fn<PostgresAvailability>(async () => true)

  const failure = await installAzure(s.config, { ...s, availability }).catch(
    (error: unknown) => error,
  )

  expect(failure).toBeInstanceOf(Error)
  expect(String(failure)).not.toContain("synthetic-invalid-runtime-value")
  expect(availability).not.toHaveBeenCalled()
  expect(s.ui.confirm).not.toHaveBeenCalled()
  expect(installationChanges(s.events)).toEqual([])
  expect(JSON.stringify(s.messages)).not.toContain("synthetic-invalid-runtime-value")
  expect(await readFile(filename, "utf8")).toBe(previous)
  expect(await readdir(workspace)).toEqual(files)
})

it("preserves a legacy name-only workspace and requires manual migration review before cloud changes", async () => {
  const s = await scenario()
  const legacy = join(s.directory, s.config.name)
  await mkdir(legacy, { mode: 0o700 })
  const filename = join(legacy, "terraform.tfstate")
  const previous = '{"synthetic":"preserve-legacy-assets"}\n'
  await writeFile(filename, previous, { mode: 0o600 })

  await expect(installAzure(s.config, s)).rejects.toThrow(
    /manual.*migration|reviewed.*migration|migration.*review/i,
  )

  expect(installationChanges(s.events)).toEqual([])
  expect(await readFile(filename, "utf8")).toBe(previous)
  expect(await readdir(s.directory)).toEqual([s.config.name])
})

it.each(["parent", "workspace"] as const)(
  "refuses a precreated shared %s directory without silently changing its permissions",
  async (path) => {
    const s = await scenario()
    const directory =
      path === "parent" ? s.directory : installationWorkspace(s.config, s.directory)
    if (path === "workspace") await mkdir(directory, { mode: 0o700 })
    await chmod(directory, 0o777)

    await expect(installAzure(s.config, s)).rejects.toThrow()

    expect(installationChanges(s.events)).toEqual([])
    expect((await stat(directory)).mode & 0o777).toBe(0o777)
    expect(await readdir(directory)).toEqual([])
  },
)

it("refuses a symlinked generated workspace without changing its target", async () => {
  const s = await scenario()
  const target = join(s.directory, "unrelated-assets")
  await mkdir(target, { mode: 0o700 })
  const filename = join(target, "keep.json")
  await writeFile(filename, '{"synthetic":"keep"}\n', { mode: 0o600 })
  await symlink(target, installationWorkspace(s.config, s.directory), "dir")

  await expect(installAzure(s.config, s)).rejects.toThrow()

  expect(installationChanges(s.events)).toEqual([])
  expect(await readFile(filename, "utf8")).toBe('{"synthetic":"keep"}\n')
  expect(await readdir(target)).toEqual(["keep.json"])
})

it("refuses a private configuration parent beneath a shared writable ancestor", async () => {
  const s = await scenario()
  const shared = join(s.directory, "shared")
  const parent = join(shared, "private")
  await mkdir(parent, { recursive: true, mode: 0o700 })
  await chmod(shared, 0o777)

  await expect(installAzure(s.config, { ...s, directory: parent })).rejects.toThrow()

  expect(installationChanges(s.events)).toEqual([])
  expect((await stat(shared)).mode & 0o777).toBe(0o777)
  expect((await stat(parent)).mode & 0o777).toBe(0o700)
  expect(await readdir(parent)).toEqual([])
})

it("refuses a symlinked generated input file without reading or replacing the linked private assets", async () => {
  const s = await scenario({ existing: true })
  await installAzure(s.config, s)
  const workspace = installationWorkspace(s.config, s.directory)
  const filename = join(workspace, "installation.tfvars.json")
  const target = join(s.directory, "unrelated-inputs.json")
  const previous = await readFile(filename, "utf8")
  await writeFile(target, previous, { mode: 0o600 })
  await rm(filename)
  await symlink(target, filename)
  s.events.length = 0

  await expect(installAzure(s.config, s)).rejects.toThrow()

  expect(installationChanges(s.events)).toEqual([])
  expect(await readFile(target, "utf8")).toBe(previous)
  expect((await stat(target)).mode & 0o777).toBe(0o600)
})

it("rejects another local writer for the same target even when configuration objects are independent", async () => {
  const s = await scenario()
  const entered = Promise.withResolvers<void>()
  const continueFirst = Promise.withResolvers<void>()
  const firstRun: RunCommand = async (executable, args, options) => {
    if (executable === "az" && args.slice(0, 2).join(" ") === "group create") {
      entered.resolve()
      await continueFirst.promise
    }
    return s.run(executable, args, options)
  }
  const first = installAzure(s.config, { ...s, run: firstRun })
  const secondRun = vi.fn<RunCommand>(s.run)
  try {
    await entered.promise

    await expect(
      installAzure(structuredClone(s.config), { ...s, run: secondRun }),
    ).rejects.toThrow(/workspace|writer|lock/i)

    const secondEvents = secondRun.mock.calls.map(([executable, args]) => ({
      command: [executable, ...args],
    }))
    expect(installationChanges(secondEvents)).toEqual([])
  } finally {
    continueFirst.resolve()
    const result = await first
    expect(result).toEqual(s.expectedResult())
  }
})

it("accepts the correct mixed-case signed-in Azure target and rejects a true mismatch before cloud changes", async () => {
  const s = await scenario()
  s.config.azure.subscriptionId = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff"
  s.config.azure.tenantId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
  const mixedRun: RunCommand = async (executable, args, options) => {
    if (executable === "az" && args.slice(0, 2).join(" ") === "account show")
      return JSON.stringify({
        id: s.config.azure.subscriptionId.toUpperCase(),
        tenantId: s.config.azure.tenantId.toUpperCase(),
      })
    return s.run(executable, args, options)
  }
  const stopped = new Error("Synthetic stop at the first permitted cloud write")
  const run: RunCommand = async (executable, args, options) => {
    if (executable === "az" && args.slice(0, 2).join(" ") === "group create") throw stopped
    return mixedRun(executable, args, options)
  }

  await expect(installAzure(s.config, { ...s, run })).rejects.toBe(stopped)

  s.events.length = 0
  const mismatchRun: RunCommand = async (executable, args, options) => {
    if (executable === "az" && args.slice(0, 2).join(" ") === "account show")
      return JSON.stringify({
        id: "cccccccc-dddd-4eee-8fff-aaaaaaaaaaaa",
        tenantId: s.config.azure.tenantId,
      })
    return s.run(executable, args, options)
  }
  await expect(installAzure(s.config, { ...s, run: mismatchRun })).rejects.toThrow()
  expect(installationChanges(s.events)).toEqual([])
})

it("uses one deployment approval for dirty-source publication, nonempty plans, temporary cleanup, and guarded release", async () => {
  const s = await scenario()
  const temporaryResources = [
    "azurerm_container_app_job.provision",
    "azurerm_user_assigned_identity.provision",
    "azurerm_role_assignment.image[0]",
    'azurerm_role_assignment.secrets["DATABASE_URL"]',
    'azurerm_role_assignment.secrets["HUB_MIGRATION_PASSWORD"]',
    'azurerm_role_assignment.secrets["HUB_RUNTIME_PASSWORD"]',
  ]
  let cleanupPlan = false
  s.ui.confirm = vi.fn(async () => {
    expect(installationChanges(s.events)).toEqual([])
    return true
  })
  s.ui.select = vi.fn(async () => {
    throw new Error("A normal deployment must not need recovery")
  })
  const releasingLease = Promise.withResolvers<void>()
  const finishLeaseRelease = Promise.withResolvers<void>()
  let receiptReturned = false
  const run: RunCommand = async (executable, args, options) => {
    const result = await s.run(executable, args, options)
    if (executable === "git" && args[0] === "status") return " M hub/server/index.ts"
    if (executable === "terraform") {
      if (args[0]!.endsWith("/provision") && args[1] === "plan")
        cleanupPlan = args.includes("-destroy")
      if (args[1] === "show") {
        const changes = args[0]!.endsWith("/provision")
          ? temporaryResources.map((address) => ({
              address,
              change: { actions: [cleanupPlan ? "delete" : "create"] },
            }))
          : args[0]!.endsWith("/foundation")
            ? [
                { address: "azurerm_container_registry.hub", change: { actions: ["create"] } },
                { address: "azurerm_key_vault.hub", change: { actions: ["update"] } },
              ]
            : [
                { address: "azurerm_storage_blob.release_lock", change: { actions: ["create"] } },
              ]
        return JSON.stringify({ resource_changes: changes })
      }
    }
    if (
      executable === "az" &&
      args.slice(0, 4).join(" ") === "storage blob lease release" &&
      args.includes(`${s.config.name}/installer.lock`)
    ) {
      releasingLease.resolve()
      await finishLeaseRelease.promise
      expect(receiptReturned).toBe(false)
    }
    return result
  }
  const installing = installAzure(s.config, { ...s, run }).then((result) => {
    receiptReturned = true
    return result
  })
  await Promise.race([releasingLease.promise, installing])
  await Promise.resolve()
  expect(receiptReturned).toBe(false)
  finishLeaseRelease.resolve()
  const result = await installing
  expect(result).toEqual(s.expectedResult())
  expect(s.ui.confirm).toHaveBeenCalledOnce()
  expect(s.ui.select).not.toHaveBeenCalled()
  expect(s.messages).toEqual(
    expect.arrayContaining([
      "create azurerm_container_registry.hub",
      "update azurerm_key_vault.hub",
      "create azurerm_storage_blob.release_lock",
      ...temporaryResources.flatMap((address) => [`create ${address}`, `delete ${address}`]),
    ]),
  )
  const commands = s.events.map(({ command }) => command)
  const start = commands.findIndex(
    (command) => command.slice(0, 4).join(" ") === "az containerapp job start",
  )
  const cleanup = commands.findIndex(
    (command) =>
      command[0] === "terraform" &&
      command[1]!.endsWith("/provision") &&
      command.includes("-destroy"),
  )
  const release = commands.findIndex((command) => command[0] === process.execPath)
  expect(start).toBeGreaterThan(-1)
  expect(cleanup).toBeGreaterThan(start)
  expect(release).toBeGreaterThan(cleanup)
  const finalOutput = commands.findLastIndex(
    (command) =>
      command[0] === "terraform" && command[1]!.endsWith("/azure") && command[2] === "output",
  )
  const installerRelease = commands.findIndex(
    (command) =>
      command.slice(0, 5).join(" ") === "az storage blob lease release" &&
      command.includes(`${s.config.name}/installer.lock`),
  )
  expect(finalOutput).toBeGreaterThan(release)
  expect(installerRelease).toBeGreaterThan(finalOutput)
  expect(commands.find((command) => command[0] === "docker")).toContain(
    "NPM_REGISTRY=https://proxy.example/npm/",
  )
  expect(commands[release]).toContain(s.image)
  expect(
    commands.some(
      (command) => command.slice(0, 5).join(" ") === "az storage account network-rule add",
    ),
  ).toBe(false)
  expect(s.secretValues.get("database-provisioned")).toBe(s.config.azure.resourceGroup)
  const serialized = JSON.stringify({ commands, messages: s.messages })
  for (const [name, value] of s.secretValues) {
    if (name.includes("password") || name.endsWith("-url")) expect(serialized).not.toContain(value)
    if (name.includes("password")) {
      expect(value.length).toBeGreaterThanOrEqual(32)
      expect(value).toMatch(/[A-Z]/)
      expect(value).toMatch(/[a-z]/)
      expect(value).toMatch(/[0-9]/)
    }
  }
  for (const command of commands.filter((command) => command[0] === "az")) {
    expect(command[command.indexOf("--subscription") + 1]).toBe(s.config.azure.subscriptionId)
  }
})

it("shows the complete deployment review and stops before cloud changes when it is declined", async () => {
  const s = await scenario()
  const sourceRevision = "a".repeat(40)
  s.ui.confirm = vi.fn(async () => false)
  s.ui.select = vi.fn(async () => {
    throw new Error("Declining deployment must not offer recovery")
  })
  const run: RunCommand = async (executable, args, options) => {
    const result = await s.run(executable, args, options)
    return executable === "git" && args[0] === "status" ? " M hub/server/index.ts" : result
  }

  await expect(installAzure(s.config, { ...s, run })).rejects.toThrow(/cancel/i)

  expect(s.ui.confirm).toHaveBeenCalledOnce()
  const review = vi.mocked(s.ui.confirm).mock.calls[0]![0]
  for (const value of [
    s.config.name,
    s.config.owner,
    s.config.azure.tenantId,
    s.config.azure.subscriptionId,
    s.config.azure.location,
    s.config.azure.resourceGroup,
    ...Object.values(installationNames(s.config)),
    sourceRevision,
    s.config.npmRegistry!,
  ])
    expect(review).toContain(value)
  for (const disclosure of [
    /ongoing.*(?:charge|cost)/i,
    /(?:local|working tree).*(?:publish|build)|(?:publish|build).*(?:local|working tree)/i,
    /uncommitted.*Hub|Hub.*uncommitted/i,
    /state.*(?:storage|blob)/i,
    /registry/i,
    /key vault/i,
    /(?:virtual network|networking)/i,
    /PostgreSQL.*(?:database|backup)/i,
    /artifact.*release.*container/i,
    /Container Apps.*(?:Hub|app)/i,
    /setup job/i,
    /Log Analytics/i,
    /identit/i,
    /role assignment|scoped.*grant/i,
    /temporary.*(?:removed|cleaned)|(?:remove|clean).*temporary/i,
    /(?:unavailable|downtime|maintenance)/i,
    /stops?.*Hub.*revision/i,
    /migration/i,
    /schedule.*setup/i,
    /one.*retr.*15 seconds/i,
  ])
    expect(review).toMatch(disclosure)
  expect(installationChanges(s.events)).toEqual([])
  expect(s.ui.select).not.toHaveBeenCalled()
  expect(s.ui.wait).not.toHaveBeenCalled()
  expect(s.released()).toBe(false)
})

it("refuses unattended dirty source at the initial review before cloud changes", async () => {
  const s = await scenario()
  s.ui.confirm = vi.fn(async () => true)
  const run: RunCommand = async (executable, args, options) => {
    const result = await s.run(executable, args, options)
    return executable === "git" && args[0] === "status" ? " M hub/server/index.ts" : result
  }

  await expect(installAzure(s.config, { ...s, run })).rejects.toThrow(/clean.*source|source.*clean/i)

  expect(s.ui.confirm).not.toHaveBeenCalled()
  expect(installationChanges(s.events)).toEqual([])
})

it("blocks unrelated resources in provisioning cleanup despite initial deployment approval", async () => {
  const s = await scenario()
  let cleanupPlan = false
  s.ui.confirm = vi.fn(async () => true)
  s.ui.select = vi.fn(async () => "exit")
  const run: RunCommand = async (executable, args, options) => {
    const result = await s.run(executable, args, options)
    if (executable !== "terraform" || !args[0]!.endsWith("/provision")) return result
    if (args[1] === "plan") cleanupPlan = args.includes("-destroy")
    if (args[1] === "show" && cleanupPlan)
      return JSON.stringify({
        resource_changes: [
          { address: "azurerm_container_app_job.provision", change: { actions: ["delete"] } },
          { address: "azurerm_postgresql_flexible_server.hub", change: { actions: ["delete"] } },
        ],
      })
    return result
  }

  await expect(installAzure(s.config, { ...s, run })).rejects.toThrow()

  const commands = s.events.map(({ command }) => command)
  const cleanup = commands.findIndex(
    (command) =>
      command[0] === "terraform" &&
      command[1]!.endsWith("/provision") &&
      command.includes("-destroy"),
  )
  expect(cleanup).toBeGreaterThan(-1)
  expect(commands.slice(cleanup).some((command) => command[2] === "apply")).toBe(false)
  expect(s.ui.confirm).toHaveBeenCalledOnce()
  expect(s.ui.select).not.toHaveBeenCalled()
  expect(s.released()).toBe(false)
  expect(
    commands.some((command) => command.slice(0, 5).join(" ") === "az storage blob lease release"),
  ).toBe(false)
})

it("updates an installed app only through the release orchestrator and never reruns fresh role provisioning", async () => {
  const s = await scenario({ existing: true })
  s.ui.confirm = vi.fn(async () => true)
  const result = await installAzure(s.config, s)
  expect(result).toEqual(s.expectedResult())
  expect(s.released()).toBe(true)
  expect(s.ui.confirm).toHaveBeenCalledOnce()
  const commands = s.events.map(({ command }) => command)
  const release = commands.findIndex((command) => command[0] === process.execPath)
  const finalOutput = commands.findLastIndex(
    (command) =>
      command[0] === "terraform" && command[1]!.endsWith("/azure") && command[2] === "output",
  )
  expect(finalOutput).toBeGreaterThan(release)
  const installerRelease = commands.findIndex(
    (command) =>
      command.slice(0, 5).join(" ") === "az storage blob lease release" &&
      command.includes(`${s.config.name}/installer.lock`),
  )
  expect(installerRelease).toBeGreaterThan(finalOutput)
  expect(
    s.events.some(({ command }) => command.slice(0, 4).join(" ") === "az containerapp job start"),
  ).toBe(false)
  expect(
    s.events.some(
      ({ command }) =>
        command[0] === "terraform" &&
        command[1]!.endsWith("/azure") &&
        ["plan", "apply"].includes(command[2]!),
    ),
  ).toBe(false)
})

it("corrects an image-build proxy under the same installation lease without replaying infrastructure or credentials", async () => {
  const s = await scenario({ imageFailsOnce: true })
  delete s.config.npmRegistry
  const registry = "https://packages.example/npm/"
  s.ui.text = vi.fn(async () => registry)
  s.ui.select = vi.fn<NonNullable<InstallerUI["select"]>>(async (_message, options) => {
    expect(options.map(({ value }) => value)).toContain("registry")
    const commands = s.events.map(({ command }) => command)
    expect(commands.filter((command) => command[0] === "docker")).toHaveLength(1)
    expect(
      commands.some(
        (command) =>
          command.slice(0, 5).join(" ") === "az storage blob lease release" ||
          command.slice(0, 5).join(" ") === "az storage blob lease break" ||
          command.slice(0, 4).join(" ") === "az containerapp job start" ||
          command[0] === process.execPath,
      ),
    ).toBe(false)
    return "registry"
  })
  const saveNpmRegistry = vi.fn(async (value: string) => {
    expect(value).toBe(registry)
    expect(s.events.filter(({ command }) => command[0] === "docker")).toHaveLength(1)
  })

  await expect(installAzure(s.config, { ...s, saveNpmRegistry })).resolves.toEqual(
    expect.objectContaining({ url: "https://hub.example.com", image: s.image }),
  )

  const commands = s.events.map(({ command }) => command)
  const builds = commands
    .map((command, index) => (command[0] === "docker" ? index : -1))
    .filter((index) => index >= 0)
  expect(builds).toHaveLength(2)
  expect(commands[builds[0]!]!).not.toContain("--build-arg")
  expect(commands[builds[1]!]!).toContain(`NPM_REGISTRY=${registry}`)
  expect(commands.slice(builds[0]! + 1, builds[1]!)).toEqual([
    ["git", "rev-parse", "HEAD"],
    ["git", "status", "--porcelain", "--untracked-files=normal"],
    expect.arrayContaining(["az", "acr", "login"]),
  ])
  expect(saveNpmRegistry).toHaveBeenCalledExactlyOnceWith(registry)
  expect(
    commands.filter(
      (command) =>
        command.slice(0, 5).join(" ") === "az storage blob lease acquire" &&
        command.includes(`${s.config.name}/installer.lock`),
    ),
  ).toHaveLength(1)
  expect(
    commands.some((command) => command.slice(0, 5).join(" ") === "az storage blob lease break"),
  ).toBe(false)
  expect(
    commands.filter((command) => command.slice(0, 4).join(" ") === "az containerapp job start"),
  ).toHaveLength(1)
  const releases = commands.filter((command) => command[0] === process.execPath)
  expect(releases).toHaveLength(1)
  expect(releases[0]).toContain(s.image)
})

it.each(["application", "provisioning"] as const)(
  "automatically replans only the failed %s infrastructure without replaying publication or database work",
  async (stage) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    const s = await scenario()
    const controller = new AbortController()
    const waiting = Promise.withResolvers<void>()
    const target = stage === "application" ? "/azure" : "/provision"
    const address =
      stage === "application"
        ? "azurerm_storage_blob.release_lock"
        : "azurerm_container_app_job.provision"
    const details =
      stage === "application"
        ? `Error: checking Blob: unexpected status 403 (not authorized to perform this operation using this permission)
  with ${address},
  on storage.tf line 1:`
        : `Error: unable to pull image using Managed identity
  with ${address},
  on job.tf line 1:`
    const error = new CommandExecutionError("Synthetic apply failure", false, 1, details)
    let attempts = 0
    let failedAt = -1
    let succeededAt = -1
    const cleanupPlans = new Map<string, boolean>()
    s.ui.confirm = vi.fn(async () => true)
    s.ui.notice = vi.fn((level) => {
      if (level === "info") waiting.resolve()
    })
    s.ui.select = vi.fn(async () => {
      throw new Error("An eligible automatic retry must not need manual recovery")
    })
    const run: RunCommand = async (executable, args, options) => {
      const result = await s.run(executable, args, options)
      expect(options?.signal).toBe(controller.signal)
      if (executable !== "terraform") return result
      if (args[1] === "plan") {
        cleanupPlans.set(args[0]!, args.includes("-destroy"))
        await writeFile(args.find((arg) => arg.startsWith("-out="))!.slice(5), "synthetic plan")
      }
      if (!args[0]!.endsWith(target)) return result
      const cleanup = cleanupPlans.get(args[0]!)
      if (args[1] === "show")
        return JSON.stringify({
          variables: { image: { value: s.image } },
          configuration: { root_module: { resources: [{ address }] } },
          resource_changes: [{ address, change: { actions: [cleanup ? "delete" : "create"] } }],
        })
      if (args[1] === "apply" && !cleanup) {
        attempts++
        if (attempts === 1) {
          failedAt = s.events.length - 1
          throw error
        }
        succeededAt = s.events.length - 1
      }
      return result
    }
    const installing = installAzure(s.config, { ...s, run, signal: controller.signal })

    await Promise.race([waiting.promise, installing])
    const paused = s.events.map(({ command }) => command)
    expect(paused.filter((command) => command[0] === "docker")).toHaveLength(1)
    expect(paused.some((command) => command[0] === process.execPath)).toBe(false)
    expect(
      paused.some((command) => command.slice(0, 4).join(" ") === "az containerapp job start"),
    ).toBe(false)
    expect(
      paused.some((command) => command.slice(0, 5).join(" ") === "az storage blob lease release"),
    ).toBe(false)
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(15_000)
    const result = await installing
    expect(result).toEqual(s.expectedResult())

    expect(s.ui.confirm).toHaveBeenCalledOnce()
    expect(s.ui.select).not.toHaveBeenCalled()
    const commands = s.events.map(({ command }) => command)
    expect(
      commands.slice(failedAt + 1, succeededAt + 1).map((command) => command[2]),
    ).toEqual(["plan", "show", "apply"])
    expect(commands.filter((command) => command[0] === "docker")).toHaveLength(1)
    expect(
      commands.filter((command) =>
        command[0] === "terraform" && command[1]!.endsWith("/foundation") && command[2] === "apply",
      ),
    ).toHaveLength(1)
    const jobs = commands.filter(
      (command) => command.slice(0, 4).join(" ") === "az containerapp job start",
    )
    expect(jobs).toHaveLength(1)
    expect(commands.indexOf(jobs[0]!)).toBeGreaterThan(succeededAt)
    const release = commands.filter((command) => command[0] === process.execPath)
    expect(release).toHaveLength(1)
    expect(release[0]).toContain(s.image)
    const secretWrites = commands.filter(
      (command) => command.slice(0, 4).join(" ") === "az keyvault secret set",
    )
    const secrets = secretWrites.map((command) => command[command.indexOf("--name") + 1])
    expect(new Set(secrets).size).toBe(secrets.length)
    const leases = commands.filter(
      (command) => command.slice(0, 5).join(" ") === "az storage blob lease acquire",
    )
    expect(leases).toHaveLength(2)
    expect(
      new Set(leases.map((command) => command[command.indexOf("--blob-name") + 1])).size,
    ).toBe(2)
    expect(
      commands.some((command) => command.slice(0, 5).join(" ") === "az storage blob lease break"),
    ).toBe(false)
    expect(s.secretValues.get("database-provisioned")).toBe(s.config.azure.resourceGroup)
  },
)

it("cancels the installation retry cooldown without starting database work or releasing its lease", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
  const s = await scenario()
  const controller = new AbortController()
  const waiting = Promise.withResolvers<void>()
  s.ui.notice = vi.fn((level) => {
    if (level === "info") waiting.resolve()
  })
  s.ui.select = vi.fn(async () => "exit")
  const run: RunCommand = async (executable, args, options) => {
    const result = await s.run(executable, args, options)
    if (executable !== "terraform" || !args[0]!.endsWith("/azure")) return result
    if (args[1] === "show")
      return JSON.stringify({
        variables: { image: { value: s.image } },
        configuration: { root_module: { resources: [] } },
        resource_changes: [
          { address: "azurerm_storage_blob.release_lock", change: { actions: ["create"] } },
        ],
      })
    if (args[1] === "apply")
      throw new CommandExecutionError(
        "Synthetic apply failure", false, 1,
        "Error: unexpected status 403 (not authorized)\n  with azurerm_storage_blob.release_lock,",
      )
    return result
  }
  const installing = installAzure(s.config, { ...s, run, signal: controller.signal }).catch(
    (failure: unknown) => failure,
  )

  await Promise.race([waiting.promise, installing])
  expect(vi.getTimerCount()).toBe(1)
  const commandsAtCancellation = s.events.length
  controller.abort()
  await vi.advanceTimersByTimeAsync(15_000)

  expect(await installing).toMatchObject({ name: "AbortError" })
  expect(s.events).toHaveLength(commandsAtCancellation)
  expect(s.ui.select).not.toHaveBeenCalled()
  expect(
    s.events.some(({ command }) =>
      command.slice(0, 5).join(" ") === "az storage blob lease release" ||
      command.slice(0, 4).join(" ") === "az containerapp job start" ||
      command[0] === process.execPath,
    ),
  ).toBe(false)
  expect(s.released()).toBe(false)
  const workspace = installationWorkspace(s.config, s.directory)
  expect(await readdir(join(workspace, "terraform", "app"))).toEqual([])
  expect(await readdir(s.directory)).toEqual([workspace.slice(s.directory.length + 1)])
})

it("replans a failed application step under the same lease without replaying earlier or downstream work", async () => {
  const s = await scenario()
  const failure = new CommandExecutionError(
    "Synthetic release-lock Blob authorization failure",
    false,
    1,
  )
  const approvals: number[] = []
  let attempts = 0
  let failedAt = -1
  let succeededAt = -1
  s.ui.confirm = vi.fn(async () => {
    const command = s.events.at(-1)?.command
    if (command?.[0] === "terraform" && command[1]!.endsWith("/azure") && command[2] === "show")
      approvals.push(s.events.length)
    return true
  })
  const run: RunCommand = async (executable, args, options) => {
    const result = await s.run(executable, args, options)
    if (executable !== "terraform" || !args[0]!.endsWith("/azure")) return result
    if (args[1] === "show")
      return JSON.stringify({
        variables: { image: { value: s.image } },
        configuration: { root_module: { resources: [] } },
        resource_changes: [
          { address: "azurerm_storage_blob.release_lock", change: { actions: ["create"] } },
        ],
      })
    if (args[1] === "apply") {
      expect(approvals).toHaveLength(attempts)
      attempts++
      if (attempts === 1) {
        failedAt = s.events.length - 1
        throw failure
      }
      succeededAt = s.events.length - 1
    }
    return result
  }
  s.ui.select = vi.fn<NonNullable<InstallerUI["select"]>>(async (_message, actions) => {
    expect(actions.map(({ value }) => value)).toContain("retry")
    expect(attempts).toBe(1)
    expect(s.events).toHaveLength(failedAt + 1)
    const commands = s.events.map(({ command }) => command)
    expect(
      commands.filter(
        (command) =>
          command.slice(0, 5).join(" ") === "az storage blob lease acquire" &&
          command.includes(`${s.config.name}/installer.lock`),
      ),
    ).toHaveLength(1)
    expect(
      commands.some(
        (command) =>
          command.slice(0, 5).join(" ") === "az storage blob lease release" ||
          command.slice(0, 5).join(" ") === "az storage blob lease break" ||
          (command[0] === "terraform" && command[1]!.endsWith("/provision")) ||
          command.slice(0, 4).join(" ") === "az containerapp job start" ||
          command[0] === process.execPath,
      ),
    ).toBe(false)
    return "retry"
  })

  await expect(installAzure(s.config, { ...s, run })).resolves.toEqual(
    expect.objectContaining({ url: "https://hub.example.com", image: s.image }),
  )

  expect(s.ui.select).toHaveBeenCalledOnce()
  expect(approvals).toHaveLength(1)
  const commands = s.events.map(({ command }) => command)
  const retry = commands.slice(failedAt + 1, succeededAt + 1)
  expect(retry.map((command) => command.slice(0, 3))).toEqual([
    ["terraform", expect.stringMatching(/\/azure$/), "plan"],
    ["terraform", expect.stringMatching(/\/azure$/), "show"],
    ["terraform", expect.stringMatching(/\/azure$/), "apply"],
  ])
  const applicationPlans = commands.filter(
    (command) =>
      command[0] === "terraform" && command[1]!.endsWith("/azure") && command[2] === "plan",
  )
  expect(applicationPlans).toHaveLength(2)
  const plans = applicationPlans.map((command) =>
    command.find((argument) => argument.startsWith("-out="))!.slice(5),
  )
  expect(plans[0]).not.toBe(plans[1])
  expect(retry[1]!.at(-1)).toBe(plans[1])
  expect(retry[2]!.at(-1)).toBe(plans[1])
  expect(approvals[0]).toBe(succeededAt)
  expect(
    commands.filter(
      (command) =>
        command[0] === "terraform" && command[1]!.endsWith("/foundation") && command[2] === "apply",
    ),
  ).toHaveLength(1)
  expect(commands.filter((command) => command[0] === "docker")).toHaveLength(1)
  const secretWrites = commands.filter(
    (command) => command.slice(0, 4).join(" ") === "az keyvault secret set",
  )
  expect(secretWrites.length).toBeGreaterThan(0)
  const secretNames = secretWrites.map((command) => command[command.indexOf("--name") + 1])
  expect(new Set(secretNames).size).toBe(secretNames.length)
  const jobs = commands
    .map((command, index) =>
      command.slice(0, 4).join(" ") === "az containerapp job start" ? index : -1,
    )
    .filter((index) => index >= 0)
  const releases = commands
    .map((command, index) => (command[0] === process.execPath ? index : -1))
    .filter((index) => index >= 0)
  expect(jobs).toHaveLength(1)
  expect(releases).toHaveLength(1)
  const cleanup = commands.findIndex(
    (command) =>
      command[0] === "terraform" &&
      command[1]!.endsWith("/provision") &&
      command.includes("-destroy"),
  )
  expect(jobs[0]).toBeGreaterThan(succeededAt)
  expect(cleanup).toBeGreaterThan(jobs[0]!)
  expect(releases[0]).toBeGreaterThan(cleanup)
  const installationLeases = commands.filter(
    (command) =>
      command.slice(0, 4).join(" ") === "az storage blob lease" &&
      command.includes(`${s.config.name}/installer.lock`),
  )
  expect(installationLeases.map((command) => command[4])).toEqual(["acquire", "release"])
  expect(commands.indexOf(installationLeases[1]!)).toBeGreaterThan(releases[0]!)
  expect(installationLeases[1]).toContain("--lease-id")
  expect(s.secretValues.get("database-provisioned")).toBe(s.config.azure.resourceGroup)
})

it("propagates cancellation from ACR image recovery without downstream work or releasing the installation lease", async () => {
  const s = await scenario()
  const cancelled = new DOMException("Cancelled from image recovery", "AbortError")
  const run: RunCommand = async (executable, args, options) => {
    const result = await s.run(executable, args, options)
    if (executable === "az" && args[0] === "acr" && args[1] === "login")
      throw new CommandExecutionError("ACR login is not ready", false, 1)
    return result
  }
  s.ui.select = vi.fn<NonNullable<InstallerUI["select"]>>(async (_message, options) => {
    expect(options.map(({ value }) => value)).toEqual(expect.arrayContaining(["retry", "exit"]))
    throw cancelled
  })

  await expect(installAzure(s.config, { ...s, run })).rejects.toBe(cancelled)

  expect(s.ui.select).toHaveBeenCalledTimes(1)
  expect(s.ui.wait).not.toHaveBeenCalled()
  const commands = s.events.map(({ command }) => command)
  expect(
    commands.filter((command) => command.slice(0, 3).join(" ") === "az acr login"),
  ).toHaveLength(1)
  expect(
    commands.some(
      (command) =>
        command[0] === "docker" ||
        command[0] === process.execPath ||
        command.slice(0, 4).join(" ") === "az containerapp job start" ||
        command.slice(0, 5).join(" ") === "az storage blob lease release" ||
        command.slice(0, 5).join(" ") === "az storage blob lease break",
    ),
  ).toBe(false)
  expect(s.messages).toContainEqual(expect.stringContaining("installer.lock"))
})

it("requires separate lock-recovery consent after deployment approval when database provisioning is already complete", async () => {
  const s = await scenario({ existing: true, retainedRelease: true })
  const approvals: number[] = []
  s.ui.confirm = vi.fn(async () => {
    approvals.push(s.events.length)
    return true
  })
  s.ui.select = vi.fn(async (_message: string, options: { label: string; value: string }[]) => {
    expect(options.map(({ value }) => value)).toContain("recover")
    return "recover"
  })

  await expect(installAzure(s.config, s)).resolves.toEqual(
    expect.objectContaining({ url: "https://hub.example.com", image: s.image }),
  )

  const commands = s.events.map(({ command }) => command)
  const inspectRelease = commands.findIndex(
    (command) =>
      command.slice(0, 4).join(" ") === "az storage blob show" &&
      command[command.indexOf("--name") + 1] === "deployment.lock",
  )
  const breakRelease = commands.findIndex(
    (command) => command.slice(0, 5).join(" ") === "az storage blob lease break",
  )
  const release = commands.findIndex((command) => command[0] === process.execPath)
  expect(s.ui.confirm).toHaveBeenCalledTimes(2)
  expect(vi.mocked(s.ui.confirm).mock.calls[1]![0]).toContain("artifactstore/releases/deployment.lock")
  expect(inspectRelease).toBeGreaterThanOrEqual(approvals[0]!)
  expect(approvals[1]).toBeGreaterThan(inspectRelease)
  expect(breakRelease).toBeGreaterThan(inspectRelease)
  expect(breakRelease).toBeGreaterThanOrEqual(approvals[1]!)
  expect(release).toBeGreaterThan(breakRelease)
  expect(
    commands.filter((command) => command.slice(0, 5).join(" ") === "az storage blob lease break"),
  ).toHaveLength(1)
  expect(commands.filter((command) => command[0] === process.execPath)).toHaveLength(1)
  expect(
    commands.some((command) => command.slice(0, 4).join(" ") === "az containerapp job start"),
  ).toBe(false)
})

it("retains installation exclusion and does not report a ready app when release fails", async () => {
  const s = await scenario({ releaseFails: true })
  await expect(installAzure(s.config, s)).rejects.toThrow("Release failed")
  expect(s.messages).toContainEqual(expect.stringContaining("installer.lock"))
  const releases = s.events.filter(
    ({ command }) => command.slice(0, 5).join(" ") === "az storage blob lease release",
  )
  expect(releases).toHaveLength(1)
  expect(releases[0]!.command).toContain("deployment.lock")
  expect(s.events.filter(({ command }) => command[0] === process.execPath)).toHaveLength(1)
  expect(
    s.events.filter(({ command }) => command.slice(0, 4).join(" ") === "az containerapp job start"),
  ).toHaveLength(1)
  expect(s.ui.wait).not.toHaveBeenCalled()
})

it("keeps a retained release lock when initial deployment approval is accepted but recovery consent is declined", async () => {
  const s = await scenario({ existing: true, retainedRelease: true })
  s.ui.confirm = vi
    .fn<InstallerUI["confirm"]>()
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce(false)
  s.ui.select = vi.fn().mockResolvedValueOnce("recover").mockResolvedValue("exit")

  await expect(installAzure(s.config, s)).rejects.toThrow()

  expect(s.ui.confirm).toHaveBeenCalledTimes(2)
  expect(s.released()).toBe(false)
  expect(s.messages).toContainEqual(expect.stringContaining("installer.lock"))
  expect(
    s.events.some(
      ({ command }) =>
        command[0] === process.execPath ||
        command.slice(0, 5).join(" ") === "az storage blob lease break" ||
        command.slice(0, 5).join(" ") === "az storage blob lease release",
    ),
  ).toBe(false)
})

it("retains the installation lease when final resource metadata is invalid after a successful release", async () => {
  const s = await scenario({ existing: true })
  const run: RunCommand = async (executable, args, options) => {
    const result = await s.run(executable, args, options)
    if (
      s.released() &&
      executable === "terraform" &&
      args[0]!.endsWith("/azure") &&
      args[1] === "output"
    )
      return JSON.stringify({ ...s.installation, app_id: null })
    return result
  }

  await expect(installAzure(s.config, { ...s, run })).rejects.toThrow()

  expect(s.released()).toBe(true)
  expect(s.messages).toContainEqual(expect.stringContaining("installer.lock"))
  expect(
    s.events.some(
      ({ command }) =>
        command.slice(0, 5).join(" ") === "az storage blob lease release" &&
        command.includes(`${s.config.name}/installer.lock`),
    ),
  ).toBe(false)
})

it("does not return a deployment receipt when releasing the installation lease fails", async () => {
  const s = await scenario({ existing: true })
  const failure = new CommandExecutionError("Synthetic installer lease release failure")
  const run: RunCommand = async (executable, args, options) => {
    const result = await s.run(executable, args, options)
    if (
      executable === "az" &&
      args.slice(0, 4).join(" ") === "storage blob lease release" &&
      args.includes(`${s.config.name}/installer.lock`)
    )
      throw failure
    return result
  }

  await expect(installAzure(s.config, { ...s, run })).rejects.toBe(failure)

  expect(s.released()).toBe(true)
  expect(s.messages).toContainEqual(expect.stringContaining("installer.lock"))
  expect(
    s.events.filter(
      ({ command }) =>
        command.slice(0, 5).join(" ") === "az storage blob lease release" &&
        command.includes(`${s.config.name}/installer.lock`),
    ),
  ).toHaveLength(1)
})

it("refuses to rerun ambiguous prior provisioning and retains the release lease", async () => {
  const s = await scenario({ priorProvisioning: true })
  await expect(installAzure(s.config, s)).rejects.toThrow("prior executions")
  expect(s.released()).toBe(false)
  expect(s.messages).toContainEqual(expect.stringContaining("deployment.lock"))
  expect(
    s.events.some(({ command }) => command.slice(0, 4).join(" ") === "az containerapp job start"),
  ).toBe(false)
})

it("propagates a failed provisioning mutation instead of waiting and starting it again", async () => {
  const s = await scenario({ provisioningFails: true })

  await expect(installAzure(s.config, s)).rejects.toThrow("Provisioning start failed")

  expect(
    s.events.filter(({ command }) => command.slice(0, 4).join(" ") === "az containerapp job start"),
  ).toHaveLength(1)
  expect(s.ui.wait).not.toHaveBeenCalled()
  expect(s.released()).toBe(false)
  expect(s.messages).toContainEqual(expect.stringContaining("deployment.lock"))
})
