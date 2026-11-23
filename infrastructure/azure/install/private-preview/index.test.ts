import { randomUUID } from "node:crypto"
import { mkdir, readFile, rm } from "node:fs/promises"
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
const addresses = [group, environment, identity, app, storage, imagePull, artifactsRead]

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

async function fixture({
  existing,
  tracked,
  hasIngress = false,
  foreignReleaseLease = false,
  hubChangesDuring,
  readerImageDrift,
  olderReaderImage = false,
  recreatedPullGrant = false,
  planAction,
}: {
  existing: string[]
  tracked?: string[]
  hasIngress?: boolean
  foreignReleaseLease?: boolean
  hubChangesDuring?: "approval" | "plan"
  readerImageDrift?: "template" | "active revision"
  olderReaderImage?: boolean
  recreatedPullGrant?: boolean
  planAction?: { address: string; action: "create" | "no-op" }
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
  const principalId = "00000000-0000-0000-0000-000000000003"
  const pullGrantId = `${registryId}/providers/Microsoft.Authorization/roleAssignments/00000000-0000-0000-0000-000000000004`
  const readGrantId = `${containerId}/providers/Microsoft.Authorization/roleAssignments/00000000-0000-0000-0000-000000000005`
  const newPullGrantId = `${registryId}/providers/Microsoft.Authorization/roleAssignments/00000000-0000-0000-0000-000000000006`
  const ids = new Map([
    [group, previewGroupId], [environment, environmentId], [identity, identityId], [app, appId],
    [storage, containerId], [imagePull, pullGrantId], [artifactsRead, readGrantId],
  ])
  const installerLease = `${names.stateAccount}/terraform/${config.name}/installer.lock`
  const releaseLease = "testhubhub/releases/deployment.lock"
  const held = new Map<string, string>()
  const image = (digestCharacter: string) =>
    `${registryServer}/replica-hub@sha256:${digestCharacter.repeat(64)}`
  const hubImage = image("a")
  let hubRevision = { name: "test-hub-hub--original", active: true, health: "Healthy", image: hubImage }
  const moveHub = () => {
    hubRevision = {
      ...hubRevision,
      name: "test-hub-hub--rollout",
      image: hubChangesDuring === "plan" ? image("b") : hubImage,
    }
  }
  const originalReaderImage = olderReaderImage ? image("c") : hubImage
  let savedReaderImage = originalReaderImage
  const readerRevision = "test-hub-preview--disabled"
  const tags = {
    application: "replica-hub",
    installation: config.name,
    owner: config.owner,
    managed_by: "terraform",
  }
  const live = new Set(existing)
  let state = tracked
  const applied: string[] = []
  let planFile: string | undefined
  let plannedImage: string | undefined
  const ui: InstallerUI = {
    status: vi.fn(),
    confirm: vi.fn(async () => {
      if (hubChangesDuring === "approval") moveHub()
      return true
    }),
    select: vi.fn(async () => { throw new Error("Preview staging attempted lock recovery") }),
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
          if (args[2] === "list" && state) return state.join("\n")
          break
        case "plan": {
          planFile = args.find((arg) => arg.startsWith("-out="))?.slice(5)
          const inputs = args.find((arg) => arg.startsWith("-var-file="))!.slice(10)
          plannedImage = JSON.parse(await readFile(inputs, "utf8")).image
          return ""
        }
        case "show":
          if (args[2] === "-json" && args.length === 3 && state) {
            return JSON.stringify({
              format_version: "1.0",
              ...(state.length > 0 && { values: { root_module: { resources: state.map((address) => ({
                address,
                values: {
                  id: ids.get(address),
                  ...(address === app && { template: [{ container: [{ image: savedReaderImage }] }] }),
                },
              })) } } }),
            })
          }
          expect(planFile).toBeDefined()
          expect(args.at(-1)).toBe(planFile)
          if (hubChangesDuring === "plan") moveHub()
          return JSON.stringify({
            resource_changes: addresses.map((address) => ({
              address,
              change: {
                actions: [planAction?.address === address
                  ? planAction.action : state?.includes(address) ? "no-op" : "create"],
              },
            })),
          })
        case "apply":
          expect(planFile).toBeDefined()
          expect(args.at(-1)).toBe(planFile)
          applied.push(args.at(-1)!)
          expect([...held.keys()].sort()).toEqual([installerLease, releaseLease].sort())
          expect(plannedImage).toBe(state?.includes(app) ? originalReaderImage : hubImage)
          for (const address of addresses) live.add(address)
          state = [...addresses]
          savedReaderImage = plannedImage!
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
        case "storage blob show":
        case "storage blob lease acquire":
        case "storage blob lease renew":
        case "storage blob lease release": {
          const operation = args[3]
          const key = `${flag("--account-name")}/${flag("--container-name")}/${flag("--blob-name") ?? flag("--name")}`
          expect([installerLease, releaseLease]).toContain(key)
          const foreign = key === releaseLease && foreignReleaseLease
          if (args[2] === "show") {
            return JSON.stringify(foreign || held.has(key)
              ? { status: "locked", state: "leased", duration: "infinite" }
              : { status: "unlocked", state: "available", duration: null })
          }
          if (operation === "acquire") {
            if (foreign || held.has(key)) throw new Error("Fixture lease is already locked")
            const proposed = flag("--proposed-lease-id")!
            held.set(key, proposed)
            return JSON.stringify(proposed)
          }
          expect(held.get(key)).toBe(flag("--lease-id"))
          if (operation === "release") held.delete(key)
          return JSON.stringify(flag("--lease-id"))
        }
        case "storage blob exists":
          expect(flag("--name")).toBe("test-hub/private-preview.tfstate")
          return JSON.stringify({ exists: state !== undefined })
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
          return JSON.stringify({ tags, principalId })
        case "role assignment list":
          return JSON.stringify([
            ...(live.has(imagePull)
              ? [{
                  id: recreatedPullGrant ? newPullGrantId : pullGrantId,
                  scope: registryId,
                  roleDefinitionName: "AcrPull",
                  principalId,
                }]
              : []),
            ...(live.has(artifactsRead)
              ? [{ id: readGrantId, scope: containerId, roleDefinitionName: "Storage Blob Data Reader", principalId }]
              : []),
          ])
        case "containerapp show":
          return JSON.stringify(flag("--name") === "test-hub-hub" ? {
            id: `${hubProvider}/Microsoft.App/containerApps/test-hub-hub`,
            provisioningState: "Succeeded",
            latestReadyRevisionName: hubRevision.name,
            traffic: [{ weight: 100, latestRevision: true }],
            image: image("c"),
          } : {
            id: appId,
            tags, environmentId, identityType: "UserAssigned", identityIds: [identityId],
            ingress: hasIngress ? { external: true } : null,
            secretNames: [],
            containers: [{
              command: ["node", "-e", "require('node:net').createServer(socket => socket.destroy()).listen(3002, '0.0.0.0')"],
              image: readerImageDrift === "template" ? image("b") : savedReaderImage,
              args: [],
              envNames: [],
            }],
            status: "Succeeded", running: "Running", latest: readerRevision, ready: readerRevision,
          })
        case "containerapp revision list": {
          if (flag("--name") === "test-hub-hub") return JSON.stringify([hubRevision])
          expect(flag("--name")).toBe("test-hub-preview")
          return JSON.stringify([{
            name: readerRevision,
            active: true,
            health: "Healthy",
            image: readerImageDrift === "active revision" ? image("b") : savedReaderImage,
          }])
        }
      }
    }
    throw new Error(`Unexpected command ${executable} ${args.join(" ")}`)
  })

  return { stage: () => installAzurePrivatePreview(config, { directory, run, ui }), run, applied, ui }
}

it.each([undefined, []])("stages the disabled reader with no tracked resources (state: %j)", async (tracked) => {
  const test = await fixture({ existing: [], tracked })

  await expect(test.stage()).resolves.toBeUndefined()

  expect(test.applied).toHaveLength(1)
})

it("keeps the original disabled reader image after Hub publishes a new image", async () => {
  const tracked = [group, environment, identity, app, storage, imagePull, artifactsRead]
  const test = await fixture({ existing: tracked, tracked, olderReaderImage: true })

  await expect(test.stage()).resolves.toBeUndefined()
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

it("refuses a foreign release lease without trying recovery or applying", async () => {
  const test = await fixture({ existing: [], foreignReleaseLease: true })

  await expect(test.stage()).rejects.toThrow(/lock|lease/i)

  expect(test.ui.select).not.toHaveBeenCalled()
  expect(test.applied).toEqual([])
  expect(test.run.mock.calls.some(([, args]) =>
    args.includes("break") || args.includes("stop") || args.includes("deactivate"),
  )).toBe(false)
})

it.each(["approval", "plan"] as const)("blocks staging if Hub rolls forward during %s", async (hubChangesDuring) => {
  const test = await fixture({ existing: [], hubChangesDuring })

  await expect(test.stage()).rejects.toThrow(/Hub.*(changed|revision|image)/i)

  expect(test.applied).toEqual([])
})

it.each(["template", "active revision"] as const)(
  "rejects a wrong image digest in the reader %s despite the expected placeholder command",
  async (readerImageDrift) => {
    const test = await fixture({ existing: addresses, tracked: addresses, readerImageDrift })

    await expect(test.stage()).rejects.toThrow(/reader.*(image|state)|state.*disagree/i)

    expect(test.applied).toEqual([])
  },
)

it("rejects a recreated role assignment even when its principal, role and scope match", async () => {
  const tracked = [group, identity, imagePull]
  const test = await fixture({ existing: tracked, tracked, recreatedPullGrant: true })

  await expect(test.stage()).rejects.toThrow(/state.*disagree|role assignment.*(differ|match)/i)

  expect(test.applied).toEqual([])
})

it.each([
  { action: "create", address: group },
  { action: "no-op", address: environment },
] as const)("rejects an otherwise allowed $action that contradicts reconciled state", async (planAction) => {
  const tracked = [group]
  const test = await fixture({ existing: tracked, tracked, planAction })

  await expect(test.stage()).rejects.toThrow(/plan.*(blocked|state|reconcil)/i)

  expect(test.applied).toEqual([])
})
