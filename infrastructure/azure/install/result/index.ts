import type { DeploymentConfig } from "../../../installer/types.ts"
import type { DeploymentResult, Foundation, Installation } from "../types.ts"

export function deploymentResult({
  config,
  installation,
  foundation,
  stateStorageId,
  image,
}: {
  config: DeploymentConfig
  installation: Installation
  foundation: Foundation
  stateStorageId: string
  image: string
}): DeploymentResult {
  const invalid =
    "Deployment verification returned incomplete or invalid non-secret metadata. Inspect Terraform outputs and the installation lock before retrying."
  const value = installation?.url
  if (
    typeof value !== "string" ||
    /[\s\u0000-\u001f\u007f-\u009f?#\\]/.test(value) ||
    !URL.canParse(value)
  )
    throw new Error(invalid)
  const url = new URL(value)
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
    throw new Error(invalid)

  const prefix = `/subscriptions/${config.azure.subscriptionId}/resourceGroups/`.toLowerCase()
  function resourceId(value: unknown): string {
    if (
      typeof value !== "string" ||
      !value.toLowerCase().startsWith(prefix) ||
      /[\s\u0000-\u001f\u007f-\u009f?#\\]/.test(value) ||
      !/^\/subscriptions\/[^/]+\/resourceGroups\/[^/]+(?:\/providers\/[^/]+(?:\/[^/]+\/[^/]+)+)?$/i.test(
        value,
      )
    )
      throw new Error(invalid)
    return value
  }
  return {
    name: config.name,
    url: value,
    subscriptionId: config.azure.subscriptionId,
    tenantId: config.azure.tenantId,
    location: config.azure.location,
    image,
    resources: {
      resourceGroup: resourceId(installation.resource_group_id),
      app: resourceId(installation.app_id),
      environment: resourceId(installation.environment_id),
      database: resourceId(installation.postgres_server_id),
      storage: resourceId(installation.storage_account_id),
      registry: resourceId(foundation?.registry_id),
      vault: resourceId(foundation?.vault_id),
      stateStorage: resourceId(stateStorageId),
    },
  }
}
