import { describe, expect, it } from "vitest"

import { isAuthenticationRoute } from "."

describe("isAuthenticationRoute()", () => {
  it("allows the GitHub setup page before sign-in without opening other settings routes", () => {
    expect(isAuthenticationRoute(new Request("https://hub.test/settings/github/setup"))).toBe(true)
    expect(isAuthenticationRoute(new Request("https://hub.test/settings/administrators"))).toBe(
      false,
    )
  })
})
