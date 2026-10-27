import { describe, expect, it } from "vitest"

import { evaluatePrototypeAccess } from "#server/domains/prototype-authorization/evaluate-access"

describe("evaluatePrototypeAccess()", () => {
  it("uses a prototype role even when it restricts a stronger workspace role", () => {
    expect(
      evaluatePrototypeAccess({
        workspaceGrant: { effect: "allow", role: "administrator" },
        prototypeGrant: { effect: "allow", role: "viewer" },
        baselineRole: "editor",
      }),
    ).toEqual({
      allowed: true,
      role: "viewer",
      source: "hub-prototype",
      reason: "prototype_role",
    })
  })

  it.each([
    {
      name: "prototype deny",
      workspaceGrant: { effect: "allow", role: "administrator" } as const,
      prototypeGrant: { effect: "deny", role: null } as const,
      source: "hub-prototype",
    },
    {
      name: "workspace deny",
      workspaceGrant: { effect: "deny", role: null } as const,
      prototypeGrant: { effect: "allow", role: "administrator" } as const,
      source: "hub-workspace",
    },
  ])("lets an explicit $name override every allow source", (input) => {
    expect(
      evaluatePrototypeAccess({
        workspaceGrant: input.workspaceGrant,
        prototypeGrant: input.prototypeGrant,
        baselineRole: "administrator",
      }),
    ).toEqual({
      allowed: false,
      role: null,
      source: input.source,
      reason: "explicit_deny",
    })
  })

  it("orders workspace access before a future baseline", () => {
    expect(
      evaluatePrototypeAccess({
        workspaceGrant: { effect: "allow", role: "commenter" },
        baselineRole: "administrator",
      }),
    ).toEqual({
      allowed: true,
      role: "commenter",
      source: "hub-workspace",
      reason: "workspace_role",
    })

    expect(evaluatePrototypeAccess({ baselineRole: "editor" })).toEqual({
      allowed: true,
      role: "editor",
      source: "baseline",
      reason: "baseline_role",
    })
  })

  it("defaults to an explainable denial when no source grants access", () => {
    expect(evaluatePrototypeAccess({})).toEqual({
      allowed: false,
      role: null,
      source: "none",
      reason: "no_access",
    })
  })
})
