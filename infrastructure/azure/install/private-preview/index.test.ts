import { randomUUID } from "node:crypto"
import { mkdir, rm } from "node:fs/promises"
import { resolve } from "node:path"
import { afterEach, expect, it, vi } from "vitest"

import type { DeploymentConfig, InstallerUI, RunCommand } from "../../../installer/types.ts"
import { installationNames } from "../settings.ts"
import { installAzurePrivatePreview } from "./index.ts"

const directories: string[] = []
const group = "azurerm_resource_group.reader"
const environment = "azurerm_container_app_environment.reader"
const identity = "azurerm_user_assigned_identity.reader"
const app = "azurerm_container_app.reader"
const storage = "azurerm_storage_container.reader"
const imagePull = "azurerm_role_assignment.image_pull"
const artifactsRead = "azurerm_role_assignment.reader_artifacts"

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

async function fixture({
  existing,
  tracked,
  hasIngress = false,
}: {
  existing: string[]
  tracked?: string[]
  hasIngress?: boolean
}) {
  const directory = resolve(`.installer-preview-test-${randomUUID()}`)
  directories.push(directory)
  await mkdir(directory, { mode: 0o700 })
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
  const names = installationNames(config)
  const subscription = `/subscriptions/${config.azure.subscriptionId}`
  const hubProvider = `${subscription}/resourceGroups/${config.azure.resourceGroup}/providers`
  const previewGroup = `${config.name}-preview`
  const previewGroupId = `${subscription}/resourceGroups/${previewGroup}`
  const previewProvider = `${previewGroupId}/providers`
  const registryServer = `${names.registry}.azurecr.io`
  const registryId = `${subscription}/resourceGroups/${names.foundationGroup}/providers/Microsoft.ContainerRegistry/registries/${names.registry}`
  const storageId = `${hubProvider}/Microsoft.Storage/storageAccounts/testhubhub`
  const containerId = `${storageId}/blobServices/default/containers/private-preview-artifacts`
  const environmentId = `${previewProvider}/Microsoft.App/managedEnvironments/test-hub-preview-environment`
  const identityId = `${previewProvider}/Microsoft.ManagedIdentity/userAssignedIdentities/test-hub-preview`
  const appId = `${previewProvider}/Microsoft.App/containerApps/test-hub-preview`
  const tags = {
    application: "replica-hub",
    installation: config.name,
    owner: config.owner,
    managed_by: "terraform",
  }
  const live = new Set(existing)
  const addresses = [group, environment, identity, app, storage, imagePull, artifactsRead]
  const applied: string[] = []
  let planFile: string | undefined
  const ui: InstallerUI = {
    status: vi.fn(),
    confirm: vi.fn(async () => true),
    wait: async (message) => { throw new Error(message) },
  }

  const run = vi.fn<RunCommand>(async (executable, args) => {
    const flag = (name: string) => {
      const index = args.indexOf(name)
      return index < 0 ? undefined : args[index + 1]
    }
    if (executable === "terraform") {
      switch (args[1]) {
        case "init": return ""
        case "state":
          if (args[2] === "list" && tracked) return tracked.join("\n")
          break
        case "plan":
          planFile = args.find((arg) => arg.startsWith("-out="))?.slice(5)
          return ""
        case "show":
          expect(planFile).toBeDefined()
          expect(args.at(-1)).toBe(planFile)
          return JSON.stringify({
            resource_changes: addresses.map((address) => ({
              address,
              change: { actions: [tracked?.includes(address) ? "no-op" : "create"] },
            })),
          })
        case "apply":
          expect(planFile).toBeDefined()
          expect(args.at(-1)).toBe(planFile)
          applied.push(args.at(-1)!)
          for (const address of addresses) live.add(address)
          return ""
      }
    }
    if (executable === "az") {
      const privateStorage = { allowSharedKeyAccess: false, allowBlobPublicAccess: false }
      switch (args.slice(0, args.findIndex((arg) => arg.startsWith("--"))).join(" ")) {
        case "account show":
          return JSON.stringify({ id: config.azure.subscriptionId, tenantId: config.azure.tenantId })
        case "group exists":
          return JSON.stringify(flag("--name") !== previewGroup || live.has(group))
        case "group show":
          return JSON.stringify({ id: `${subscription}/resourceGroups/${flag("--name")}`, tags })
        case "storage account show":
          return JSON.stringify(flag("--ids") === storageId ? { id: storageId, ...privateStorage } : {
            id: `${subscription}/resourceGroups/${names.stateGroup}/providers/Microsoft.Storage/storageAccounts/${names.stateAccount}`,
            tags: { ...tags, managed_by: "replica-installer" },
            ...privateStorage,
          })
        case "acr show": return JSON.stringify({ id: registryId, loginServer: registryServer })
        case "storage blob lease acquire": return JSON.stringify(flag("--proposed-lease-id"))
        case "storage blob lease release": return ""
        case "storage blob exists":
          expect(flag("--name")).toBe("test-hub/private-preview.tfstate")
          return JSON.stringify({ exists: tracked !== undefined })
        case "resource list":
          expect(flag("--resource-group")).toBe(previewGroup)
          return JSON.stringify([
            ...(live.has(environment) ? [{ id: environmentId }] : []),
            ...(live.has(identity) ? [{ id: identityId }] : []),
            ...(live.has(app) ? [{ id: appId }] : []),
          ])
        case "storage container-rm list":
          return JSON.stringify(live.has(storage) ? [{ id: containerId, publicAccess: null }] : [])
        case "storage blob list": return "[]"
        case "containerapp env show": return JSON.stringify({ tags, subnetId: null })
        case "identity show":
          return JSON.stringify({ tags, principalId: "00000000-0000-0000-0000-000000000003" })
        case "role assignment list":
          return JSON.stringify([
            ...(live.has(imagePull)
              ? [{ id: "/test/pull", scope: registryId, roleDefinitionName: "AcrPull" }]
              : []),
            ...(live.has(artifactsRead)
              ? [{ id: "/test/read", scope: containerId, roleDefinitionName: "Storage Blob Data Reader" }]
              : []),
          ])
        case "containerapp show":
          return JSON.stringify(flag("--name") === "test-hub-hub" ? {
            id: `${hubProvider}/Microsoft.App/containerApps/test-hub-hub`,
            provisioningState: "Succeeded",
            image: `${registryServer}/replica-hub@sha256:${"a".repeat(64)}`,
          } : {
            tags, environmentId, identityType: "UserAssigned", identityIds: [identityId],
            ingress: hasIngress ? { external: true } : null,
            secretNames: [],
            containers: [{
              command: ["node", "-e", "require('node:net').createServer(socket => socket.destroy()).listen(3002, '0.0.0.0')"],
              args: [],
              envNames: [],
            }],
            status: "Succeeded", running: "Running", latest: "test-revision", ready: "test-revision",
          })
      }
    }
    throw new Error(`Unexpected command ${executable} ${args.join(" ")}`)
  })

  return { stage: () => installAzurePrivatePreview(config, { directory, run, ui }), run, applied }
}

it("stages the disabled reader on a pristine target without saved reader state", async () => {
  const test = await fixture({ existing: [] })

  await expect(test.stage()).resolves.toBeUndefined()

  expect(test.applied).toHaveLength(1)
})

it("does not adopt or recreate an existing preview group when the saved state is absent", async () => {
  const test = await fixture({ existing: [group] })

  await expect(test.stage()).rejects.toThrow(/state disagree/i)

  expect(test.applied).toEqual([])
  expect(test.run.mock.calls.some(([command, args]) =>
    command === "terraform" && args[1] === "import",
  )).toBe(false)
})

it("does not overwrite a tracked reader that has gained ingress", async () => {
  const tracked = [group, environment, identity, app, imagePull]
  const test = await fixture({ existing: tracked, tracked, hasIngress: true })

  await expect(test.stage()).rejects.toThrow(/no longer matches the disabled configuration/i)

  expect(test.applied).toEqual([])
})

it("applies the staging plan when partial reader resources match saved state", async () => {
  const tracked = [group, environment]
  const test = await fixture({ existing: tracked, tracked })

  await expect(test.stage()).resolves.toBeUndefined()

  expect(test.applied).toHaveLength(1)
})
