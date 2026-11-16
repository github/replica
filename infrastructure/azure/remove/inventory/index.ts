import { installationNames } from "../../install/settings.ts"
import type { RemovalContext, RemovalResource } from "../types.ts"
import { verifyRemovalIdentity } from "../verify-identity/index.ts"

export async function removalInventory(
  context: Pick<RemovalContext, "config" | "azure">,
  resources: readonly RemovalResource[],
  groups: ReadonlyMap<string, readonly Record<string, unknown>[]>,
) {
  const { config } = context
  const known = new Map(resources.map((resource) => [resource.id.toLowerCase(), resource]))
  const names = installationNames(config)
  const ownedGroups = new Set(
    [config.azure.resourceGroup, names.foundationGroup, names.stateGroup].map((group) =>
      group.toLowerCase(),
    ),
  )
  const account = `${config.name.replaceAll("-", "")}hub`
  const accountId =
    `/subscriptions/${config.azure.subscriptionId}/resourceGroups/${config.azure.resourceGroup}/providers/Microsoft.Storage/storageAccounts/${account}`.toLowerCase()
  for (const resource of resources) {
    if (
      ["azurerm_storage_container", "azurerm_storage_blob"].includes(resource.type) &&
      !(groups.get(config.azure.resourceGroup) ?? []).some(
        ({ id }) =>
          typeof id === "string" &&
          (id.toLowerCase() === accountId || id.toLowerCase().startsWith(`${accountId}/`)),
      )
    )
      throw new Error("Removal cannot bind a storage data resource to its installation group.")
    if (resource.type === "azurerm_storage_container") {
      known.set(
        `/subscriptions/${config.azure.subscriptionId}/resourceGroups/${config.azure.resourceGroup}/providers/Microsoft.Storage/storageAccounts/${account}/blobServices/default/containers/${String(resource.values.name)}`.toLowerCase(),
        resource,
      )
    }
  }
  const untracked: { id: string; type: string; group: string }[] = []
  for (const [group, values] of groups) {
    if (!ownedGroups.has(group.toLowerCase()))
      throw new Error("Removal inventory refers to an unselected resource group.")
    const groupId =
      `/subscriptions/${config.azure.subscriptionId}/resourceGroups/${group}`.toLowerCase()
    for (const value of values) {
      if (typeof value.id !== "string" || typeof value.type !== "string")
        throw new Error("Removal inventory contains unknown resource identities.")
      const id = value.id.toLowerCase()
      if (!id.startsWith(`${groupId}/`))
        throw new Error("Removal inventory contains a resource outside its installation group.")
      if (group === names.stateGroup && id.endsWith(`/storageaccounts/${names.stateAccount}`))
        continue
      const resource = known.get(id)
      if (!resource) {
        if (
          resources.some(
            (tracked) =>
              tracked.type !== "azurerm_resource_group" &&
              id.startsWith(`${tracked.id.toLowerCase()}/`),
          )
        )
          throw new Error(
            `Untracked resource ${value.id} is inside a tracked resource. Its parent and state were preserved; review its separate cleanup before removal.`,
          )
        untracked.push({ id: value.id, type: value.type, group })
        continue
      }
      await verifyRemovalIdentity(context, resource)
      const tags = value.tags
      if (tags !== undefined && tags !== null) {
        if (typeof tags !== "object" || Array.isArray(tags))
          throw new Error("A tracked resource has invalid ownership metadata.")
        const untagged =
          [
            "azurerm_container_app_job.provision",
            "azurerm_user_assigned_identity.provision",
          ].includes(resource.address) && !Object.keys(tags).length
        if (
          !untagged &&
          Object.entries({
            application: "replica-hub",
            installation: config.name,
            owner: config.owner,
            managed_by: "terraform",
          }).some(([key, expected]) => (tags as Record<string, unknown>)[key] !== expected)
        )
          throw new Error("A tracked resource's ownership no longer matches this installation.")
      }
    }
  }
  return untracked
}
