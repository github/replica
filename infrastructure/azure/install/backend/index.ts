import { join } from "node:path"

import { installationNames } from "../settings.ts"
import type { AzureInstallation } from "../types.ts"
import { writePrivateFile } from "../../../installer/private-files/index.ts"

type StateAccount = {
  id: string
  tags?: Record<string, string>
  allowSharedKeyAccess: boolean
  allowBlobPublicAccess: boolean
  minimumTlsVersion: string
  publicNetworkAccess: string
  networkRuleSet: { defaultAction: string }
}

export async function prepareBackend(context: AzureInstallation) {
  const { config, directory, azure, ui } = context
  const names = installationNames(config)
  const tags = {
    application: "replica-hub",
    installation: config.name,
    owner: config.owner,
    managed_by: "replica-installer",
  }
  const exists = JSON.parse(await azure("group", "exists", "--name", names.stateGroup)) as boolean
  if (exists) {
    const group = JSON.parse(await azure("group", "show", "--name", names.stateGroup)) as {
      tags?: Record<string, string>
    }
    if (Object.entries(tags).some(([key, value]) => group.tags?.[key] !== value)) {
      throw new Error("State resource group ownership differs. The installer will not adopt it.")
    }
  } else {
    await azure(
      "group",
      "create",
      "--name",
      names.stateGroup,
      "--location",
      config.azure.location,
      "--tags",
      ...Object.entries(tags).map(([key, value]) => `${key}=${value}`),
    )
  }
  const accounts = JSON.parse(
    await azure("storage", "account", "list", "--resource-group", names.stateGroup),
  ) as { name: string; allowSharedKeyAccess?: boolean }[]
  if (accounts.some(({ name }) => name !== names.stateAccount)) {
    throw new Error("Unexpected resources in the state group. Review ownership before continuing.")
  }
  if (!accounts.length) {
    await azure(
      "storage",
      "account",
      "create",
      "--name",
      names.stateAccount,
      "--resource-group",
      names.stateGroup,
      "--location",
      config.azure.location,
      "--sku",
      "Standard_LRS",
      "--kind",
      "StorageV2",
      "--min-tls-version",
      "TLS1_2",
      "--allow-blob-public-access",
      "false",
      "--allow-shared-key-access",
      "false",
      "--public-network-access",
      "Enabled",
      "--default-action",
      "Allow",
      "--bypass",
      "None",
      "--tags",
      ...Object.entries(tags).map(([key, value]) => `${key}=${value}`),
    )
  }
  const readStorage = async () =>
    JSON.parse(
      await azure(
        "storage",
        "account",
        "show",
        "--name",
        names.stateAccount,
        "--resource-group",
        names.stateGroup,
      ),
    ) as StateAccount
  const verifyStorage = (storage: StateAccount) => {
    if (Object.entries(tags).some(([key, value]) => storage.tags?.[key] !== value)) {
      throw new Error("State account ownership differs. The installer will not change its access.")
    }
    if (
      storage.allowSharedKeyAccess !== false ||
      storage.allowBlobPublicAccess !== false ||
      storage.minimumTlsVersion !== "TLS1_2"
    ) {
      throw new Error("Existing state account does not match the protected backend contract.")
    }
    if (
      storage.publicNetworkAccess !== "Enabled" ||
      !["Allow", "Deny"].includes(storage.networkRuleSet?.defaultAction)
    ) {
      throw new Error(
        "State storage has a private, perimeter, or unknown network policy. The installer will not override it; use an authorized network or review the account policy.",
      )
    }
  }
  let storage = await readStorage()
  verifyStorage(storage)
  if (storage.networkRuleSet.defaultAction === "Deny") {
    if (!ui.select)
      throw new Error(
        "Changing the existing state account's network restriction requires separate interactive consent. Rerun setup interactively; deployment approval does not authorize this change. Account network settings were not changed.",
      )
    if (
      !(await ui.confirm(
        `State account ${names.stateAccount} restricts network access. Remove its network restriction and use Azure authentication and Blob data permissions instead? Shared-key and anonymous access will remain disabled.`,
      ))
    ) {
      throw new Error("State access change cancelled. Account network settings were not changed.")
    }
    await azure(
      "storage",
      "account",
      "update",
      "--name",
      names.stateAccount,
      "--resource-group",
      names.stateGroup,
      "--default-action",
      "Allow",
    )
    storage = await readStorage()
    verifyStorage(storage)
    if (storage.networkRuleSet.defaultAction !== "Allow") {
      throw new Error("Azure did not apply the state access change. Check the account policy.")
    }
  }
  const token = JSON.parse(
    await azure("account", "get-access-token", "--resource", "https://management.azure.com/"),
  ) as { accessToken: string }
  const claims = JSON.parse(
    Buffer.from(token.accessToken.split(".")[1]!, "base64url").toString("utf8"),
  ) as { oid: string }
  if (!/^[a-f0-9-]{36}$/i.test(claims.oid))
    throw new Error("Azure did not return a deployment principal.")
  const grants = JSON.parse(
    await azure("role", "assignment", "list", "--scope", storage.id, "--assignee", claims.oid),
  ) as { roleDefinitionName: string }[]
  if (
    !grants.some(({ roleDefinitionName }) => roleDefinitionName === "Storage Blob Data Contributor")
  ) {
    await azure(
      "role",
      "assignment",
      "create",
      "--scope",
      storage.id,
      "--assignee-object-id",
      claims.oid,
      "--role",
      "Storage Blob Data Contributor",
    )
  }
  await azure(
    "storage",
    "account",
    "blob-service-properties",
    "update",
    "--account-name",
    names.stateAccount,
    "--resource-group",
    names.stateGroup,
    "--enable-versioning",
    "true",
    "--enable-delete-retention",
    "true",
    "--delete-retention-days",
    "14",
    "--enable-container-delete-retention",
    "true",
    "--container-delete-retention-days",
    "14",
  )
  while (true) {
    try {
      await azure(
        "storage",
        "container",
        "create",
        "--account-name",
        names.stateAccount,
        "--name",
        "terraform",
        "--auth-mode",
        "login",
        "--public-access",
        "off",
      )
      break
    } catch {
      await ui.wait(
        "State storage is not reachable yet. Allow RBAC propagation and verify Azure sign-in, Storage Blob Data Contributor permission, connectivity, and subscription policy, then continue to retry.",
      )
    }
  }
  const backend = async (key: string) => {
    const path = join(directory, `${key}-backend.hcl`)
    await writePrivateFile(
      path,
      [
        `resource_group_name = ${JSON.stringify(names.stateGroup)}`,
        `storage_account_name = ${JSON.stringify(names.stateAccount)}`,
        'container_name = "terraform"',
        `key = ${JSON.stringify(`${config.name}/${key}.tfstate`)}`,
        "use_azuread_auth = true",
        "use_oidc = false",
        `subscription_id = ${JSON.stringify(config.azure.subscriptionId)}`,
        `tenant_id = ${JSON.stringify(config.azure.tenantId)}`,
      ].join("\n") + "\n",
    )
    return path
  }
  return { backend, account: names.stateAccount, id: storage.id }
}
