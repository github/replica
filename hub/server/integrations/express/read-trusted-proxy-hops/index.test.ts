import { describe, expect, it } from "vitest"

import { readTrustedProxyHops } from "#server/integrations/express/read-trusted-proxy-hops"

describe("readTrustedProxyHops()", () => {
  it("ignores forwarded client addresses unless an exact proxy count is configured", () => {
    expect(readTrustedProxyHops({})).toBe(0)
    expect(readTrustedProxyHops({ HUB_TRUSTED_PROXY_HOPS: "2" })).toBe(2)
  })

  it.each(["-1", "1.5", "11", "edge", " 1"])("rejects the invalid proxy count %s", (value) => {
    expect(() => readTrustedProxyHops({ HUB_TRUSTED_PROXY_HOPS: value })).toThrow(
      "HUB_TRUSTED_PROXY_HOPS",
    )
  })
})
