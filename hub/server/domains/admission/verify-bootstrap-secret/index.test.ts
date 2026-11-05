import { describe, expect, it } from "vitest"

import { verifyBootstrapSecret } from "."

describe("verifyBootstrapSecret()", () => {
  it("accepts only the complete configured secret", () => {
    const secret = "a".repeat(32)

    expect(verifyBootstrapSecret(secret, secret)).toBe(true)
    expect(verifyBootstrapSecret(secret, `${secret}x`)).toBe(false)
    expect(verifyBootstrapSecret(secret, "a")).toBe(false)
  })

  it("rejects a configured secret shorter than 32 characters", () => {
    expect(() => verifyBootstrapSecret("short", "short")).toThrow()
  })
})
