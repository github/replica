import { join } from "node:path"

import { parseAzureId } from "../../../installer/config/fields/index.ts"
import { parseHttpsOrigin } from "../../../installer/config/https-origin/index.ts"
import { readPrivateFile } from "../../../installer/private-files/index.ts"
import type { DeploymentConfig } from "../../../installer/types.ts"

type SecretReference = { key_vault_id: string; secret_id: string }
interface OperatorInputs {
  runtime_environment_variables?: Record<string, string>
  hub_application_origin?: string
  github_app_id?: string
  github_client_id?: string
  github_app_installation_id?: string
  github_provider_revision?: number
  runtime_secret_references?: Record<string, SecretReference>
  postgres_sku?: string
  postgres_version?: string
  backup_retention_days?: number
  custom_hostname?: string | null
  certificate_id?: string | null
}

export async function readInstallationInputs(
  directory: string,
  config: DeploymentConfig,
  { allowMissingAuthenticationOrigin = false }: { allowMissingAuthenticationOrigin?: boolean } = {},
): Promise<OperatorInputs> {
  const content = await readPrivateFile(join(directory, "installation.tfvars.json"))
  if (content === undefined) return {}
  const invalid = () =>
    new Error(
      "Saved Terraform inputs are unsupported, invalid, or belong to another installation. Review the private inputs before retrying; no cloud changes or input rewrites were started.",
    )
  let value: unknown
  try {
    value = JSON.parse(content)
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    throw invalid()
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw invalid()
  const inputs = value as Record<string, unknown>
  const generated = [
    "subscription_id",
    "name",
    "owner",
    "location",
    "resource_group_name",
    "grant_deployment_storage_access",
    "image",
    "deploy_hub",
    "acr_id",
    "runtime_database_secret",
    "setup_database_secret",
  ]
  const optional = [
    "runtime_environment_variables",
    "hub_application_origin",
    "github_app_id",
    "github_client_id",
    "github_app_installation_id",
    "github_provider_revision",
    "runtime_secret_references",
    "postgres_sku",
    "postgres_version",
    "backup_retention_days",
    "custom_hostname",
    "certificate_id",
  ]
  if (
    Object.keys(inputs).some((key) => !generated.includes(key) && !optional.includes(key)) ||
    parseAzureId(inputs.subscription_id) !== config.azure.subscriptionId ||
    inputs.name !== config.name ||
    inputs.owner !== config.owner ||
    inputs.location !== config.azure.location ||
    typeof inputs.resource_group_name !== "string" ||
    inputs.resource_group_name.toLowerCase() !== config.azure.resourceGroup.toLowerCase()
  )
    throw invalid()
  const reference = (value: unknown): SecretReference => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw invalid()
    const secret = value as Record<string, unknown>
    if (
      Object.keys(secret).some((key) => !["key_vault_id", "secret_id"].includes(key)) ||
      typeof secret.key_vault_id !== "string" ||
      typeof secret.secret_id !== "string" ||
      !/^\/subscriptions\/[a-f0-9-]{36}\/resourceGroups\/[^/]+\/providers\/Microsoft.KeyVault\/vaults\/[a-zA-Z0-9-]{1,24}$/i.test(
        secret.key_vault_id,
      ) ||
      !/^https:\/\/[a-zA-Z0-9-]{1,24}\.vault\.azure\.net\/secrets\/[a-zA-Z0-9-]{1,127}(\/[a-fA-F0-9]{32})?$/.test(
        secret.secret_id,
      ) ||
      new URL(secret.secret_id).hostname.toLowerCase() !==
        `${secret.key_vault_id.split("/").at(-1)?.toLowerCase()}.vault.azure.net`
    )
      throw invalid()
    return { key_vault_id: secret.key_vault_id, secret_id: secret.secret_id }
  }
  const result: OperatorInputs = {}
  for (const key of ["github_app_id", "github_app_installation_id"] as const) {
    const value = inputs[key]
    if (value == null) continue
    if (
      typeof value !== "string" ||
      !/^[1-9][0-9]*$/.test(value) ||
      !Number.isSafeInteger(Number(value))
    )
      throw invalid()
    result[key] = value
  }
  if (inputs.github_client_id != null) {
    if (typeof inputs.github_client_id !== "string" || !/^\S{1,200}$/.test(inputs.github_client_id))
      throw invalid()
    result.github_client_id = inputs.github_client_id
  }
  if (inputs.hub_application_origin != null) {
    const origin = parseHttpsOrigin(inputs.hub_application_origin)
    if (!origin)
      throw new Error(
        "Saved Terraform inputs are invalid. Supply hub_application_origin as an exact HTTPS origin such as https://hub.example.com. Review the private inputs before retrying; no cloud changes or input rewrites were started.",
      )
    result.hub_application_origin = origin.origin
  }
  if (inputs.github_provider_revision != null) {
    const revision = inputs.github_provider_revision
    if (
      typeof revision !== "number" ||
      !Number.isSafeInteger(revision) ||
      revision < 1 ||
      revision > 2_147_483_647
    )
      throw invalid()
    result.github_provider_revision = revision
  }
  // Match the pinned provider's input contract before maintenance can stop Hub.
  const sku =
    /^(?:B_Standard_B(?:(?:1|2|4|8|12|16|20)ms|2s)|GP_Standard_D(?:(?:2|4|8|16|32|48|64)s_v3|(?:2|4|8|16|32|48|64)ds_v4|(?:2|4|8|16|32|48|64|96)(?:ds|ads)_v5)|MO_Standard_E(?:(?:2|4|8|16|20|32|48|64)s_v3|(?:2|4|6|8|16|20|32|48|64)ds_v4|(?:2|4|8|16|20|32|48|64|96)ds_v5|(?:2|4|8|16|32|48|64|96)ads_v5))$/
  if (inputs.postgres_sku !== undefined) {
    if (typeof inputs.postgres_sku !== "string" || !sku.test(inputs.postgres_sku)) throw invalid()
    result.postgres_sku = inputs.postgres_sku
  }
  if (inputs.postgres_version !== undefined) {
    if (
      typeof inputs.postgres_version !== "string" ||
      !/^(?:11|12|13|14|15|16|17)$/.test(inputs.postgres_version)
    )
      throw invalid()
    result.postgres_version = inputs.postgres_version
  }
  if (inputs.backup_retention_days !== undefined) {
    const days = inputs.backup_retention_days
    if (typeof days !== "number" || !Number.isInteger(days) || days < 7 || days > 35)
      throw invalid()
    result.backup_retention_days = days
  }
  const hostname = inputs.custom_hostname ?? null
  const certificate = inputs.certificate_id ?? null
  if ((hostname === null) !== (certificate === null)) throw invalid()
  if (hostname !== null || certificate !== null) {
    if (
      typeof hostname !== "string" ||
      !/^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/.test(hostname) ||
      typeof certificate !== "string" ||
      !/^\/subscriptions\/[a-f0-9-]{36}\/resourceGroups\/[^/]+\/providers\/Microsoft.App\/managedEnvironments\/[^/]+\/certificates\/[^/]+$/i.test(
        certificate,
      )
    )
      throw invalid()
    result.custom_hostname = hostname
    result.certificate_id = certificate
  }
  const reserved = [
    "DATABASE_URL",
    "DATABASE_RUNTIME_ROLE",
    "NODE_ENV",
    "RUNTIME_MODE",
    "HOST",
    "PORT",
    "CLIENT_DIRECTORY",
    "SHUTDOWN_TIMEOUT_MS",
    "ARTIFACT_STORAGE_PROVIDER",
    "ARTIFACT_STORAGE_DIRECTORY",
    "AZURE_STORAGE_ACCOUNT",
    "AZURE_STORAGE_CONTAINER",
    "AZURE_CLIENT_ID",
    "AZURE_KEY_VAULT_SECRET_REFERENCES",
  ]
  if (inputs.runtime_secret_references !== undefined) {
    if (
      typeof inputs.runtime_secret_references !== "object" ||
      inputs.runtime_secret_references === null ||
      Array.isArray(inputs.runtime_secret_references) ||
      Object.keys(inputs.runtime_secret_references).length > 63
    )
      throw invalid()
    const setup = reference(inputs.setup_database_secret)
    const identity = (secret: SecretReference) =>
      `${secret.key_vault_id}/secrets/${new URL(secret.secret_id).pathname.split("/")[2]}`.toLowerCase()
    result.runtime_secret_references = {}
    for (const [key, value] of Object.entries(inputs.runtime_secret_references)) {
      if (
        !/^[A-Z][A-Z0-9_]{0,40}$/.test(key) ||
        reserved.includes(key) ||
        [
          "GITHUB_APP_ID",
          "GITHUB_CLIENT_ID",
          "GITHUB_APP_INSTALLATION_ID",
          "GITHUB_PROVIDER_REVISION",
        ].includes(key)
      )
        throw invalid()
      const secret = reference(value)
      if (identity(secret) === identity(setup)) throw invalid()
      result.runtime_secret_references[key] = secret
    }
  }
  const githubEnvironment: Record<string, string | number | undefined> = {
    HUB_APPLICATION_ORIGIN: result.hub_application_origin,
    GITHUB_APP_ID: result.github_app_id,
    GITHUB_CLIENT_ID: result.github_client_id,
    GITHUB_APP_INSTALLATION_ID: result.github_app_installation_id,
    GITHUB_PROVIDER_REVISION: result.github_provider_revision,
  }
  if (inputs.runtime_environment_variables !== undefined) {
    if (
      typeof inputs.runtime_environment_variables !== "object" ||
      inputs.runtime_environment_variables === null ||
      Array.isArray(inputs.runtime_environment_variables)
    )
      throw invalid()
    result.runtime_environment_variables = {}
    for (const [name, value] of Object.entries(inputs.runtime_environment_variables)) {
      if (
        !/^[A-Z][A-Z0-9_]{0,40}$/.test(name) ||
        reserved.includes(name) ||
        githubEnvironment[name] !== undefined ||
        Object.hasOwn(result.runtime_secret_references ?? {}, name) ||
        typeof value !== "string"
      )
        throw invalid()
      result.runtime_environment_variables[name] = value
    }
  }
  const secrets = result.runtime_secret_references ?? {}
  const environment = { ...result.runtime_environment_variables }
  for (const [name, value] of Object.entries(githubEnvironment)) {
    if (value !== undefined) environment[name] = String(value)
  }
  for (const name of ["GITHUB_APP_ID", "GITHUB_APP_INSTALLATION_ID"] as const) {
    const value = environment[name]
    if (
      value !== undefined &&
      (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value)))
    )
      throw invalid()
  }
  if (
    environment.GITHUB_CLIENT_ID !== undefined &&
    !/^\S{1,200}$/.test(environment.GITHUB_CLIENT_ID)
  )
    throw invalid()
  const revision = environment.GITHUB_PROVIDER_REVISION
  if (
    revision !== undefined &&
    (!/^[1-9][0-9]*$/.test(revision) ||
      !Number.isSafeInteger(Number(revision)) ||
      Number(revision) > 2_147_483_647)
  )
    throw invalid()
  if (
    environment.HUB_APPLICATION_ORIGIN !== undefined &&
    !parseHttpsOrigin(environment.HUB_APPLICATION_ORIGIN)
  )
    throw invalid()
  const configured = (name: string) => Boolean(environment[name]?.trim() || secrets[name])
  if (environment.REPLICA_COPILOT_AUTHENTICATION?.trim() === "github-app-installation") {
    const missing = [
      "GITHUB_APP_ID",
      "REPLICA_COPILOT_GITHUB_INSTALLATION_ID",
      "REPLICA_COPILOT_GITHUB_ORGANIZATION",
    ].filter((name) => !configured(name))
    for (const [name, pattern] of [
      ["REPLICA_COPILOT_GITHUB_INSTALLATION_ID", /^[1-9]\d*$/],
      ["REPLICA_COPILOT_GITHUB_ORGANIZATION", /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/],
    ] as const) {
      if (
        configured(name) &&
        environment[name] !== undefined &&
        !pattern.test(environment[name].trim())
      )
        missing.push(name)
    }
    if (!configured("GITHUB_APP_PRIVATE_KEY") && !configured("GITHUB_APP_PRIVATE_KEY_BASE64"))
      missing.push("GITHUB_APP_PRIVATE_KEY or GITHUB_APP_PRIVATE_KEY_BASE64")
    if (missing.length)
      throw new Error(
        `Saved Terraform inputs require valid ${missing.join(", ")} when REPLICA_COPILOT_AUTHENTICATION=github-app-installation. Supply runtime values or secret references before retrying; no cloud changes or input rewrites were started.`,
      )
  }
  // Copilot-only Apps need no GitHub sign-in, sign-in installation, or webhook settings.
  const copilotOnly =
    environment.REPLICA_COPILOT_AUTHENTICATION?.trim() === "github-app-installation" &&
    [
      "GITHUB_CLIENT_ID",
      "GITHUB_CLIENT_SECRET",
      "GITHUB_PROVIDER_REVISION",
      "GITHUB_APP_INSTALLATION_ID",
      "GITHUB_WEBHOOK_SECRET",
    ].every((name) => !environment[name]?.trim() && !secrets[name])
  if (
    (result.hub_application_origin && secrets.HUB_APPLICATION_ORIGIN) ||
    (secrets.GITHUB_CLIENT_SECRET && !environment.GITHUB_CLIENT_ID) ||
    (secrets.GITHUB_APP_PRIVATE_KEY_BASE64 &&
      (!environment.GITHUB_APP_ID ||
        (!copilotOnly &&
          (!environment.GITHUB_CLIENT_ID || !environment.GITHUB_APP_INSTALLATION_ID))))
  )
    throw invalid()
  const githubSettings = [
    "GITHUB_APP_ID",
    "GITHUB_APP_PRIVATE_KEY_BASE64",
    "GITHUB_APP_INSTALLATION_ID",
    "GITHUB_WEBHOOK_SECRET",
    "GITHUB_CLIENT_ID",
    "GITHUB_CLIENT_SECRET",
    "GITHUB_PROVIDER_REVISION",
  ]
  const otherAuthenticationSettings = [
    "HUB_AUTHENTICATION_ENCRYPTION_KEY",
    "HUB_BOOTSTRAP_SECRET",
    "ENTRA_OIDC_CLIENT_AUTHENTICATION",
    "ENTRA_OIDC_CLIENT_ID",
    "ENTRA_OIDC_CLIENT_SECRET",
    "ENTRA_OIDC_ISSUER",
    "ENTRA_OIDC_MANAGED_IDENTITY_CLIENT_ID",
    "ENTRA_OIDC_PROVIDER_REVISION",
  ]
  if (
    !allowMissingAuthenticationOrigin &&
    ((githubSettings.some(configured) && !copilotOnly) ||
      otherAuthenticationSettings.some(configured) ||
      environment.HUB_LOCAL_SIGN_IN?.trim() === "true" ||
      secrets.HUB_LOCAL_SIGN_IN) &&
    !configured("HUB_APPLICATION_ORIGIN")
  )
    throw new Error(
      "Saved Terraform inputs require HUB_APPLICATION_ORIGIN when authentication is configured. Supply an exact HTTPS origin or a secret reference before retrying; no cloud changes or input rewrites were started.",
    )
  const sharedKeys = ["HUB_AUTHENTICATION_ENCRYPTION_KEY", "HUB_BOOTSTRAP_SECRET"]
  if (["HUB_APPLICATION_ORIGIN", ...sharedKeys].some(configured) && !sharedKeys.every(configured))
    throw new Error(
      `Saved Terraform inputs require ${sharedKeys.filter((name) => !configured(name)).join(", ")} together with HUB_APPLICATION_ORIGIN for authentication. Supply secret references before retrying; no cloud changes or input rewrites were started.`,
    )
  return result
}
