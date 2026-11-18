import { describe, expect, it } from "vitest"

import { resolveRepositoryScope } from "./index.ts"

const member = {
  membershipId: "00000000-0000-4000-8000-000000000001",
  provider: "entra",
  sessionProvider: "github",
  role: "MEMBER" as const,
}

describe("resolveRepositoryScope", () => {
  it("scopes a GitHub member when an App installation is connected", () => {
    expect(resolveRepositoryScope(member, true)).toEqual({ membershipId: member.membershipId })
  })

  it("scopes a member whose session provider is unknown", () => {
    expect(resolveRepositoryScope({ ...member, sessionProvider: null }, true)).toEqual({
      membershipId: member.membershipId,
    })
  })

  it.each([
    ["an administrator", { ...member, role: "ADMINISTRATOR" as const }],
    [
      "an administrator with an unknown session provider",
      { ...member, role: "ADMINISTRATOR" as const, sessionProvider: null },
    ],
    [
      "a member who signed in with another provider",
      { ...member, provider: "github", sessionProvider: "entra" },
    ],
  ])("limits %s to identified repositories without requiring a grant", (_case, viewer) => {
    expect(resolveRepositoryScope(viewer, true)).toEqual({})
  })

  it.each([
    ["a GitHub member", member],
    ["an administrator", { ...member, role: "ADMINISTRATOR" as const }],
    ["another provider's member", { ...member, sessionProvider: "entra" }],
  ])("does not restrict %s when repository scoping is disabled", (_case, viewer) => {
    expect(resolveRepositoryScope(viewer, false)).toBeNull()
  })
})
