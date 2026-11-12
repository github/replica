import { installationNames } from "../../install/settings.ts"
import { parseTerraformLock } from "../parse-state-lock/index.ts"
import type { RemovalContext, RemovalModule } from "../types.ts"
import { RemovalLeaseError } from "../lease-error/index.ts"

export async function readTerraformLock(context: RemovalContext, kind: RemovalModule) {
  context.signal?.throwIfAborted()
  const { config } = context
  const account = installationNames(config).stateAccount
  const blob = `${config.name}/${kind}.tfstate`
  const target = {
    installation: config.name,
    subscription: config.azure.subscriptionId,
    kind: "terraform" as const,
    account,
    container: "terraform",
    blob,
  }
  const raw = await context.azure(
    "storage",
    "blob",
    "show",
    "--account-name",
    account,
    "--container-name",
    "terraform",
    "--name",
    blob,
    "--auth-mode",
    "login",
    "--query",
    "{lease:properties.lease,lock:metadata.terraformlockid,etag:properties.etag,modified:properties.lastModified,size:properties.contentLength}",
  )
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new RemovalLeaseError(
      target,
      undefined,
      "Terraform lock metadata JSON is invalid; the response was not printed.",
    )
  }
  try {
    return parseTerraformLock(value, `terraform/${blob}`)
  } catch (error) {
    const lease =
      value && typeof value === "object" && !Array.isArray(value) && "lease" in value
        ? value.lease
        : undefined
    throw new RemovalLeaseError(
      target,
      lease,
      error instanceof Error ? error.message : "Terraform lock metadata could not be verified.",
    )
  }
}
