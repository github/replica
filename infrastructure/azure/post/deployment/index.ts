import type { AzureInstallation } from "../../install/types.ts"
import { verifyInstallationGroup } from "../../install/group/index.ts"
import type { PostDeployment } from "../types.ts"

export async function readPostDeployment(
  context: AzureInstallation,
  { allowStopped = false }: { allowStopped?: boolean } = {},
): Promise<PostDeployment> {
  const { config, azure } = context
  const group = `/subscriptions/${config.azure.subscriptionId}/resourceGroups/${config.azure.resourceGroup}`
  const appName = `${config.name}-hub`
  const appId = `${group}/providers/Microsoft.App/containerApps/${appName}`
  const environmentId = `${group}/providers/Microsoft.App/managedEnvironments/${config.name}-environment`
  if (!(await verifyInstallationGroup(context, config.azure.resourceGroup)))
    throw new Error("Post-setup requires the existing installation's resource group.")
  const app = JSON.parse(
    await azure(
      "containerapp",
      "show",
      "--name",
      appName,
      "--resource-group",
      config.azure.resourceGroup,
      "--query",
      "{id:id,name:name,fqdn:properties.configuration.ingress.fqdn,environmentId:properties.environmentId,revisionMode:properties.configuration.activeRevisionsMode,traffic:properties.configuration.ingress.traffic,customDomains:properties.configuration.ingress.customDomains[].name}",
    ),
  ) as {
    id?: string
    name?: string
    fqdn?: string
    environmentId?: string
    revisionMode?: string
    traffic?: { weight?: number; latestRevision?: boolean; revisionName?: string }[]
    customDomains?: string[] | null
  }
  if (
    app.id?.toLowerCase() !== appId.toLowerCase() ||
    app.name !== appName ||
    app.environmentId?.toLowerCase() !== environmentId.toLowerCase() ||
    app.revisionMode !== "Multiple" ||
    typeof app.fqdn !== "string" ||
    !/^[a-z0-9.-]+\.azurecontainerapps\.io$/.test(app.fqdn) ||
    !Array.isArray(app.traffic)
  )
    throw new Error(
      "The deployed Hub identity, ingress, or revision policy does not match this installation.",
    )
  const revisions: unknown = JSON.parse(
    await azure(
      "containerapp",
      "revision",
      "list",
      "--all",
      "--name",
      appName,
      "--resource-group",
      config.azure.resourceGroup,
      "--query",
      "[].{name:name,active:properties.active,image:properties.template.containers[0].image,env:properties.template.containers[0].env,health:properties.healthState}",
    ),
  )
  if (!Array.isArray(revisions) || revisions.some((value) => !value || typeof value !== "object"))
    throw new Error("Hub revision metadata is unverifiable.")
  const active = revisions.filter((value) => value.active === true)
  const traffic = app.traffic.filter((value) => value.weight !== 0)
  if (
    (active.length !== 1 && !(allowStopped && active.length === 0)) ||
    traffic.length !== 1 ||
    traffic[0]?.weight !== 100
  )
    throw new Error(
      "Post-setup requires one active Hub revision receiving all traffic. Review the current deployment first.",
    )
  const latest: unknown = JSON.parse(
    await azure(
      "containerapp",
      "show",
      "--name",
      appName,
      "--resource-group",
      config.azure.resourceGroup,
      "--query",
      "properties.latestRevisionName",
    ),
  )
  const revision = active[0] ?? revisions.find((value) => value.name === latest)
  if (!revision)
    throw new Error(
      "The stopped Hub's latest revision could not be verified. No revision was activated.",
    )
  if (
    typeof revision.name !== "string" ||
    !revision.name.startsWith(`${appName}--`) ||
    !/^[a-z0-9-]+$/.test(revision.name) ||
    (traffic[0]?.revisionName && traffic[0].revisionName !== revision.name) ||
    (!traffic[0]?.revisionName && traffic[0]?.latestRevision !== true) ||
    typeof revision.image !== "string" ||
    !/^[a-z0-9][a-z0-9.:/-]+@sha256:[a-f0-9]{64}$/.test(revision.image) ||
    !Array.isArray(revision.env)
  )
    throw new Error("The active Hub revision, traffic target, or immutable image is unverifiable.")
  if (traffic[0]?.latestRevision) {
    if (latest !== revision.name)
      throw new Error(
        "Latest-revision traffic is not serving the selected active revision. Wait for rollout or review deployment status.",
      )
  }
  const identity = JSON.parse(
    await azure(
      "identity",
      "show",
      "--ids",
      `${group}/providers/Microsoft.ManagedIdentity/userAssignedIdentities/${config.name}-hub`,
      "--query",
      "{id:id,principalId:principalId}",
    ),
  ) as { id?: string; principalId?: string }
  if (
    identity.id?.toLowerCase() !==
      `${group}/providers/Microsoft.ManagedIdentity/userAssignedIdentities/${config.name}-hub`.toLowerCase() ||
    typeof identity.principalId !== "string" ||
    !/^[a-f0-9-]{36}$/i.test(identity.principalId)
  )
    throw new Error("Hub's managed identity could not be verified.")
  const environment: Record<string, string> = {}
  for (const entry of revision.env) {
    if (
      !entry ||
      typeof entry !== "object" ||
      typeof entry.name !== "string" ||
      typeof entry.value !== "string" ||
      entry.secretRef ||
      Object.hasOwn(environment, entry.name)
    )
      throw new Error(
        "The active Hub environment is unsupported. Review its protected configuration before post-setup.",
      )
    environment[entry.name] = entry.value
  }
  if (
    app.customDomains != null &&
    (!Array.isArray(app.customDomains) ||
      app.customDomains.some((host) => typeof host !== "string" || !/^[a-z0-9.-]+$/i.test(host)))
  )
    throw new Error("The deployed custom-domain metadata is invalid.")
  // Only this installation's setup/provisioning jobs need coordination.
  const jobs: unknown = JSON.parse(
    await azure(
      "containerapp",
      "job",
      "list",
      "--resource-group",
      config.azure.resourceGroup,
      "--query",
      "[].name",
    ),
  )
  if (!Array.isArray(jobs) || jobs.some((name) => typeof name !== "string"))
    throw new Error("Post-setup could not verify installation jobs.")
  for (const name of jobs) {
    if (![`${config.name}-setup`, `${config.name}-provision`].includes(name)) continue
    const executions: unknown = JSON.parse(
      await azure(
        "containerapp",
        "job",
        "execution",
        "list",
        "--name",
        name,
        "--resource-group",
        config.azure.resourceGroup,
        "--query",
        "[].properties.status",
      ),
    )
    if (
      !Array.isArray(executions) ||
      executions.some(
        (status) => !["Succeeded", "Failed", "Stopped", "Canceled"].includes(String(status)),
      )
    )
      throw new Error(
        "An installation setup/provisioning job is active or unverifiable. Wait for it before post-setup.",
      )
  }
  return {
    appId,
    appName,
    environmentId,
    revision: revision.name,
    active: active.length === 1,
    image: revision.image,
    origin: `https://${app.fqdn}`,
    customHosts: app.customDomains ?? [],
    principalId: identity.principalId,
    environment,
  }
}
