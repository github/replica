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

  it("rejects tampering, wrong keys, malformed versions, and invalid bounds", () => {
    const key = Buffer.alloc(32, 1)
    const encrypted = encryptAuthenticationValue("secret-value", key)
    const tampered = `${encrypted.slice(0, -1)}A`

    expect(() => decryptAuthenticationValue(tampered, key)).toThrow()
    expect(() => decryptAuthenticationValue(encrypted, Buffer.alloc(32, 2))).toThrow()
    expect(() => decryptAuthenticationValue(encrypted.replace(/^v1/, "v2"), key)).toThrow(
      "ciphertext is invalid",
    )
    expect(() => decryptAuthenticationValue("v1.short", key)).toThrow("ciphertext is invalid")
    expect(() => encryptAuthenticationValue("", key)).toThrow("between 1 and 256 bytes")
    expect(() => encryptAuthenticationValue("x".repeat(257), key)).toThrow(
      "between 1 and 256 bytes",
    )
    expect(() => encryptAuthenticationValue("secret", Buffer.alloc(31))).toThrow("32 bytes")
  })
})
