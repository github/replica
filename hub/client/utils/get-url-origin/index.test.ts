import { describe, expect, it } from "vitest"

import { getUrlOrigin } from "."

describe("getUrlOrigin()", () => {
  it("uses the Hub origin for canonical preview URLs", () => {
    const url = new URL("https://hub.example.test/previews/github/123/456/settings?q=one#details")
    expect(getUrlOrigin(url.toString())).toBe("https://hub.example.test")
  })

  it("rejects missing and malformed addresses", () => {
    expect(getUrlOrigin(undefined)).toBeNull()
    expect(getUrlOrigin("not a URL")).toBeNull()
  })
})
