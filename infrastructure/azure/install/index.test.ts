import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { afterEach, expect, it, vi } from "vitest"

import { CommandExecutionError } from "../../installer/command/index.ts"
import type { DeploymentConfig, InstallerUI, RunCommand } from "../../installer/types.ts"
import { installAzure } from "./index.ts"

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function scenario({
  existing = false,
  releaseFails = false,
  priorProvisioning = false,
  provisioningFails = false,
  retainedRelease = false,
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
  let releaseLocked = retainedRelease
  const installation = {
    environment_id: `/subscriptions/${config.azure.subscriptionId}/resourceGroups/test-hub/providers/Microsoft.App/managedEnvironments/test`,
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
      await writeFile(
        args[args.indexOf("--metadata-file") + 1]!,
        JSON.stringify({
          "containerimage.digest": `sha256:${"a".repeat(64)}`,
        }),
      )
      return ""
    }
    if (executable === process.execPath) {
      if (releaseLocked) throw new CommandExecutionError("The previous release lease is retained")
      if (releaseFails) throw new CommandExecutionError("Release failed")
      released = true
      installation.url = "https://hub.example.com"
      return ""
    }
    if (executable !== "az") throw new Error(`Unexpected executable ${executable}`)
    const operation = args.slice(0, 3).join(" ")
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
    released: () => released,
  }
}

it("publishes through the chosen registry, provisions privately, removes temporary access, then invokes the guarded release", async () => {
  const s = await scenario()
  await expect(installAzure(s.config, s)).resolves.toBe("https://hub.example.com")
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

it("updates an installed app only through the release orchestrator and never reruns fresh role provisioning", async () => {
  const s = await scenario({ existing: true })
  await installAzure(s.config, s)
  expect(s.released()).toBe(true)
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

it("recovers a retained release lease after fresh maintenance approval even when database provisioning is already complete", async () => {
  const s = await scenario({ existing: true, retainedRelease: true })
  let maintenanceApprovedAt = -1
  const confirm = s.ui.confirm
  s.ui.confirm = vi.fn(async (message) => {
    const approved = await confirm(message)
    if (/maintenance.window/i.test(message)) maintenanceApprovedAt = s.events.length
    return approved
  })
  s.ui.select = vi.fn(async (_message: string, options: { label: string; value: string }[]) => {
    expect(options.map(({ value }) => value)).toContain("recover")
    return "recover"
  })

  await expect(installAzure(s.config, s)).resolves.toBe("https://hub.example.com")

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
  expect(maintenanceApprovedAt).toBeGreaterThan(-1)
  expect(inspectRelease).toBeGreaterThanOrEqual(maintenanceApprovedAt)
  expect(breakRelease).toBeGreaterThan(inspectRelease)
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
