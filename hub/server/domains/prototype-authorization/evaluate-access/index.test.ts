import { describe, expect, it } from "vitest"

import { evaluatePrototypeAccess } from "#server/domains/prototype-authorization/evaluate-access"

const baseline = {
  role: "editor" as const,
  repositorySourceId: "repository-source",
  githubRepositoryId: "123",
  rawPermission: "write",
  confirmedAt: new Date("2026-10-27T20:00:00.000Z"),
  synchronizationStatus: "current",
}

describe("evaluatePrototypeAccess()", () => {
  it("uses a prototype role even when it restricts a stronger workspace role", () => {
    expect(
      evaluatePrototypeAccess({
        workspaceGrant: { effect: "allow", role: "administrator" },
        prototypeGrant: { effect: "allow", role: "viewer" },
        baseline,
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
        baseline: { ...baseline, role: "administrator" },
      }),
    ).toEqual({
      allowed: false,
      role: null,
      source: input.source,
      reason: "explicit_deny",
    })
  })

  it("orders a prototype role before a workspace role before the GitHub baseline", () => {
    expect(
      evaluatePrototypeAccess({
        prototypeGrant: { effect: "allow", role: "viewer" },
        workspaceGrant: { effect: "allow", role: "commenter" },
        baseline,
      }),
    ).toEqual({
      allowed: true,
      role: "viewer",
      source: "hub-prototype",
      reason: "prototype_role",
    })

    expect(
      evaluatePrototypeAccess({
        workspaceGrant: { effect: "allow", role: "commenter" },
        baseline: { ...baseline, role: "administrator" },
      }),
    ).toEqual({
      allowed: true,
      role: "commenter",
      source: "hub-workspace",
      reason: "workspace_role",
    })

    expect(evaluatePrototypeAccess({ baseline })).toEqual({
      allowed: true,
      role: "editor",
      source: "github-synchronized",
      reason: "github_baseline",
      baseline: {
        repositorySourceId: "repository-source",
        githubRepositoryId: "123",
        rawPermission: "write",
        confirmedAt: new Date("2026-10-27T20:00:00.000Z"),
        synchronizationStatus: "current",
      },
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
