import { describe, expect, it } from "vitest"

import { parseProviderKey, providerKeyMaxBytes, providerKeyMaxCharacters } from "."

describe("parseProviderKey()", () => {
  it.each([
    "secret:workforce",
    "GitHub.App/V2",
    "Entra:Tenant",
    "custom+adapter@example",
    "提供者",
  ])("preserves the opaque case-sensitive key %s", (key) => {
    expect(parseProviderKey(key)).toBe(key)
  })

  it("accepts exact character and UTF-8 byte boundaries", () => {
    expect(parseProviderKey("a".repeat(providerKeyMaxCharacters))).toHaveLength(
      providerKeyMaxCharacters,
    )
    expect(parseProviderKey("界".repeat(100))).toHaveLength(100)
    expect(Buffer.byteLength(parseProviderKey("𐍈".repeat(100)))).toBe(providerKeyMaxBytes)
  })

  it("rejects empty, overlong, control, malformed, and whitespace keys", () => {
    for (const key of [
      "",
      "a".repeat(101),
      "𐍈".repeat(101),
      "provider\0key",
      "provider\nkey",
      "provider key",
      "provider\u00a0key",
      "provider\ud800",
    ]) {
      expect(() => parseProviderKey(key)).toThrow()
    }
  })
})
