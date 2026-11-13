import { expect, it } from "vitest"

import type { RemovalResource } from "../types.ts"
import { validateRemovalPlan } from "./index.ts"

function fixture() {
  const resource: RemovalResource = {
    address: "azurerm_resource_group.hub",
    type: "azurerm_resource_group",
    id: "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/sample-hub",
    values: {},
  }
  const change = {
    address: resource.address,
    change: { actions: ["delete"], before: { id: resource.id }, after: null },
  }
  return { resource, change, plan: { format_version: "1.0", resource_changes: [change] } }
}

it("permits only the approved address and case-insensitive Azure ID plus read-only changes", () => {
  const { resource, change } = fixture()
  change.change.before.id = resource.id.toUpperCase()
  expect(() =>
    validateRemovalPlan(
      {
        format_version: "1.0",
        resource_changes: [
          change,
          { address: "data.azurerm_client_config.current", change: { actions: ["read"] } },
          { address: resource.address, change: { actions: ["no-op"] } },
        ],
      },
      [resource],
    ),
  ).not.toThrow()
})

it("accepts an empty destroy plan for already removed resources", () => {
  expect(() =>
    validateRemovalPlan({ format_version: "1.0", resource_changes: [] }, []),
  ).not.toThrow()
})

it.each(["0.1", "2.0", undefined])(
  "rejects an unsupported or missing plan format %s",
  (format_version) => {
    expect(() => validateRemovalPlan({ format_version, resource_changes: [] }, [])).toThrow()
  },
)

it.each([["create"], ["update"], ["delete", "create"], ["create", "delete"], []])(
  "refuses destructive-plan actions %j outside an exact deletion",
  (...actions) => {
    const { resource, change, plan } = fixture()
    change.change.actions = actions
    expect(() => validateRemovalPlan(plan, [resource])).toThrow(/scope|identity|actions/i)
  },
)

it.each(["address", "id", "missing id"])(
  "blocks an approved deletion with a changed %s",
  (field) => {
    const { resource, change, plan } = fixture()
    if (field === "address") change.address = "azurerm_resource_group.other"
    if (field === "id") change.change.before.id = `${resource.id}-other`
    if (field === "missing id") Reflect.deleteProperty(change.change.before, "id")
    expect(() => validateRemovalPlan(plan, [resource])).toThrow()
  },
)

it.each(["scope", "principal_id", "role_definition_name"])(
  "blocks a refreshed role-assignment plan with a changed %s",
  (property) => {
    const resource: RemovalResource = {
      address: "azurerm_role_assignment.runtime_secrets[\"SERVICE_API_KEY\"]",
      type: "azurerm_role_assignment",
      id: "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/sample/providers/Microsoft.KeyVault/vaults/runtime/secrets/api-key/providers/Microsoft.Authorization/roleAssignments/00000000-0000-0000-0000-000000000004",
      values: {
        scope:
          "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/sample/providers/Microsoft.KeyVault/vaults/runtime/secrets/api-key",
        principal_id: "00000000-0000-0000-0000-000000000003",
        role_definition_name: "Key Vault Secrets User",
      },
    }
    const before = { id: resource.id, ...resource.values }
    if (property === "scope") before.scope += "-other"
    if (property === "principal_id") before.principal_id = "00000000-0000-0000-0000-000000000099"
    if (property === "role_definition_name") before.role_definition_name = "Owner"

    expect(() =>
      validateRemovalPlan(
        {
          format_version: "1.0",
          resource_changes: [
            {
              address: resource.address,
              change: { actions: ["delete"], before, after: null },
            },
          ],
        },
        [resource],
      ),
    ).toThrow(/scope|identity|actions/i)
  },
)

it.each([
  null,
  [],
  { format_version: "1.0", resource_changes: {} },
  { format_version: "1.0", resource_changes: [null] },
  {
    format_version: "1.0",
    resource_changes: [{ address: "azurerm_resource_group.hub", change: { actions: "delete" } }],
  },
])("rejects malformed plans before apply", (value) => {
  expect(() => validateRemovalPlan(value, [fixture().resource])).toThrow()
})
