import { describe, expect, it, vi } from "vitest"

import { sanitizeLogValue } from "."

describe("sanitizeLogValue()", () => {
  it("redacts sensitive naming variants recursively without changing the input", () => {
    const input = {
      title: "Public title",
      PASSWORD: "password-value",
      nested: [
        { access_token: "token-value", "client-secret": "secret-value", count: 2 },
        { authorization: "authorization-value", cookie: "cookie-value" },
      ],
    }
    const original = structuredClone(input)

    expect(sanitizeLogValue(input)).toEqual({
      title: "Public title",
      PASSWORD: "[REDACTED]",
      nested: [
        { access_token: "[REDACTED]", "client-secret": "[REDACTED]", count: 2 },
        { authorization: "[REDACTED]", cookie: "[REDACTED]" },
      ],
    })
    expect(input).toEqual(original)
  })

  it("makes cycles and non-JSON primitives safe to serialize", () => {
    const input: Record<string, unknown> = {
      title: "Keep this",
      bigint: 1n,
      missing: undefined,
      infinite: Infinity,
      symbol: Symbol("private-symbol"),
      callback: () => "private-function",
    }
    input.self = input

    const result = sanitizeLogValue(input)

    expect(() => JSON.stringify(result)).not.toThrow()
    expect(JSON.parse(JSON.stringify(result))).toMatchObject({ title: "Keep this" })
    expect(input.self).toBe(input)
  })

  it("does not execute getters or serialization hooks on unsupported instances", () => {
    const getter = vi.fn(() => "getter-secret")
    const toJSON = vi.fn(() => ({ exposed: "serialization-secret" }))
    class Upload {
      toJSON = toJSON
    }
    const input = {
      safe: "Keep this",
      upload: new Upload(),
      buffer: Buffer.from("upload-secret"),
      get computed() {
        return getter()
      },
    }

    const result = JSON.stringify(sanitizeLogValue(input))

    expect(getter).not.toHaveBeenCalled()
    expect(toJSON).not.toHaveBeenCalled()
    expect(result).toContain("Keep this")
    expect(result).not.toMatch(/getter-secret|serialization-secret|upload-secret/)
  })

  it("omits values deeper than six levels while retaining shallow data", () => {
    const input = {
      safe: "Keep this",
      nested: { a: { b: { c: { d: { e: { f: { g: "too-deep" } } } } } } },
    }

    const result = JSON.stringify(sanitizeLogValue(input))

    expect(result).toContain("Keep this")
    expect(result).not.toContain("too-deep")
  })

  it("limits total visited entries rather than only limiting each container", () => {
    const input = Array.from({ length: 12 }, (_, group) =>
      Array.from({ length: 10 }, (_, entry) => `entry-${group}-${entry}`),
    )

    const result = JSON.stringify(sanitizeLogValue(input))

    expect(result).toContain("entry-0-0")
    expect(result).not.toContain("entry-11-9")
  })

  it("limits an individual string to 2048 characters", () => {
    const input = "a".repeat(2048) + "past-string-limit"

    const result = sanitizeLogValue(input)

    expect(typeof result).toBe("string")
    expect((result as string).length).toBeLessThanOrEqual(2048)
    expect(result).not.toContain("past-string-limit")
    expect(input).toHaveLength(2065)
  })

  it("keeps the final serialized value within 8192 bytes for multibyte text", () => {
    const input = Array.from({ length: 6 }, () => "\u754c".repeat(1800))

    const result = JSON.stringify(sanitizeLogValue(input))

    expect(Buffer.byteLength(result, "utf8")).toBeLessThanOrEqual(8192)
    expect(input[0]).toHaveLength(1800)
  })
})
