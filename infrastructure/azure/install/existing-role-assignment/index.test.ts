import { describe, expect, it, vi } from "vitest"

import { existingRoleAssignment } from "./index.ts"

const subscription = "00000000-0000-0000-0000-000000000001"
const scope = `/subscriptions/${subscription}/resourceGroups/hub/providers/Microsoft.Storage/storageAccounts/hub/blobServices/default/containers/artifacts`
const role = "ba92f5b4-2d11-453d-a403-e96b0029c9fe"
const principal = "11111111-1111-4111-8111-111111111111"
const id = `${scope}/providers/Microsoft.Authorization/roleAssignments/22222222-2222-4222-8222-222222222222`
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
    expect(azure).toHaveBeenCalledExactlyOnceWith("role", "assignment", "list", "--scope", scope)
  })

  it("matches a planned role name only when no role ID is planned", async () => {
    const name = "Storage Blob Data Contributor"
    const azure = vi.fn(async () => JSON.stringify([{ ...assignment, roleDefinitionName: name }]))
    const named = {
      ...change,
      after: { scope, principal_id: principal, role_definition_name: name },
    }

    await expect(existingRoleAssignment(azure, subscription)(named)).resolves.toBe(id)
    expect(azure).toHaveBeenCalledExactlyOnceWith(
      "role",
      "assignment",
      "list",
      "--scope",
      scope,
      "--role",
      name,
    )
  })

  it.each(["matching", "missing"] as const)(
    "rejects a different returned role ID with a %s name when the plan supplies both",
    async (returnedName) => {
      const name = "Storage Blob Data Contributor"
      const planned = {
        ...change,
        after: { ...change.after, role_definition_name: name },
      }
      const azure = vi.fn(async () =>
        JSON.stringify([
          {
            ...assignment,
            roleDefinitionId: `/subscriptions/${subscription}/providers/Microsoft.Authorization/roleDefinitions/44444444-4444-4444-8444-444444444444`,
            roleDefinitionName: returnedName === "matching" ? name : undefined,
          },
        ]),
      )

      await expect(existingRoleAssignment(azure, subscription)(planned)).rejects.toThrow()
    },
  )

  it.each([
    ["missing assignment ID", { id: undefined }, false],
    ["non-string assignment ID", { id: 42 }, true],
    ["empty assignment ID", { id: "" }, false],
    ["malformed assignment ID", { id: "not-an-assignment-resource-id" }, false],
    [
      "an assignment ID contradicting its scope",
      {
        id: `/subscriptions/${subscription}/resourceGroups/another-hub/providers/Microsoft.Authorization/roleAssignments/22222222-2222-4222-8222-222222222222`,
      },
      false,
    ],
    ["missing scope", { scope: undefined }, false],
    ["non-string scope", { scope: 42 }, true],
    ["malformed scope", { scope: "/subscriptions/not-a-subscription/resourceGroups/hub" }, true],
    ["missing principal", { principalId: undefined }, true],
    ["empty principal", { principalId: "" }, false],
    ["malformed principal", { principalId: "not-a-principal-id" }, false],
    ["missing role ID", { roleDefinitionId: undefined }, false],
    ["non-string role ID", { roleDefinitionId: 42 }, false],
    [
      "malformed role ID",
      { roleDefinitionId: "/providers/Microsoft.Authorization/roleDefinitions/not-a-role-id" },
      false,
    ],
    ["missing role name", { roleDefinitionName: undefined }, true],
    ["non-string role name", { roleDefinitionName: 42 }, true],
    ["empty role name", { roleDefinitionName: "" }, true],
  ] as const)("rejects an inconclusive list with %s", async (_, override, named) => {
    const name = "Storage Blob Data Contributor"
    const azure = vi.fn(async () =>
      JSON.stringify([{ ...assignment, roleDefinitionName: name, ...override }]),
    )
    const planned = named
      ? { ...change, after: { scope, principal_id: principal, role_definition_name: name } }
      : change

    await expect(existingRoleAssignment(azure, subscription)(planned)).rejects.toThrow()
  })

  it.each([
    ["a non-array result", { value: [assignment] }],
    ["an array used as a record", [[]]],
    ["an unidentifiable record before a complete match", [{}, assignment]],
    ["an unidentifiable record after a complete match", [assignment, {}]],
    [
      "a matching record without an ID before a complete match",
      [{ ...assignment, id: undefined }, assignment],
    ],
    [
      "multiple complete matches",
      [
        assignment,
        {
          ...assignment,
          id: `${scope}/providers/Microsoft.Authorization/roleAssignments/33333333-3333-4333-8333-333333333333`,
        },
      ],
    ],
  ])("rejects an inconclusive list containing %s", async (_, result) => {
    const azure = vi.fn(async () => JSON.stringify(result))

    await expect(existingRoleAssignment(azure, subscription)(change)).rejects.toThrow()
  })

  it("proves absence from a complete empty list", async () => {
    const azure = vi.fn(async () => "[]")

    await expect(existingRoleAssignment(azure, subscription)(change)).resolves.toBeUndefined()
    expect(azure).toHaveBeenCalledOnce()
  })

  it.each([
    ["another principal", { principalId: "33333333-3333-4333-8333-333333333333" }],
    [
      "another role",
      {
        roleDefinitionId:
          "/providers/Microsoft.Authorization/roleDefinitions/44444444-4444-4444-8444-444444444444",
      },
    ],
    [
      "the same role GUID at another definition scope",
      { roleDefinitionId: `/providers/Microsoft.Authorization/roleDefinitions/${role}` },
    ],
    [
      "a matching role name when the planned role ID differs",
      {
        roleDefinitionId: `/subscriptions/${subscription}/providers/Microsoft.Authorization/roleDefinitions/44444444-4444-4444-8444-444444444444`,
        roleDefinitionName: role,
      },
    ],
    [
      "an inherited scope",
      {
        scope: `/subscriptions/${subscription}/resourceGroups/hub`,
        id: `/subscriptions/${subscription}/resourceGroups/hub/providers/Microsoft.Authorization/roleAssignments/22222222-2222-4222-8222-222222222222`,
      },
    ],
  ])("ignores a grant for %s", async (_, override) => {
    const azure = vi.fn(async () => JSON.stringify([{ ...assignment, ...override }]))

    await expect(existingRoleAssignment(azure, subscription)(change)).resolves.toBeUndefined()
  })

  it.each([
    [
      "another subscription",
      {
        ...change,
        after: {
          ...change.after,
          scope: scope.replace(subscription, "55555555-5555-4555-8555-555555555555"),
        },
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
