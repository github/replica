import type { DeploymentConfig } from "../../../installer/types.ts"
import { installationNames } from "../../install/settings.ts"
import type { RemovalModule, RemovalResource } from "../types.ts"

export function validateRemovalState(
  value: unknown,
  config: DeploymentConfig,
  module: RemovalModule,
): RemovalResource[] {
  function invalid(): never {
    throw new Error(
      "Removal state contains unknown resources, ownership, or scope. Nothing was authorized for deletion.",
    )
  }
  function record(value: unknown): Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) invalid()
    return value as Record<string, unknown>
  }
  const state = record(value)
  if (typeof state.format_version !== "string" || !/^1\.\d+$/.test(state.format_version)) invalid()
  if (state.values === undefined) {
    if (Object.keys(state).every((key) => ["format_version", "terraform_version"].includes(key)))
      return []
    return invalid()
  }
  const values = record(state.values)
  if (values.root_module === undefined) {
    if (Object.keys(values).every((key) => key === "outputs")) return []
    return invalid()
  }
  const root = record(values.root_module)
  if (
    root.child_modules !== undefined &&
    (!Array.isArray(root.child_modules) || root.child_modules.length)
  )
    invalid()
  const resources = root.resources ?? []
  if (!Array.isArray(resources)) invalid()
  const allowed: Record<RemovalModule, Set<string>> = {
    provision: new Set([
      "azurerm_user_assigned_identity.provision",
      "azurerm_role_assignment.secrets",
      "azurerm_role_assignment.image",
      "azurerm_container_app_job.provision",
    ]),
    foundation: new Set([
      "azurerm_resource_group.foundation",
      "azurerm_container_registry.hub",
      "azurerm_key_vault.hub",
      "azurerm_role_assignment.secrets",
      "azurerm_role_assignment.image_push",
    ]),
    app: new Set([
      "azurerm_resource_group.hub",
      "azurerm_virtual_network.hub",
      "azurerm_subnet.apps",
      "azurerm_subnet.database",
      "azurerm_private_dns_zone.database",
      "azurerm_private_dns_zone_virtual_network_link.database",
      "azurerm_postgresql_flexible_server.database",
      "azurerm_postgresql_flexible_server_configuration.tls",
      "azurerm_postgresql_flexible_server_database.hub",
      "azurerm_storage_account.artifacts",
      "azurerm_storage_container.artifacts",
      "azurerm_storage_container.releases",
      "azurerm_storage_blob.release_lock",
      "azurerm_role_assignment.deployment_storage",
      "azurerm_log_analytics_workspace.hub",
      "azurerm_container_app_environment.hub",
      "azurerm_container_app_job.setup",
      "azurerm_container_app.hub",
      "azurerm_container_app_custom_domain.hub",
      "azurerm_user_assigned_identity.hub",
      "azurerm_user_assigned_identity.setup",
      "azurerm_role_assignment.runtime_secrets",
      "azurerm_role_assignment.setup_secrets",
      "azurerm_role_assignment.artifacts",
      "azurerm_role_assignment.image_pull",
      "azurerm_role_assignment.setup_image_pull",
    ]),
  }
  const expected = {
    application: "replica-hub",
    installation: config.name,
    owner: config.owner,
    managed_by: "terraform",
  }
  const names = installationNames(config)
  const group =
    `/subscriptions/${config.azure.subscriptionId}/resourceGroups/${module === "foundation" ? names.foundationGroup : config.azure.resourceGroup}`.toLowerCase()
  const projected: RemovalResource[] = []
  for (const raw of resources) {
    const resource = record(raw)
    if (resource.mode === "data") continue
    const address = resource.address
    if (
      resource.mode !== "managed" ||
      typeof address !== "string" ||
      typeof resource.type !== "string"
    )
      invalid()
    const base = address.split("[", 1)[0]!
    let indexedScope: string | undefined
    if (!allowed[module].has(base) || resource.type !== base.split(".")[0]) invalid()
    const counted = [
      "azurerm_container_app.hub",
      "azurerm_container_app_custom_domain.hub",
      "azurerm_role_assignment.image_pull",
      "azurerm_role_assignment.setup_image_pull",
      "azurerm_role_assignment.deployment_storage",
      "azurerm_role_assignment.image",
    ]
    if (counted.includes(base)) {
      if (address !== `${base}[0]`) invalid()
    } else if (
      base === "azurerm_role_assignment.runtime_secrets" ||
      (module === "provision" && base === "azurerm_role_assignment.secrets")
    ) {
      let key: unknown
      try {
        key = JSON.parse(address.slice(base.length))
      } catch {
        invalid()
      }
      if (!Array.isArray(key) || key.length !== 1 || typeof key[0] !== "string") invalid()
      if (base === "azurerm_role_assignment.runtime_secrets") indexedScope = key[0]
      if (
        module === "provision" &&
        !["DATABASE_URL", "HUB_MIGRATION_PASSWORD", "HUB_RUNTIME_PASSWORD"].includes(key[0])
      )
        invalid()
    } else if (address !== base) invalid()
    const values = record(resource.values)
    if (
      indexedScope !== undefined &&
      (typeof values.scope !== "string" ||
        indexedScope.toLowerCase() !== values.scope.toLowerCase())
    )
      invalid()
    const id = values.id
    if (typeof id !== "string" || !id) invalid()
    if (
      values.location !== undefined &&
      (typeof values.location !== "string" ||
        values.location.toLowerCase() !== config.azure.location.toLowerCase())
    )
      invalid()
    if (values.tags !== undefined && values.tags !== null) {
      const tags = record(values.tags)
      if (Object.entries(expected).some(([key, value]) => tags[key] !== value)) invalid()
    }
    if (
      resource.type !== "azurerm_role_assignment" &&
      id.toLowerCase() !== group &&
      !id.toLowerCase().startsWith(`${group}/`)
    ) {
      const account = `${config.name.replaceAll("-", "")}hub`
      const containers = new Set([
        `https://${account}.blob.core.windows.net/artifacts`,
        `https://${account}.blob.core.windows.net/releases`,
      ])
      const blob = `https://${account}.blob.core.windows.net/releases/deployment.lock`
      if (
        module !== "app" ||
        (!(resource.type === "azurerm_storage_container" && containers.has(id.toLowerCase())) &&
          !(resource.type === "azurerm_storage_blob" && id.toLowerCase() === blob))
      )
        invalid()
    }
    if (
      projected.some(
        (value) => value.address === address || value.id.toLowerCase() === id.toLowerCase(),
      )
    )
      invalid()
    projected.push({ address, id, type: resource.type, values })
  }
  const principals = new Set(
    projected
      .filter(({ type }) => type === "azurerm_user_assigned_identity")
      .map(({ values }) => values.principal_id)
      .filter((id): id is string => typeof id === "string" && /^[a-f0-9-]{36}$/i.test(id))
      .map((id) => id.toLowerCase()),
  )
  const foundation =
    `/subscriptions/${config.azure.subscriptionId}/resourceGroups/${names.foundationGroup}`.toLowerCase()
  const registry = `${foundation}/providers/microsoft.containerregistry/registries/${names.registry}`
  const vault = `${foundation}/providers/microsoft.keyvault/vaults/${names.vault}`
  const artifacts = `${group}/providers/microsoft.storage/storageaccounts/${config.name.replaceAll("-", "")}hub`
  const guid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i
  for (const resource of projected.filter(({ type }) => type === "azurerm_role_assignment")) {
    const { scope, principal_id: principal, role_definition_name: role } = resource.values
    if (
      typeof scope !== "string" ||
      typeof principal !== "string" ||
      !guid.test(principal) ||
      typeof role !== "string"
    )
      invalid()
    const prefix = `${scope.toLowerCase()}/providers/microsoft.authorization/roleassignments/`
    if (
      !resource.id.toLowerCase().startsWith(prefix) ||
      !guid.test(resource.id.slice(prefix.length))
    )
      invalid()
    const base = resource.address.split("[", 1)[0]!
    if (module === "foundation") {
      if (
        base === "azurerm_role_assignment.image_push"
          ? role !== "AcrPush" || scope.toLowerCase() !== registry
          : role !== "Key Vault Secrets Officer" || scope.toLowerCase() !== vault
      )
        invalid()
      continue
    }
    if (base === "azurerm_role_assignment.deployment_storage") {
      if (role !== "Storage Blob Data Contributor" || scope.toLowerCase() !== artifacts) invalid()
      continue
    }
    const identity =
      module === "provision" ? "provision" : base.includes("setup_") ? "setup" : "hub"
    const identityPrincipal = projected.find(
      ({ address }) => address === `azurerm_user_assigned_identity.${identity}`,
    )?.values.principal_id
    if (
      !principals.has(principal.toLowerCase()) ||
      typeof identityPrincipal !== "string" ||
      identityPrincipal.toLowerCase() !== principal.toLowerCase()
    )
      invalid()
    if (
      [
        "azurerm_role_assignment.image",
        "azurerm_role_assignment.image_pull",
        "azurerm_role_assignment.setup_image_pull",
      ].includes(base)
    ) {
      if (role !== "AcrPull" || scope.toLowerCase() !== registry) invalid()
    } else if (base === "azurerm_role_assignment.artifacts") {
      if (
        role !== "Storage Blob Data Contributor" ||
        scope.toLowerCase() !== `${artifacts}/blobservices/default/containers/artifacts`
      )
        invalid()
    } else if (
      role !== "Key Vault Secrets User" ||
      !/^\/subscriptions\/[a-f0-9-]{36}\/resourceGroups\/[^/]+\/providers\/Microsoft\.KeyVault\/vaults\/[^/]+\/secrets\/[a-z0-9-]+$/i.test(
        scope,
      ) ||
      ((module === "provision" || base === "azurerm_role_assignment.setup_secrets") &&
        !scope.toLowerCase().startsWith(`${vault}/secrets/`))
    )
      invalid()
  }
  return projected
}
