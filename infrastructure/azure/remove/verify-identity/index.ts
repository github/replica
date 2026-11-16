import type { RemovalContext, RemovalResource } from "../types.ts"

export async function verifyRemovalIdentity(
  { config, azure }: Pick<RemovalContext, "config" | "azure">,
  resource: RemovalResource,
): Promise<void> {
  const record = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value)
  if (resource.type === "azurerm_user_assigned_identity") {
    const identity: unknown = JSON.parse(await azure("identity", "show", "--ids", resource.id))
    if (
      !record(identity) ||
      typeof identity.id !== "string" ||
      identity.id.toLowerCase() !== resource.id.toLowerCase() ||
      typeof identity.principalId !== "string" ||
      identity.principalId.toLowerCase() !== String(resource.values.principal_id).toLowerCase() ||
      (resource.address === "azurerm_user_assigned_identity.provision" &&
        (identity.name !== `${config.name}-provision` ||
          typeof identity.resourceGroup !== "string" ||
          identity.resourceGroup.toLowerCase() !== config.azure.resourceGroup.toLowerCase() ||
          typeof identity.location !== "string" ||
          identity.location.toLowerCase() !== config.azure.location.toLowerCase()))
    )
      throw new Error(
        resource.address === "azurerm_user_assigned_identity.provision"
          ? "Temporary provisioning identity no longer matches its selected installation."
          : "Workload identity no longer matches its Terraform state.",
      )
  }
  if (resource.address === "azurerm_container_app_job.provision") {
    const job: unknown = JSON.parse(
      await azure(
        "containerapp",
        "job",
        "show",
        "--name",
        `${config.name}-provision`,
        "--resource-group",
        config.azure.resourceGroup,
        "--query",
        "{id:id,name:name,resourceGroup:resourceGroup,environmentId:properties.environmentId,identityIds:keys(identity.userAssignedIdentities)}",
      ),
    )
    const group = `/subscriptions/${config.azure.subscriptionId}/resourceGroups/${config.azure.resourceGroup}`
    if (
      !record(job) ||
      typeof job.id !== "string" ||
      job.id.toLowerCase() !== resource.id.toLowerCase() ||
      job.name !== `${config.name}-provision` ||
      typeof job.resourceGroup !== "string" ||
      job.resourceGroup.toLowerCase() !== config.azure.resourceGroup.toLowerCase() ||
      typeof job.environmentId !== "string" ||
      job.environmentId.toLowerCase() !==
        `${group}/providers/Microsoft.App/managedEnvironments/${config.name}-environment`.toLowerCase() ||
      !Array.isArray(job.identityIds) ||
      job.identityIds.length !== 1 ||
      typeof job.identityIds[0] !== "string" ||
      job.identityIds[0].toLowerCase() !==
        `${group}/providers/Microsoft.ManagedIdentity/userAssignedIdentities/${config.name}-provision`.toLowerCase()
    )
      throw new Error("Temporary provisioning job no longer matches its selected installation.")
  }
}
