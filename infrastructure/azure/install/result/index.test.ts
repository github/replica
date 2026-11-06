import { expect, it } from "vitest"

import { deploymentResult } from "./index.ts"

function input() {
  const subscriptionId = "00000000-0000-0000-0000-000000000001"
  const tenantId = "00000000-0000-0000-0000-000000000002"
  const group = `/subscriptions/${subscriptionId}/resourceGroups/actual-app-group`
  const foundation = `/subscriptions/${subscriptionId}/resourceGroups/actual-foundation-group`
  return {
    config: {
      version: 1 as const,
      cloud: "azure" as const,
      name: "test-hub",
      owner: "owner-not-for-the-receipt",
      npmRegistry: "https://proxy.example/npm/",
      azure: {
        subscriptionId,
        tenantId,
        location: "eastus2",
        resourceGroup: "actual-app-group",
        accessToken: "secret-sentinel-config-token",
      },
      consent: true,
    },
    installation: {
      resource_group_id: group,
      app_id: `${group}/providers/Microsoft.App/containerApps/actual-hub`,
      environment_id: `${group}/providers/Microsoft.App/managedEnvironments/actual-environment`,
      postgres_server_id: `${group}/providers/Microsoft.DBforPostgreSQL/flexibleServers/actual-database`,
      storage_account_id: `${group}/providers/Microsoft.Storage/storageAccounts/actualartifacts`,
      resource_group: "actual-app-group",
      storage_account: "actualartifacts",
      postgres_host: "test-hub-postgres.postgres.database.azure.com",
      url: "https://hub.example.com",
      postgres_admin_password: "secret-sentinel-admin-password",
      runtime_database_url: "postgresql://runtime:secret-sentinel-runtime@database.example/hub",
      owner: "owner-not-for-the-receipt",
    },
    foundation: {
      registry_id: `${foundation}/providers/Microsoft.ContainerRegistry/registries/actualregistry`,
      registry_url: "actualregistry.azurecr.io",
      vault_id: `${foundation}/providers/Microsoft.KeyVault/vaults/actualvault`,
      vault_url: "https://actualvault.vault.azure.net/",
      credentials: { password: "secret-sentinel-foundation-password" },
    },
    stateStorageId: `/subscriptions/${subscriptionId}/resourceGroups/actual-state-group/providers/Microsoft.Storage/storageAccounts/actualstate`,
    image: `actualregistry.azurecr.io/replica-hub@sha256:${"b".repeat(64)}`,
    env: { ARM_CLIENT_SECRET: "secret-sentinel-env-password" },
    raw: { input: "secret-sentinel-raw-input" },
  }
}

it("returns only the approved release identity and authoritative resource coordinates", () => {
  const source = input()

  const result = deploymentResult(source)

  expect(result).toEqual({
    name: source.config.name,
    url: source.installation.url,
    subscriptionId: source.config.azure.subscriptionId,
    tenantId: source.config.azure.tenantId,
    location: source.config.azure.location,
    image: source.image,
    resources: {
      resourceGroup: source.installation.resource_group_id,
      app: source.installation.app_id,
      environment: source.installation.environment_id,
      database: source.installation.postgres_server_id,
      storage: source.installation.storage_account_id,
      registry: source.foundation.registry_id,
      vault: source.foundation.vault_id,
      stateStorage: source.stateStorageId,
    },
  })
  expect(JSON.stringify(result)).not.toContain("secret-sentinel")
  expect(result).not.toHaveProperty("owner")
  expect(result).not.toHaveProperty("consent")
})

it("matches subscription and resource ID casing without changing authoritative resource spelling", () => {
  const source = input()
  const previousSubscription = source.config.azure.subscriptionId
  const subscriptionId = "abcdefab-1234-5678-90ab-cdefabcdef12"
  source.config.azure.subscriptionId = subscriptionId
  const authoritativeId = (id: string) =>
    id
      .replace(previousSubscription, subscriptionId.toUpperCase())
      .replace("/subscriptions/", "/SUBSCRIPTIONS/")
      .replace("/resourceGroups/", "/RESOURCEGROUPS/")
  for (const field of [
    "resource_group_id",
    "app_id",
    "environment_id",
    "postgres_server_id",
    "storage_account_id",
  ] as const)
    source.installation[field] = authoritativeId(source.installation[field])
  for (const field of ["registry_id", "vault_id"] as const)
    source.foundation[field] = authoritativeId(source.foundation[field])
  source.stateStorageId = authoritativeId(source.stateStorageId)

  const result = deploymentResult(source)

  expect(result.subscriptionId).toBe(subscriptionId)
  expect(result.resources).toEqual({
    resourceGroup: source.installation.resource_group_id,
    app: source.installation.app_id,
    environment: source.installation.environment_id,
    database: source.installation.postgres_server_id,
    storage: source.installation.storage_account_id,
    registry: source.foundation.registry_id,
    vault: source.foundation.vault_id,
    stateStorage: source.stateStorageId,
  })
})

it.each([
  "http://hub.example.com",
  "https://operator:secret-sentinel@hub.example.com",
  "https://secret-sentinel@hub.example.com",
  "https://hub.example.com/?token=secret-sentinel",
  "https://hub.example.com/#secret-sentinel",
  "https://hub.example.com/\nsecret-sentinel",
  "https://hub.example.com/\u001bsecret-sentinel",
])("rejects an unsafe service URL without echoing it: %j", (url) => {
  const source = input()
  source.installation.url = url

  expect(() => deploymentResult(source)).toThrow(Error)
  try {
    deploymentResult(source)
  } catch (error) {
    expect((error as Error).message).not.toContain(url)
    expect((error as Error).message).not.toContain("secret-sentinel")
  }
})

it.each([
  "resource_group_id",
  "app_id",
  "environment_id",
  "postgres_server_id",
  "storage_account_id",
] as const)("requires final installation resource metadata for %s", (field) => {
  const source = input()
  Reflect.deleteProperty(source.installation, field)

  expect(() => deploymentResult(source)).toThrow(Error)
})

it.each(["registry_id", "vault_id"] as const)("requires foundation metadata for %s", (field) => {
  const source = input()
  Reflect.deleteProperty(source.foundation, field)

  expect(() => deploymentResult(source)).toThrow(Error)
})

it("requires the verified state storage resource ID", () => {
  const source = input()
  source.stateStorageId = ""

  expect(() => deploymentResult(source)).toThrow(Error)
})

it.each([
  "/subscriptions/00000000-0000-0000-0000-000000000099/resourceGroups/foreign/providers/Microsoft.App/containerApps/hub",
  "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/group/providers/Microsoft.App/containerApps",
  "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/group/providers/Microsoft.App/containerApps/",
  "https://management.azure.com/secret-sentinel",
  "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/group/providers/Microsoft.App/containerApps/hub\nsecret-sentinel",
])("rejects incomplete or off-target resource coordinates without echoing them: %j", (id) => {
  const source = input()
  source.installation.app_id = id

  expect(() => deploymentResult(source)).toThrow(Error)
  try {
    deploymentResult(source)
  } catch (error) {
    expect((error as Error).message).not.toContain(id)
    expect((error as Error).message).not.toContain("secret-sentinel")
  }
})
