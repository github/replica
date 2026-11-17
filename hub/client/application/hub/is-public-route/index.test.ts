import { describe, expect, it } from "vitest"

import { isPublicRoute } from "."

describe("isPublicRoute()", () => {
  it.each(["/", "/admin-enrollment", "/shared/opaque-link"])(
    "keeps %s available without a Hub session",
    (pathname) => {
      expect(isPublicRoute(new Request(`https://hub.example.com${pathname}`))).toBe(true)
    },
  )

  it("keeps repository routes private", () => {
    expect(
      isPublicRoute(new Request("https://hub.example.com/repositories/repository-id")),
    ).toBe(false)
  })
})
