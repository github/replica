import { describe, expect, it, vi } from "vitest"

import { ConflictingRoleAssignment, existingRoleAssignment } from "./index.ts"

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
    expect(azure).toHaveBeenCalledExactlyOnceWith(
      "role",
      "assignment",
      "list",
      "--scope",
      scope,
      "--include-inherited",
    )
  })

  it("finds a case-variant role ID without losing it to Azure CLI's case-sensitive role filter", async () => {
    const name = "Storage Blob Data Contributor"
    const records = [
      {
        ...assignment,
        roleDefinitionId: assignment.roleDefinitionId.toUpperCase(),
        roleDefinitionName: name,
      },
    ]
    const azure = vi.fn(async (...args: string[]) =>
      JSON.stringify(
        args.includes("--role")
          ? records.filter(({ roleDefinitionId }) => roleDefinitionId === assignment.roleDefinitionId)
          : records,
      ),
    )
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
      "--include-inherited",
    )
  })

  it("finds a trailing-slash scope without losing it to Azure CLI's exact-scope filter", async () => {
    const records = [{ ...assignment, scope: `${scope}/` }]
    const azure = vi.fn(async (...args: string[]) =>
      JSON.stringify(
        args.includes("--include-inherited")
          ? records
          : records.filter((record) => record.scope.toLowerCase() === scope.toLowerCase()),
      ),
    )

    await expect(existingRoleAssignment(azure, subscription)(change)).resolves.toBe(id)
  })

  it.each([
    {
      direction: "root to subscription",
      plannedPrefix: "",
      returnedPrefix: `/subscriptions/${subscription}`,
    },
    {
      direction: "subscription to root",
      plannedPrefix: `/subscriptions/${subscription}`,
      returnedPrefix: "",
    },
  ])(
    "matches equivalent Secrets User IDs from $direction",
    async ({ plannedPrefix, returnedPrefix }) => {
      const rolePath =
        "/providers/Microsoft.Authorization/roleDefinitions/4633458b-17de-408a-b874-0445c86b69e6"
      const planned = {
        ...change,
        after: {
          scope,
          principal_id: principal,
          role_definition_id: `${plannedPrefix}${rolePath}`,
          role_definition_name: "Key Vault Secrets User",
        },
      }
      const azure = vi.fn(async () =>
        JSON.stringify([
          {
            ...assignment,
            roleDefinitionId: `${returnedPrefix}${rolePath}`,
            roleDefinitionName: "Key Vault Secrets User",
          },
        ]),
      )

      await expect(existingRoleAssignment(azure, subscription)(planned)).resolves.toBe(id)
    },
  )

  it("rejects a known Secrets User UUID from another subscription instead of treating it as a nonmatch", async () => {
    const planned = {
      ...change,
      after: { scope, principal_id: principal, role_definition_name: "Key Vault Secrets User" },
    }
    const azure = vi.fn(async () =>
      JSON.stringify([
        {
          ...assignment,
          roleDefinitionId: "/subscriptions/55555555-5555-4555-8555-555555555555/providers/Microsoft.Authorization/roleDefinitions/4633458b-17de-408a-b874-0445c86b69e6",
          roleDefinitionName: "Key Vault Administrator",
        },
      ]),
    )

    await expect(existingRoleAssignment(azure, subscription)(planned)).rejects.toThrow()
  })

  it.each([
    {
      outcome: "matches an alternate built-in ID without a returned name",
      returnedName: undefined,
      accepted: true,
    },
    {
      outcome: "rejects a known built-in ID with a conflicting returned name",
      returnedName: "Key Vault Administrator",
      accepted: false,
    },
  ])("$outcome for an ID-only plan", async ({ returnedName, accepted }) => {
    const rolePath =
      "/providers/Microsoft.Authorization/roleDefinitions/4633458b-17de-408a-b874-0445c86b69e6"
    const planned = {
      ...change,
      after: { scope, principal_id: principal, role_definition_id: rolePath },
    }
    const azure = vi.fn(async () =>
      JSON.stringify([
        {
          ...assignment,
          roleDefinitionId: `/subscriptions/${subscription}${rolePath}`,
          roleDefinitionName: returnedName,
        },
      ]),
    )

    const result = existingRoleAssignment(azure, subscription)(planned)
    if (accepted) await expect(result).resolves.toBe(id)
    else await expect(result).rejects.toThrow()
  })

  it("rejects a planned built-in ID with a conflicting name even when Azure returns no assignments", async () => {
    const planned = {
      ...change,
      after: {
        scope,
        principal_id: principal,
        role_definition_id:
          "/providers/Microsoft.Authorization/roleDefinitions/4633458b-17de-408a-b874-0445c86b69e6",
        role_definition_name: "Key Vault Administrator",
      },
    }
    const azure = vi.fn(async () => "[]")

    await expect(existingRoleAssignment(azure, subscription)(planned)).rejects.toThrow()
  })

  it.each([
    {
      conflict: "different ID with a matching name",
      returnedId: `/subscriptions/${subscription}/providers/Microsoft.Authorization/roleDefinitions/44444444-4444-4444-8444-444444444444`,
      returnedName: "Storage Blob Data Contributor",
    },
    {
      conflict: "different ID with a missing name",
      returnedId: `/subscriptions/${subscription}/providers/Microsoft.Authorization/roleDefinitions/44444444-4444-4444-8444-444444444444`,
      returnedName: undefined,
    },
    {
      conflict: "matching ID with a conflicting name",
      returnedId: assignment.roleDefinitionId,
      returnedName: "Storage Blob Data Reader",
    },
  ])(
    "rejects a $conflict when the plan supplies both",
    async ({ returnedId, returnedName }) => {
      const name = "Storage Blob Data Contributor"
      const planned = {
        ...change,
        after: { ...change.after, role_definition_name: name },
      }
      const azure = vi.fn(async () =>
        JSON.stringify([
          {
            ...assignment,
            roleDefinitionId: returnedId,
            roleDefinitionName: returnedName,
          },
        ]),
      )

      await expect(existingRoleAssignment(azure, subscription)(planned)).rejects.toThrow()
    },
  )

  it.each([
    {
      conflict: "Secrets User ID with Administrator name",
      returnedRole: "4633458b-17de-408a-b874-0445c86b69e6",
      returnedName: "Key Vault Administrator",
    },
    {
      conflict: "Administrator ID with Secrets User name",
      returnedRole: "00482a5a-887f-4fb3-b363-3b7fe8e74483",
      returnedName: "Key Vault Secrets User",
    },
    {
      conflict: "missing role ID with Secrets User name",
      returnedRole: undefined,
      returnedName: "Key Vault Secrets User",
    },
  ])(
    "rejects $conflict for a name-only Secrets User plan",
    async ({ returnedRole, returnedName }) => {
      const planned = {
        ...change,
        after: { scope, principal_id: principal, role_definition_name: "Key Vault Secrets User" },
      }
      const azure = vi.fn(async () =>
        JSON.stringify([
          {
            ...assignment,
            roleDefinitionId:
              returnedRole === undefined
                ? undefined
                : `/subscriptions/${subscription}/providers/Microsoft.Authorization/roleDefinitions/${returnedRole}`,
            roleDefinitionName: returnedName,
          },
        ]),
      )

      await expect(existingRoleAssignment(azure, subscription)(planned)).rejects.toThrow()
    },
  )

  it("proves a complete Administrator grant is a nonmatch for a name-only Secrets User plan", async () => {
    const planned = {
      ...change,
      after: { scope, principal_id: principal, role_definition_name: "Key Vault Secrets User" },
    }
    const azure = vi.fn(async () =>
      JSON.stringify([
        {
          ...assignment,
          roleDefinitionId: `/subscriptions/${subscription}/providers/Microsoft.Authorization/roleDefinitions/00482a5a-887f-4fb3-b363-3b7fe8e74483`,
          roleDefinitionName: "Key Vault Administrator",
        },
      ]),
    )

    await expect(existingRoleAssignment(azure, subscription)(planned)).resolves.toBeUndefined()
  })

  it.each([
    ["another principal", { principalId: "33333333-3333-4333-8333-333333333333" }],
    [
      "an inherited scope",
      {
        scope: `/subscriptions/${subscription}/resourceGroups/hub`,
        id: `/subscriptions/${subscription}/resourceGroups/hub/providers/Microsoft.Authorization/roleAssignments/22222222-2222-4222-8222-222222222222`,
      },
    ],
    [
      "a management-group scope",
      {
        scope: "/providers/Microsoft.Management/managementGroups/sample-team",
        id: "/providers/Microsoft.Management/managementGroups/sample-team/providers/Microsoft.Authorization/roleAssignments/22222222-2222-4222-8222-222222222222",
      },
    ],
  ])("ignores missing role metadata for a grant to %s", async (_, override) => {
    const azure = vi.fn(async () =>
      JSON.stringify([{ ...assignment, ...override, roleDefinitionId: undefined }]),
    )

    await expect(existingRoleAssignment(azure, subscription)(change)).resolves.toBeUndefined()
  })

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
    [
      "an inherited-looking scope contradicting its exact-scope assignment ID",
      { scope: `/subscriptions/${subscription}/resourceGroups/hub` },
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

  describe("with an ABAC condition", () => {
    const condition = "(\n  (\n    !(ActionMatches{'Microsoft.Storage/storageAccounts/blobServices/containers/blobs/read'} AND SubOperationMatches{'Blob.List'})\n  )\n)"
    const conditioned = { ...change, after: { ...change.after, condition, condition_version: "2.0" } }

    it("finds a grant with the same condition and version", async () => {
      const azure = vi.fn(async () =>
        JSON.stringify([{ ...assignment, condition: condition.replace(/\s+/g, " "), conditionVersion: "2.0" }]),
      )

      await expect(existingRoleAssignment(azure, subscription)(conditioned)).resolves.toBe(id)
    })

    it.each([
      ["no condition", { condition: null, conditionVersion: null }],
      ["another condition version", { condition, conditionVersion: "1.0" }],
    ])("refuses to import a grant with %s", async (_, override) => {
      const azure = vi.fn(async () => JSON.stringify([{ ...assignment, ...override }]))

      await expect(existingRoleAssignment(azure, subscription)(conditioned)).rejects.toBeInstanceOf(
        ConflictingRoleAssignment,
      )
    })

    it("refuses to import a conditioned grant for an unconditioned plan", async () => {
      const azure = vi.fn(async () => JSON.stringify([{ ...assignment, condition, conditionVersion: "2.0" }]))

      await expect(existingRoleAssignment(azure, subscription)(change)).rejects.toBeInstanceOf(
        ConflictingRoleAssignment,
      )
    })
  })
})
