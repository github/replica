import { describe, expect, it } from "vitest"

import { resolveRepositoryScope } from "./index.ts"

const member = {
  membershipId: "00000000-0000-4000-8000-000000000001",
  provider: "github",
  role: "MEMBER" as const,
}

describe("resolveRepositoryScope", () => {
  it("scopes a GitHub member when an App installation is connected", () => {
    expect(resolveRepositoryScope(member, true)).toEqual({ membershipId: member.membershipId })
  })

  it.each([
    ["no installation is connected", member, false],
    ["the viewer is an administrator", { ...member, role: "ADMINISTRATOR" as const }, true],
    ["the viewer signed in with another provider", { ...member, provider: "entra" }, true],
  ])("shows every repository when %s", (_case, viewer, scoped) => {
    expect(resolveRepositoryScope(viewer, scoped)).toBeNull()
  })
})
