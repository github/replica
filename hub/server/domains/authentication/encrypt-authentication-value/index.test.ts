import { describe, expect, it } from "vitest"

import { decryptAuthenticationValue } from "../decrypt-authentication-value"
import { encryptAuthenticationValue } from "."

describe("encryptAuthenticationValue()", () => {
  it("roundtrips a bounded value with the versioned format", () => {
    const key = Buffer.alloc(32, 1)
    const encrypted = encryptAuthenticationValue("secret-value", key)

    expect(encrypted).toMatch(/^v1\./)
    expect(decryptAuthenticationValue(encrypted, key)).toBe("secret-value")
  })

  it("rejects an empty value", () => {
    const key = Buffer.alloc(32, 1)

    expect(() => encryptAuthenticationValue("", key)).toThrow("between 1 and 256 bytes")
  })

  it("rejects a value larger than 256 bytes", () => {
    const key = Buffer.alloc(32, 1)

    expect(() => encryptAuthenticationValue("x".repeat(257), key)).toThrow(
      "between 1 and 256 bytes",
    )
  })

  it("rejects a key that is not 32 bytes", () => {
    expect(() => encryptAuthenticationValue("secret", Buffer.alloc(31))).toThrow("32 bytes")
  })
})
