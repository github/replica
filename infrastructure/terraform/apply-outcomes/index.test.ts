import { describe, expect, it } from "vitest"

import { applyOutcomes } from "./index.ts"

const block = (address: string, body: string) =>
  `\u2502 Error: ${body}\n\u2502 \n\u2502   with ${address},\n\u2502   on main.tf line 1, in resource:\n`

describe("applyOutcomes", () => {
  it("separates a lost write response from storage DNS failures in the same apply", () => {
    const details = [
      block(
        "azurerm_role_assignment.artifacts",
        'creating Role Assignment: PUT "https://management.azure.com/subscriptions/x/providers/Microsoft.Authorization/roleAssignments/y": read tcp 10.0.0.1:1->10.0.0.2:443: read: connection reset by peer',
      ),
      block(
        "azurerm_storage_container.artifacts",
        "retrieving Container: dial tcp: lookup hub.blob.core.windows.net: no such host",
      ),
    ].join("\n")

    expect(applyOutcomes(details)).toEqual([
      { address: "azurerm_role_assignment.artifacts", kind: "ambiguous-write" },
      { address: "azurerm_storage_container.artifacts", kind: "connectivity" },
    ])
  })

  it.each([
    ["AuthorizationFailed: unexpected status 403", "permission"],
    ["creating Role Assignment: RoleAssignmentExists: unexpected status 409", "exists"],
    ["updating Storage Account: ScopeLocked: unexpected status 409", "conflict"],
    ["creating Container App: AnotherOperationInProgress: status code 409", "conflict"],
    ["creating Role Assignment: dial tcp 1.2.3.4:443: connection refused", "connectivity"],
    ["reading Container: read: connection reset by peer", "connectivity"],
    ["Failed to save state: connection reset by peer", "state-not-saved"],
    ["Invalid value for variable", "unknown"],
  ] as const)("classifies %s as %s", (body, kind) => {
    expect(applyOutcomes(block("azurerm_role_assignment.artifacts", body))).toEqual([
      { address: "azurerm_role_assignment.artifacts", kind },
    ])
  })

  it("treats missing or truncated details as unknown", () => {
    expect(applyOutcomes(undefined)).toEqual([{ kind: "unknown" }])
    expect(
      applyOutcomes(`${block("a.b", "connection reset")}\nError details truncated after 64 KiB.`),
    ).toEqual([{ kind: "unknown" }])
  })
})
