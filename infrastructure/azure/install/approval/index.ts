import { resolve, join } from "node:path"

import { installationNames } from "../settings.ts"
import type { AzureInstallation, DeploymentApproval } from "../types.ts"
import { guidedPostgresProfile, type PostgresProfile } from "../profile.ts"
import { createBuildSnapshot } from "../build-context/index.ts"

export async function approveDeployment(
  { config, directory, run, ui, signal }: Pick<
    AzureInstallation,
    "config" | "directory" | "run" | "ui" | "signal"
  >,
  postgres: PostgresProfile = guidedPostgresProfile,
): Promise<DeploymentApproval> {
  const repository = resolve(import.meta.dirname, "../../../..")
  const sourceRevision = await run("git", ["rev-parse", "HEAD"], { cwd: repository })
  const sourceStatus = await run("git", ["status", "--porcelain", "--untracked-files=normal"], {
    cwd: repository,
  })
  if (sourceStatus && !ui.select)
    throw new Error(
      "Unattended deployment requires a clean source checkout. Commit the intended changes, or rerun interactively to review publication of the working tree. No cloud changes were started.",
    )
  const snapshot = await createBuildSnapshot(join(repository, "hub"), directory, signal)
  const sourceFingerprint = snapshot.fingerprint
  await snapshot.cleanup()
  const names = installationNames(config)
  const review = [
    "Deployment may incur ongoing Azure charges, including after a failed attempt, and will make Hub unavailable during release.",
    "",
    `Installation: ${config.name}. Owner: ${config.owner}.`,
    `Tenant: ${config.azure.tenantId}. Subscription: ${config.azure.subscriptionId}. Region: ${config.azure.location}.`,
    "",
    "Installation-owned resources that may be created or updated:",
    `- State: resource group ${names.stateGroup}, storage account ${names.stateAccount}, private Terraform state and lock blobs, versioning and soft deletion.`,
    `- Foundation: resource group ${names.foundationGroup}, registry ${names.registry}, and Key Vault ${names.vault}.`,
    `- Hub resource group: ${config.azure.resourceGroup}.`,
    "- Networking: virtual network, delegated subnets, and private PostgreSQL DNS.",
    `- Database: managed PostgreSQL ${config.name}-postgres (${postgres.postgres_sku}, version ${postgres.postgres_version}), the replica database, and backups.`,
    "- Storage: private artifact and release containers, versioning, and soft deletion.",
    "- Compute and logs: Container Apps environment, Hub app, setup job, and Log Analytics.",
    "- Access: separate workload identities and scoped deployment/workload grants for state, Blob, registry, and Key Vault.",
    `- First-installation provisioning: temporary job and identity ${config.name}-provision and their scoped grants; these temporary resources are removed after success.`,
    "",
    `Source: ${sourceRevision}${sourceStatus ? " with uncommitted changes" : " (clean checkout)"}.`,
    `Hub build context fingerprint: ${sourceFingerprint}.`,
    `Build and publish this local working tree to ${names.registry}.azurecr.io, including its uncommitted Hub changes when present.`,
    `Container npm registry: ${config.npmRegistry ?? "npm default; public npm access is required"}.`,
    "State storage uses a public network endpoint with Azure authentication and Blob data permissions. Shared-key and anonymous access remain disabled.",
    "Release stops old Hub revisions, runs database migrations and schedule setup, and deploys the new image.",
    "Safe Terraform plans are displayed and applied without another routine confirmation. Persistent-resource deletion and replacement remain blocked.",
    "A recognized infrastructure provisioning failure may receive one fresh-plan retry after 15 seconds, with unchanged inputs, configuration, and resource scope. The SKU and permissions are not changed.",
    "Other or repeated failures, retained-lock recovery, and changes to existing network restrictions still require review.",
    "This is not a high-availability deployment. Sign-in requires manual configuration; readiness does not verify authorization.",
    "",
    "Agree and continue with this deployment?",
  ].join("\n")
  if (!ui.select) ui.status(review)
  if (!(await ui.confirm(review))) throw new Error("Installation cancelled before cloud changes.")
  return { sourceRevision, sourceStatus, sourceFingerprint }
}
