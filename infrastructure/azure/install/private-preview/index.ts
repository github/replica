import { join, resolve } from "node:path"

import type { DeploymentConfig, InstallerUI, RunCommand } from "../../../installer/types.ts"
import { writePrivateFile } from "../../../installer/private-files/index.ts"
import { terraformModule } from "../../../terraform/index.ts"
import { writeBackendFile } from "../backend/index.ts"
import { verifyInstallationGroup } from "../group/index.ts"
import { acquireLease } from "../lease/index.ts"
import { verifyAzureTarget } from "../preflight/index.ts"
import { installationNames } from "../settings.ts"
import type { AzureInstallation } from "../types.ts"
import { openInstallationWorkspace } from "../workspace/index.ts"
import { privatePreviewResourceCount, validatePrivatePreviewPlan } from "./plan/index.ts"

const previewContainer = "private-preview-artifacts"
const imageDigest = /^[a-z0-9][a-z0-9.:/-]+@sha256:[a-f0-9]{64}$/
const disabledCommand = [
  "node",
  "-e",
  "require('node:net').createServer(socket => socket.destroy()).listen(3002, '0.0.0.0')",
]

export async function installAzurePrivatePreview(
  config: DeploymentConfig,
  {
    directory,
    run,
    ui,
    signal,
  }: { directory: string; run: RunCommand; ui: InstallerUI; signal?: AbortSignal },
) {
  signal?.throwIfAborted()
  await verifyAzureTarget(config, run)
  const workspace = await openInstallationWorkspace(config, directory)
  try {
    await prepareReader({
      config,
      directory: workspace.directory,
      run,
      ui,
      signal,
      env: {
        ARM_SUBSCRIPTION_ID: config.azure.subscriptionId,
        ARM_TENANT_ID: config.azure.tenantId,
        ARM_USE_CLI: "true",
        ARM_USE_OIDC: "false",
        ARM_CLIENT_ID: undefined,
        ARM_CLIENT_SECRET: undefined,
        ARM_CLIENT_CERTIFICATE_PATH: undefined,
        ARM_OIDC_TOKEN: undefined,
      },
      azure: (...args) =>
        run("az", [...args, "--subscription", config.azure.subscriptionId, "--only-show-errors", "--output", "json"], {
          signal,
        }),
    })
  } finally {
    await workspace.close()
  }
}

async function prepareReader(context: AzureInstallation) {
  const { config, directory, run, ui, azure, signal } = context
  const { resourceGroup, subscriptionId, location } = config.azure
  const names = installationNames(config)
  const appName = `${config.name}-preview`
  const readerGroup = appName
  const storageName = `${config.name.replaceAll("-", "")}hub`
  const groups = `/subscriptions/${subscriptionId}/resourceGroups`
  const providerId = `${groups}/${resourceGroup}/providers`
  const readerGroupId = `${groups}/${readerGroup}`
  const readerProviderId = `${readerGroupId}/providers`
  const storageId = `${providerId}/Microsoft.Storage/storageAccounts/${storageName}`
  const containerId = `${storageId}/blobServices/default/containers/${previewContainer}`
  const appId = `${readerProviderId}/Microsoft.App/containerApps/${appName}`
  const environmentId = `${readerProviderId}/Microsoft.App/managedEnvironments/${appName}-environment`
  const identityId = `${readerProviderId}/Microsoft.ManagedIdentity/userAssignedIdentities/${appName}`
  const foundationId = `${groups}/${names.foundationGroup}`
  const acrId = `${foundationId}/providers/Microsoft.ContainerRegistry/registries/${names.registry}`
  const stateId = `/subscriptions/${subscriptionId}/resourceGroups/${names.stateGroup}/providers/Microsoft.Storage/storageAccounts/${names.stateAccount}`
  const sameId = (actual: string | undefined, expected: string) =>
    actual?.toLowerCase() === expected.toLowerCase()
  const owned = (tags: Record<string, string> | undefined, manager = "terraform") =>
    tags?.application === "replica-hub" &&
    tags.installation === config.name &&
    tags.owner === config.owner &&
    tags.managed_by === manager
  const read = async <T>(...args: string[]) => JSON.parse(await azure(...args)) as T
  const block = (reason: string): never => {
    throw new Error(`Private preview preparation blocked: ${reason}`)
  }
  await ui.phase?.("review")
  ui.status("Checking the existing installation and private preview target.")
  if ([resourceGroup, names.foundationGroup, names.stateGroup].some(
    (group) => group.toLowerCase() === readerGroup.toLowerCase(),
  )) block("The reader resource group would overlap an existing installation group.")
  if (!(await verifyInstallationGroup(context, resourceGroup)) ||
      !(await verifyInstallationGroup(context, names.foundationGroup)))
    block("Create and verify Hub before preparing the reader.")
  const stateAccount = await read<{
    id: string
    tags: Record<string, string>
    allowSharedKeyAccess: boolean
    allowBlobPublicAccess: boolean
  }>("storage", "account", "show", "--ids", stateId)
  if (!sameId(stateAccount.id, stateId) || !owned(stateAccount.tags, "replica-installer") ||
      stateAccount.allowSharedKeyAccess !== false || stateAccount.allowBlobPublicAccess !== false)
    block("The existing state account is not owned by this installation or is not private.")
  const registry = await read<{ id: string; loginServer: string }>(
    "acr", "show", "--name", names.registry, "--resource-group", names.foundationGroup,
    "--query", "{id:id,loginServer:loginServer}",
  )
  const storage = await read<{ id: string; allowBlobPublicAccess: boolean; allowSharedKeyAccess: boolean }>(
    "storage", "account", "show", "--ids", storageId,
    "--query", "{id:id,allowBlobPublicAccess:allowBlobPublicAccess,allowSharedKeyAccess:allowSharedKeyAccess}",
  )
  const hub = await read<{ id: string; provisioningState: string; image: string }>(
    "containerapp", "show", "--name", `${config.name}-hub`, "--resource-group", resourceGroup,
    "--query", "{id:id,provisioningState:properties.provisioningState,image:properties.template.containers[?name=='hub'].image | [0]}",
  )
  if (!sameId(registry.id, acrId) || !sameId(storage.id, storageId) ||
      storage.allowBlobPublicAccess !== false || storage.allowSharedKeyAccess !== false ||
      !sameId(hub.id, `${providerId}/Microsoft.App/containerApps/${config.name}-hub`) ||
      hub.provisioningState !== "Succeeded" || !imageDigest.test(hub.image) ||
      !hub.image.startsWith(`${registry.loginServer}/`))
    block("The released Hub image, installation registry or private artifact account could not be verified.")

  if (!(await ui.confirm(
    "Prepare a disabled private preview reader? This can create billable Azure resources. It does not update Hub or enable previews.",
  ))) throw new Error("Private preview preparation was not approved. No cloud writes started.")
  await ui.phase?.("provision")
  const lock = await acquireLease(context, names.stateAccount, "terraform", `${config.name}/installer.lock`)
  let applyStarted = false
  try {
    const terraform = terraformModule({
      directory: resolve(import.meta.dirname, "../../private-preview"),
      dataDirectory: join(directory, "terraform", "private-preview"),
      run,
      ui,
      env: context.env,
      signal,
      preapproved: true,
      validatePlan: validatePrivatePreviewPlan,
      beforeApply: async () => {
        await reconcile()
        applyStarted = true
      },
    })
    const inspect = async (verifyReady = false) => {
      const entries = new Map<string, string>()
      const readerGroupExists = await verifyInstallationGroup(context, readerGroup)
      const list = readerGroupExists
        ? await read<{ id: string }[]>("resource", "list", "--resource-group", readerGroup, "--query", "[].{id:id}")
        : []
      if (readerGroupExists) entries.set("azurerm_resource_group.reader", readerGroupId)
      for (const [address, id] of [
        ["azurerm_container_app_environment.reader", environmentId],
        ["azurerm_user_assigned_identity.reader", identityId],
        ["azurerm_container_app.reader", appId],
      ] as const) {
        if (list.some((item) => sameId(item.id, id))) entries.set(address, id)
      }
      const containers = await read<{ id: string; publicAccess: string | null }[]>(
        "storage", "container-rm", "list", "--storage-account", storageId,
        "--query", "[].{id:id,publicAccess:publicAccess}",
      )
      const container = containers.find((item) => sameId(item.id, containerId))
      if (container) {
        entries.set("azurerm_storage_container.reader", containerId)
        const blobs = await read<unknown[]>(
          "storage", "blob", "list", "--account-name", storageName, "--container-name", previewContainer,
          "--auth-mode", "login", "--num-results", "1", "--query", "[].name",
        )
        if (!Array.isArray(blobs) || blobs.length || ![null, "None"].includes(container.publicAccess))
          block("The dedicated reader container is not confirmed private and empty. No blobs will be changed.")
      }
      if (entries.has("azurerm_container_app_environment.reader")) {
        const environment = await read<{ tags: Record<string, string>; subnetId: string | null }>(
          "containerapp", "env", "show", "--ids", environmentId,
          "--query", "{tags:tags,subnetId:properties.vnetConfiguration.infrastructureSubnetId}",
        )
        if (!owned(environment.tags) || environment.subnetId !== null)
          block("The reader environment is not owned by this installation or is attached to a network.")
      }
      if (entries.has("azurerm_user_assigned_identity.reader")) {
        const identity = await read<{ tags: Record<string, string>; principalId: string }>(
          "identity", "show", "--ids", identityId, "--query", "{tags:tags,principalId:principalId}",
        )
        if (!owned(identity.tags) || !identity.principalId) block("The reader identity could not be verified.")
        const roles = await read<{ id: string; scope: string; roleDefinitionName: string }[]>(
          "role", "assignment", "list", "--assignee-object-id", identity.principalId, "--all",
          "--fill-principal-name", "false", "--query", "[].{id:id,scope:scope,roleDefinitionName:roleDefinitionName}",
        )
        for (const role of roles) {
          const address = sameId(role.scope, acrId) && role.roleDefinitionName === "AcrPull"
            ? "azurerm_role_assignment.image_pull"
            : sameId(role.scope, containerId) && role.roleDefinitionName === "Storage Blob Data Reader"
              ? "azurerm_role_assignment.reader_artifacts"
              : block("The reader identity has an unexpected grant. Review access before retrying.")
          if (entries.has(address)) block("The reader identity has a duplicate grant.")
          entries.set(address, role.id)
        }
      }
      if (entries.has("azurerm_container_app.reader")) {
        const reader = await read<{
          tags: Record<string, string>
          environmentId?: string
          ingress: object | null
          secretNames: string[] | null
          identityType: string
          identityIds: string[]
          containers: { command: string[]; args: string[] | null; envNames: string[] | null }[]
          status: string
          running: string
          latest: string
          ready: string
        }>(
          "containerapp", "show", "--ids", appId, "--query",
          "{tags:tags,environmentId:properties.managedEnvironmentId || properties.environmentId,ingress:properties.configuration.ingress,secretNames:properties.configuration.secrets[].name,identityType:identity.type,identityIds:keys(identity.userAssignedIdentities),containers:properties.template.containers[].{command:command,args:args,envNames:env[].name},status:properties.provisioningState,running:properties.runningStatus,latest:properties.latestRevisionName,ready:properties.latestReadyRevisionName}",
        )
        const [container] = reader.containers
        if (!owned(reader.tags) || !sameId(reader.environmentId, environmentId) ||
            reader.ingress !== null || reader.secretNames?.length ||
            reader.identityType !== "UserAssigned" || reader.identityIds.length !== 1 ||
            !sameId(reader.identityIds[0], identityId) || reader.containers.length !== 1 ||
            JSON.stringify(container.command) !== JSON.stringify(disabledCommand) ||
            container.args?.length || container.envNames?.length)
          block("The reader app no longer matches the disabled configuration. It was not overwritten.")
        if (verifyReady && (reader.status !== "Succeeded" ||
            reader.running !== "Running" || !reader.ready || reader.ready !== reader.latest))
          block("Azure has not reported the disabled revision ready. Resume to recheck; previews remain disabled.")
      }
      return entries
    }
    const backend = await writeBackendFile(context, "private-preview")
    await terraform.init(backend)
    const reconcile = async () => {
      const stateBlob = await read<{ exists: boolean }>(
        "storage", "blob", "exists", "--account-name", names.stateAccount, "--container-name", "terraform",
        "--name", `${config.name}/private-preview.tfstate`, "--auth-mode", "login",
      )
      if (typeof stateBlob.exists !== "boolean") block("The saved reader state could not be verified.")
      const tracked = new Set(stateBlob.exists ? await terraform.state() : [])
      const live = await inspect()
      if (tracked.size !== live.size || [...tracked].some((address) => !live.has(address)))
        block("Azure and saved reader state disagree. Review existing resources and recover state explicitly; the pending plan was not applied.")
    }
    await reconcile()
    const variables = join(directory, "private-preview.tfvars.json")
    await writePrivateFile(variables, JSON.stringify({
      subscription_id: subscriptionId, resource_group_name: resourceGroup, location,
      name: config.name, owner: config.owner, acr_id: acrId, registry_server: registry.loginServer,
      storage_account_id: storageId, image: hub.image,
    }))
    await terraform.apply(variables)
    await ui.phase?.("verify")
    if ((await inspect(true)).size !== privatePreviewResourceCount)
      block("Azure did not report all disabled reader resources.")
    await lock.release()
  } catch (error) {
    if (!applyStarted && !signal?.aborted) await lock.release()
    throw error
  } finally {
    lock.reportRetained()
  }
}
