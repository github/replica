import { describe, expect, it } from "vitest"

import { mapGitHubPermission } from "#server/domains/github-authorization/map-permission"

describe("mapGitHubPermission()", () => {
  it.each([
    ["admin", "editor"],
    ["maintain", "editor"],
    ["write", "editor"],
    ["triage", "commenter"],
    ["read", "viewer"],
  ] as const)("maps %s access to an admission-eligible %s role", (permission, prototypeRole) => {
    expect(mapGitHubPermission(permission)).toEqual({
      admissionEligible: true,
      prototypeRole,
    })
  })

  it("denies admission and prototype access when GitHub reports no permission", () => {
    expect(mapGitHubPermission("none")).toEqual({
      admissionEligible: false,
      prototypeRole: null,
    })
  })
})
