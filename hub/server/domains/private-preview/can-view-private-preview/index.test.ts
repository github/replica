import { describe, expect, it } from "vitest"

import { canViewPrivatePreview } from "."

describe("canViewPrivatePreview()", () => {
  it.each([
    ["github", "MEMBER", false, true],
    ["entra", "ADMINISTRATOR", true, false],
    ["local", "ADMINISTRATOR", false, false],
    ["local", "MEMBER", true, false],
    ["local", "ADMINISTRATOR", true, true],
  ] as const)(
    "applies the same eligibility to %s %s with local sign-in configured: %s",
    (sessionProvider, role, localSignIn, eligible) => {
      expect(canViewPrivatePreview({ sessionProvider, role }, localSignIn)).toBe(eligible)
    },
  )
})
