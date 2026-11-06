import type { DeploymentResult } from "../../azure/install/types.ts"

export function formatDeploymentSummary(
  result: DeploymentResult,
  configurationPath: string,
): string {
  const resources: [string, string][] = [
    ["Application resource group", result.resources.resourceGroup],
    ["Hub app", result.resources.app],
    ["Container Apps environment", result.resources.environment],
    ["PostgreSQL", result.resources.database],
    ["Artifact storage", result.resources.storage],
    ["Container registry", result.resources.registry],
    ["Key Vault", result.resources.vault],
    ["Terraform state storage", result.resources.stateStorage],
  ]
  const links = resources.map(([label, id]) => {
    const path = id.split("/").map(encodeURIComponent).join("/")
    return `${label}: ${id.split("/").at(-1)}\n  https://portal.azure.com/#@${encodeURIComponent(result.tenantId)}/resource${path}/overview`
  })
  return [
    "Hub deployment completed.",
    `Service URL: ${result.url}`,
    `Installation: ${result.name}`,
    `Azure subscription: ${result.subscriptionId}`,
    `Azure tenant: ${result.tenantId}`,
    `Region: ${result.location}`,
    `Image: ${result.image}`,
    `Saved configuration: ${JSON.stringify(configurationPath)}`,
    "",
    ...links,
    "",
    "Readiness does not provide sign-in or authorization.",
  ].join("\n")
}
