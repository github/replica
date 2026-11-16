import { expect, it, vi } from "vitest"
import type { DeploymentConfig } from "../../../installer/types.ts"
import { removalInventory } from "./index.ts"

function fixture() {
  const config: DeploymentConfig = {
    version: 1,
    cloud: "azure",
    name: "sample-hub",
    owner: "sample-team",
    azure: {
      tenantId: "00000000-0000-0000-0000-000000000001",
      subscriptionId: "00000000-0000-0000-0000-000000000002",
      location: "eastus2",
      resourceGroup: "sample-hub-rg",
    },
  }
  const azure = vi.fn(async () => {
    throw new Error("Unexpected cloud lookup")
  })
  const group = `/subscriptions/${config.azure.subscriptionId}/resourceGroups/${config.azure.resourceGroup}`
  return { config, azure, group }
}

it("reports untracked group members without cloud-wide discovery and recognizes tracked container ARM aliases", async () => {
  const context = fixture()
  const account = `${context.group}/providers/Microsoft.Storage/storageAccounts/samplehubhub`
  const id = `${context.group}/providers/Microsoft.App/jobs/probe`
  const groups = new Map([
    [
      context.config.azure.resourceGroup,
      [
        { id, type: "Microsoft.App/jobs" },
        {
          id: `${account}/blobServices/default/containers/artifacts`,
          type: "Microsoft.Storage/storageAccounts/blobServices/containers",
        },
      ],
    ],
  ])
  const result = await removalInventory(
    context,
    [
      {
        address: "azurerm_storage_container.artifacts",
        type: "azurerm_storage_container",
        id: "https://samplehubhub.blob.core.windows.net/artifacts",
        values: { name: "artifacts" },
      },
    ],
    groups,
  )
  expect(result).toEqual([
    {
      id,
      type: "Microsoft.App/jobs",
      group: context.config.azure.resourceGroup,
    },
  ])
  expect(context.azure).not.toHaveBeenCalled()
})

it("refuses a tracked parent deletion that would also remove an untracked nested resource", async () => {
  const context = fixture()
  const id = `${context.group}/providers/Microsoft.Storage/storageAccounts/samplehubhub`
  const groups = new Map([
    [
      context.config.azure.resourceGroup,
      [
        {
          id: `${id}/queueServices/default/queues/untracked`,
          type: "Microsoft.Storage/storageAccounts/queueServices/queues",
        },
      ],
    ],
  ])
  await expect(
    removalInventory(
      context,
      [
        {
          address: "azurerm_storage_account.artifacts",
          type: "azurerm_storage_account",
          id,
          values: {},
        },
      ],
      groups,
    ),
  ).rejects.toThrow(/inside a tracked resource/)
  expect(context.azure).not.toHaveBeenCalled()
})

it.each(["foreign group", "foreign subscription", "undeclared group"] as const)(
  "rejects inventory from a %s before performing any resource lookup",
  async (boundary) => {
    const context = fixture()
    let group = context.config.azure.resourceGroup
    let id = `${context.group}/providers/Microsoft.Storage/storageAccounts/diagnostics`
    if (boundary === "foreign group")
      id = id.replace(context.config.azure.resourceGroup, "external-group")
    if (boundary === "foreign subscription")
      id = id.replace(context.config.azure.subscriptionId, context.config.azure.tenantId)
    if (boundary === "undeclared group") {
      group = "external-group"
      id = id.replace(context.config.azure.resourceGroup, group)
    }

    await expect(
      removalInventory(
        context,
        [],
        new Map([[group, [{ id, type: "Microsoft.Storage/storageAccounts" }]]]),
      ),
    ).rejects.toThrow(/scope|group|identity|installation/i)
    expect(context.azure).not.toHaveBeenCalled()
  },
)

it.each(["azurerm_storage_container", "azurerm_storage_blob"] as const)(
  "rejects a %s URL unless its backing account is in the selected app-group inventory",
  async (type) => {
    const context = fixture()
    const name = type === "azurerm_storage_container" ? "artifacts" : "releases/deployment.lock"
    const foreign = `${context.group.replace(context.config.azure.resourceGroup, "external-group")}/providers/Microsoft.Storage/storageAccounts/samplehubhub`

    await expect(
      removalInventory(
        context,
        [
          {
            address: `${type}.${type === "azurerm_storage_container" ? "artifacts" : "release_lock"}`,
            type,
            id: `https://samplehubhub.blob.core.windows.net/${name}`,
            values: {
              name,
              storage_account_id: foreign,
              storage_account_name: "samplehubhub",
            },
          },
        ],
        new Map([
          [
            context.config.azure.resourceGroup,
            [
              {
                id: foreign,
                type: "Microsoft.Storage/storageAccounts",
              },
            ],
          ],
        ]),
      ),
    ).rejects.toThrow(/storage.*installation group/i)
    expect(context.azure).not.toHaveBeenCalled()
  },
)
