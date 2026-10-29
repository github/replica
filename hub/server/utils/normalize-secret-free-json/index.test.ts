import { describe, expect, it } from "vitest"

import type { NormalizeSecretFreeJsonLimits } from "./types"
import { normalizeSecretFreeJson } from "."

function limits(overrides: Partial<NormalizeSecretFreeJsonLimits> = {}) {
  return {
    maxArrayItems: 10,
    maxBytes: 1_000,
    maxDepth: 5,
    maxEntries: 20,
    maxKeyLength: 20,
    maxObjectFields: 10,
    maxStringLength: 100,
    ...overrides,
  }
}

describe("normalizeSecretFreeJson()", () => {
  it("accepts the exact UTF-8 byte limit and rejects one byte less", () => {
    const input = { label: "界" }
    const bytes = Buffer.byteLength(JSON.stringify(input), "utf8")

    expect(normalizeSecretFreeJson(input, limits({ maxBytes: bytes }))).toEqual(input)
    expect(() => normalizeSecretFreeJson(input, limits({ maxBytes: bytes - 1 }))).toThrow(
      `cannot exceed ${bytes - 1} bytes`,
    )
  })

  it("accepts the exact string length and rejects the next character", () => {
    expect(normalizeSecretFreeJson({ label: "abc" }, limits({ maxStringLength: 3 }))).toEqual({
      label: "abc",
    })
    expect(() =>
      normalizeSecretFreeJson({ label: "abcd" }, limits({ maxStringLength: 3 })),
    ).toThrow("cannot exceed 3 characters")
  })

  it("accepts the exact key length and rejects the next character", () => {
    expect(normalizeSecretFreeJson({ abc: 1 }, limits({ maxKeyLength: 3 }))).toEqual({ abc: 1 })
    expect(() => normalizeSecretFreeJson({ abcd: 1 }, limits({ maxKeyLength: 3 }))).toThrow(
      "between 1 and 3 characters",
    )
  })

  it("accepts the exact array length and rejects the next item", () => {
    expect(normalizeSecretFreeJson({ values: [1, 2] }, limits({ maxArrayItems: 2 }))).toEqual({
      values: [1, 2],
    })
    expect(() =>
      normalizeSecretFreeJson({ values: [1, 2, 3] }, limits({ maxArrayItems: 2 })),
    ).toThrow("cannot exceed 2 items")
  })

  it("accepts the exact object property count and rejects the next property", () => {
    expect(
      normalizeSecretFreeJson({ first: 1, second: 2 }, limits({ maxObjectFields: 2 })),
    ).toEqual({ first: 1, second: 2 })
    expect(() =>
      normalizeSecretFreeJson({ first: 1, second: 2, third: 3 }, limits({ maxObjectFields: 2 })),
    ).toThrow("cannot exceed 2 fields")
  })

  it("accepts the exact total entry count and rejects one fewer", () => {
    const input = { values: [true, false] }

    expect(normalizeSecretFreeJson(input, limits({ maxEntries: 3 }))).toEqual(input)
    expect(() => normalizeSecretFreeJson(input, limits({ maxEntries: 2 }))).toThrow(
      "cannot exceed 2 total entries",
    )
  })

  it("rejects every non-finite number", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => normalizeSecretFreeJson({ value }, limits())).toThrow("must be finite")
    }
  })

  it("rejects unsupported object prototypes", () => {
    class Configuration {
      value = "metadata"
    }

    for (const value of [new Configuration(), new Date(0), new Map(), new Set()]) {
      expect(() => normalizeSecretFreeJson({ value }, limits())).toThrow(
        "only plain objects, arrays, and scalar values",
      )
    }
  })

  it("requires an object root while allowing nested scalar and array values", () => {
    const nested = { values: [null, true, 1, "text", { enabled: false }] }

    expect(normalizeSecretFreeJson(nested, limits())).toEqual(nested)
    for (const root of [null, true, 1, "text", [1, 2]]) {
      expect(() => normalizeSecretFreeJson(root, limits())).toThrow("must be an object")
    }
  })

  it("accepts the exact recursion depth and rejects the next level", () => {
    expect(
      normalizeSecretFreeJson({ nested: { value: "at-limit" } }, limits({ maxDepth: 2 })),
    ).toEqual({ nested: { value: "at-limit" } })
    expect(() =>
      normalizeSecretFreeJson(
        { nested: { deeper: { value: "too-deep" } } },
        limits({ maxDepth: 2 }),
      ),
    ).toThrow("cannot exceed 2 nested levels")
  })
})
