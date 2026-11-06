import { expect, it } from "vitest"

import type { DeploymentResult } from "../../azure/install/types.ts"
import { formatDeploymentSummary } from "./index.ts"

function receipt(): DeploymentResult {
  const subscriptionId = "00000000-0000-0000-0000-000000000001"
  const group = `/subscriptions/${subscriptionId}/resourceGroups/actual-app-group`
  const foundation = `/subscriptions/${subscriptionId}/resourceGroups/actual-foundation-group`
  return {
    name: "test-hub",
    url: "https://hub.example.com",
    subscriptionId,
    tenantId: "00000000-0000-0000-0000-000000000002",
    location: "eastus2",
    image: `actualregistry.azurecr.io/replica-hub@sha256:${"c".repeat(64)}`,
    resources: {
      resourceGroup: group,
      app: `${group}/providers/Microsoft.App/containerApps/actual-hub`,
      environment: `${group}/providers/Microsoft.App/managedEnvironments/actual-environment`,
      database: `${group}/providers/Microsoft.DBforPostgreSQL/flexibleServers/actual-database`,
      storage: `${group}/providers/Microsoft.Storage/storageAccounts/actualartifacts`,
      registry: `${foundation}/providers/Microsoft.ContainerRegistry/registries/actualregistry`,
      vault: `${foundation}/providers/Microsoft.KeyVault/vaults/actualvault`,
      stateStorage: `/subscriptions/${subscriptionId}/resourceGroups/actual-state-group/providers/Microsoft.Storage/storageAccounts/actualstate`,
    },
  }
}

it("provides the service, target, immutable release image, configuration and all eight resource links", () => {
  const result = receipt()
  const configurationPath = "infrastructure/.local/test-hub.json"

  const summary = formatDeploymentSummary(result, configurationPath)

  for (const value of [
    result.url,
    result.name,
    result.subscriptionId,
    result.tenantId,
    result.location,
    result.image,
    configurationPath,
  ])
    expect(summary).toContain(value)
  for (const id of Object.values(result.resources)) {
    expect(summary).toContain(id.split("/").at(-1))
    const portalLink = `https://portal.azure.com/#@${result.tenantId}/resource${id
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`
    expect(summary).toContain(portalLink)
  }
  expect(summary).toMatch(/readiness/i)
  expect(summary).toMatch(/sign-in/i)
  expect(summary).toMatch(/authoriz/i)
})

it("preserves actual resource IDs and encodes portal route segments instead of guessing names", () => {
  const result = receipt()
  const actualGroup = `/subscriptions/${result.subscriptionId}/resourceGroups/Shared Group`
  result.resources.resourceGroup = actualGroup
  result.resources.database = `${actualGroup}/providers/Microsoft.DBforPostgreSQL/flexibleServers/db#one%2Ftwo`

  const summary = formatDeploymentSummary(result, "config/installation.json")

  expect(summary).toContain(
    `https://portal.azure.com/#@${result.tenantId}/resource/subscriptions/${result.subscriptionId}/resourceGroups/Shared%20Group`,
  )
  expect(summary).toContain(
    `https://portal.azure.com/#@${result.tenantId}/resource/subscriptions/${result.subscriptionId}/resourceGroups/Shared%20Group/providers/Microsoft.DBforPostgreSQL/flexibleServers/db%23one%252Ftwo`,
  )
})

it("does not format secret-bearing extra fields, owner or deployment consent", () => {
  const result = {
    ...receipt(),
    owner: "secret-sentinel-owner",
    consent: "secret-sentinel-consent",
    credentials: { password: "secret-sentinel-password" },
    config: { npmRegistry: "https://secret-sentinel:password@proxy.example" },
    env: { ARM_CLIENT_SECRET: "secret-sentinel-env" },
    resources: {
      ...receipt().resources,
      databaseUrl: "postgresql://runtime:secret-sentinel@database/hub",
    },
  }

  expect(formatDeploymentSummary(result, "config/installation.json")).not.toContain(
    "secret-sentinel",
  )
})
