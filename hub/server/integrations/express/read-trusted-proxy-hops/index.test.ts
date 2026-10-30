import { describe, expect, it } from "vitest"

import { readTrustedProxyHops } from "."

describe("readTrustedProxyHops()", () => {
  it("ignores forwarded addresses by default and accepts only a bounded exact hop count", () => {
    expect(readTrustedProxyHops(undefined)).toBe(0)
    expect(readTrustedProxyHops("2")).toBe(2)
    expect(() => readTrustedProxyHops("-1")).toThrow()
    expect(() => readTrustedProxyHops("11")).toThrow()
    expect(() => readTrustedProxyHops("all")).toThrow()
  })
})
