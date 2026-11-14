import { describe, expect, it, vi } from "vitest"

import { existingRoleAssignment } from "./index.ts"

const subscription = "00000000-0000-0000-0000-000000000001"
const scope = `/subscriptions/${subscription}/resourceGroups/hub/providers/Microsoft.Storage/storageAccounts/hub/blobServices/default/containers/artifacts`
const role = "ba92f5b4-2d11-453d-a403-e96b0029c9fe"
const principal = "11111111-1111-1111-1111-111111111111"
const id = `${scope}/providers/Microsoft.Authorization/roleAssignments/22222222-2222-2222-2222-222222222222`
const change = {
  address: "azurerm_role_assignment.artifacts",
  type: "azurerm_role_assignment",
  after: {
    scope,
    principal_id: principal,
    role_definition_id: `/subscriptions/${subscription}/providers/Microsoft.Authorization/roleDefinitions/${role}`,
  },
}
const assignment = {
  id,
  scope: scope.toUpperCase(),
  principalId: principal,
  roleDefinitionId: `/subscriptions/${subscription}/providers/Microsoft.Authorization/roleDefinitions/${role}`,
}

describe("existingRoleAssignment", () => {
  it("finds the exact grant with a read-only list", async () => {
    const azure = vi.fn(async () => JSON.stringify([assignment]))

    await expect(existingRoleAssignment(azure, subscription)(change)).resolves.toBe(id)
    expect(azure).toHaveBeenCalledExactlyOnceWith(
      "role",
      "assignment",
      "list",
      "--scope",
      scope,
      "--role",
      role,
    )
  })

  it.each([
    ["another principal", { principalId: "33333333-3333-3333-3333-333333333333" }],
    [
      "another role",
      {
        roleDefinitionId: "/providers/Microsoft.Authorization/roleDefinitions/other",
      },
    ],
    ["an inherited scope", { scope: `/subscriptions/${subscription}/resourceGroups/hub` }],
  ])("ignores a grant for %s", async (_, override) => {
    const azure = vi.fn(async () => JSON.stringify([{ ...assignment, ...override }]))

    await expect(existingRoleAssignment(azure, subscription)(change)).resolves.toBeUndefined()
  })

  it.each([
    [
      "another subscription",
      {
        ...change,
        after: { ...change.after, scope: scope.replace(subscription, "other") },
      },
    ],
    ["another resource type", { ...change, type: "azurerm_storage_account" }],
    ["an unknown principal", { ...change, after: { ...change.after, principal_id: undefined } }],
  ])("does not query Azure for %s", async (_, planned) => {
    const azure = vi.fn(async () => "[]")

    await expect(existingRoleAssignment(azure, subscription)(planned)).resolves.toBeUndefined()
    expect(azure).not.toHaveBeenCalled()
  })
})
