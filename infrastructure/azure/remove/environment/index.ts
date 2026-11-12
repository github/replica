import { join } from "node:path"
import { configurationFields } from "../../../installer/config/fields/index.ts"
import { readPrivateFile, writePrivateFile } from "../../../installer/private-files/index.ts"
import type { RemovalContext, RemovalResource } from "../types.ts"

export async function removalEnvironment(
  { config, directory, azure, signal }: RemovalContext,
  resources: readonly RemovalResource[],
  live: boolean,
): Promise<string | undefined> {
  signal?.throwIfAborted()
  const path = join(directory, "environment-removal.json")
  const target = JSON.stringify([
    config.name,
    config.owner,
    config.azure.tenantId,
    config.azure.subscriptionId,
    config.azure.location,
    config.azure.resourceGroup.toLowerCase(),
  ])
  function invalid(): never {
    throw new Error(
      "Managed-environment removal evidence changed or is invalid. Review it before removing state storage.",
    )
  }
  const saved = await readPrivateFile(path, { createDirectory: false })
  let prior: string | undefined
  if (saved !== undefined) {
    let value: unknown
    try {
      value = JSON.parse(saved)
    } catch {
      invalid()
    }
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      !("version" in value) ||
      value.version !== 1 ||
      !("target" in value) ||
      value.target !== target ||
      !("managedGroup" in value) ||
      typeof value.managedGroup !== "string"
    )
      invalid()
    prior = configurationFields.resourceGroup.parse(value.managedGroup)
  }
  const environment = resources.find(({ type }) => type === "azurerm_container_app_environment")
  const observed: unknown = live
    ? JSON.parse(
        await azure(
          "containerapp",
          "env",
          "show",
          "--name",
          `${config.name}-environment`,
          "--resource-group",
          config.azure.resourceGroup,
          "--query",
          "properties.infrastructureResourceGroup",
        ),
      )
    : (environment?.values.infrastructure_resource_group_name ?? prior)
  if (observed === undefined) {
    if (environment) invalid()
    return undefined
  }
  const managedGroup = configurationFields.resourceGroup.parse(observed)
  if (prior !== undefined && prior.toLowerCase() !== managedGroup.toLowerCase()) invalid()
  signal?.throwIfAborted()
  if (saved === undefined)
    await writePrivateFile(path, JSON.stringify({ version: 1, target, managedGroup }), {
      exclusive: true,
    })
  return managedGroup
}
