import { expect, it, vi } from "vitest"
import type { RemovalContext } from "../types.ts"
import { verifyRemovalIdentity } from "./index.ts"

const group = "/subscriptions/sub/resourceGroups/sample-rg"
const config = {
  name: "sample",
  azure: {
    subscriptionId: "sub",
    resourceGroup: "sample-rg",
    location: "westus3",
  },
} as unknown as RemovalContext["config"]
const identityId = `${group}/providers/Microsoft.ManagedIdentity/userAssignedIdentities/sample-provision`
const identity = {
  address: "azurerm_user_assigned_identity.provision",
  id: identityId,
  type: "azurerm_user_assigned_identity",
  values: { principal_id: "principal" },
}
const actualIdentity = {
  id: identityId,
  principalId: "PRINCIPAL",
  name: "sample-provision",
  resourceGroup: "SAMPLE-RG",
  location: "westus3",
}
const jobId = `${group}/providers/Microsoft.App/jobs/sample-provision`
const job = {
  address: "azurerm_container_app_job.provision",
  id: jobId,
  type: "azurerm_container_app_job",
  values: {},
}
const actualJob = {
  id: jobId,
  name: "sample-provision",
  resourceGroup: "sample-rg",
  environmentId: `${group}/providers/Microsoft.App/managedEnvironments/sample-environment`,
  identityIds: [identityId],
}
const azure = (value: unknown) => vi.fn(async () => JSON.stringify(value))

it("accepts tracked identities and provisioning jobs that still match the selected installation", async () => {
  await verifyRemovalIdentity({ config, azure: azure(actualIdentity) }, identity)
  await verifyRemovalIdentity({ config, azure: azure(actualJob) }, job)
})

it.each([{ principalId: "other" }, { location: "eastus" }, { name: "other-provision" }])(
  "rejects a provisioning identity that no longer matches: %j",
  async (change) => {
    await expect(
      verifyRemovalIdentity({ config, azure: azure({ ...actualIdentity, ...change }) }, identity),
    ).rejects.toThrow("Temporary provisioning identity no longer matches")
  },
)

it("rejects a workload identity whose principal changed", async () => {
  const workload = {
    ...identity,
    address: "azurerm_user_assigned_identity.hub",
  }
  await expect(
    verifyRemovalIdentity(
      { config, azure: azure({ ...actualIdentity, principalId: "other" }) },
      workload,
    ),
  ).rejects.toThrow("Workload identity no longer matches")
})

it.each([
  {
    identityIds: [
      identityId,
      `${group}/providers/Microsoft.ManagedIdentity/userAssignedIdentities/extra`,
    ],
  },
  {
    environmentId: `${group}/providers/Microsoft.App/managedEnvironments/other`,
  },
])("rejects a provisioning job that no longer matches: %j", async (change) => {
  await expect(
    verifyRemovalIdentity({ config, azure: azure({ ...actualJob, ...change }) }, job),
  ).rejects.toThrow("Temporary provisioning job no longer matches")
})

it("does not inspect other resource types", async () => {
  const read = azure({})
  await verifyRemovalIdentity(
    { config, azure: read },
    {
      address: "azurerm_key_vault.main",
      id: "kv",
      type: "azurerm_key_vault",
      values: {},
    },
  )
  expect(read).not.toHaveBeenCalled()
})
