import { join } from "node:path"
import { privateDirectory, writePrivateFile } from "../../../installer/private-files/index.ts"
import { installationNames } from "../../install/settings.ts"
import type { RemovalContext, RemovalModule } from "../types.ts"

export async function writeRemovalBackend(
  { config }: RemovalContext,
  kind: RemovalModule,
  staging: string,
) {
  await privateDirectory(staging)
  const names = installationNames(config)
  const backend = join(staging, `${kind}-backend.hcl`)
  await writePrivateFile(
    backend,
    [
      `resource_group_name = ${JSON.stringify(names.stateGroup)}`,
      `storage_account_name = ${JSON.stringify(names.stateAccount)}`,
      'container_name = "terraform"',
      `key = ${JSON.stringify(`${config.name}/${kind}.tfstate`)}`,
      "use_azuread_auth = true",
      "use_oidc = false",
      `subscription_id = ${JSON.stringify(config.azure.subscriptionId)}`,
      `tenant_id = ${JSON.stringify(config.azure.tenantId)}`,
    ].join("\n"),
    { exclusive: true },
  )
  return { backend, data: join(staging, `${kind}-data`) }
}
