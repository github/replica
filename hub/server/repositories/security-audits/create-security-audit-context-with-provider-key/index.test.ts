import { describe, expect, it } from "vitest"

import { normalizeBoundedJson } from "../../../utils/normalize-bounded-json"
import { parseProviderKey } from "../../../utils/parse-provider-key"
import { securityAuditContextLimits } from "../constants"
import { createSecurityAuditContextWithProviderKey } from "."

describe("createSecurityAuditContextWithProviderKey()", () => {
  it.each([
    "secret:workforce",
    ["Bear", "er opaque-value"].join(""),
    ["-----BEGIN PRIVATE", " KEY-----"].join(""),
  ])("keeps generic normalization rejecting the credential-shaped value %s", (value) => {
    expect(() => normalizeBoundedJson({ value }, securityAuditContextLimits)).toThrow(
      "cannot contain credential or key material",
    )
  })

  it("keeps generic normalization rejecting a client secret field", () => {
    expect(() =>
      normalizeBoundedJson({ clientSecret: "opaque-value" }, securityAuditContextLimits),
    ).toThrow("cannot contain secret-bearing fields")
  })

  it("retains generic context string, entry, and byte bounds", () => {
    expect(() =>
      normalizeBoundedJson({ value: "a".repeat(501) }, securityAuditContextLimits),
    ).toThrow("cannot exceed 500 characters")
    expect(() =>
      normalizeBoundedJson(
        {
          first: 1,
          second: 2,
          third: 3,
          fourth: 4,
          fifth: 5,
          sixth: 6,
          seventh: 7,
          eighth: 8,
          ninth: 9,
        },
        securityAuditContextLimits,
      ),
    ).toThrow("cannot exceed 8 fields")
    expect(() =>
      normalizeBoundedJson(
        {
          first: "界".repeat(500),
          second: "界".repeat(500),
          third: "界".repeat(500),
          fourth: "界".repeat(500),
          fifth: "界".repeat(500),
          sixth: "界".repeat(500),
          seventh: "界".repeat(500),
          eighth: "界".repeat(500),
        },
        securityAuditContextLimits,
      ),
    ).toThrow("cannot exceed 4096 bytes")
  })

  it("accepts 4096 restored bytes and rejects 4097 after placeholder validation", () => {
    const provider = parseProviderKey("界".repeat(100))
    const atLimit = {
      first: `${"界".repeat(116)}${"a".repeat(352)}`,
      second: "a".repeat(500),
      third: "a".repeat(500),
      fourth: "a".repeat(500),
      fifth: "a".repeat(500),
      sixth: "a".repeat(500),
      seventh: "a".repeat(500),
      provider,
    }
    const overLimit = {
      ...atLimit,
      first: `${"界".repeat(116)}é${"a".repeat(351)}`,
    }
    const placeholder = { ...atLimit, provider: "x".repeat(provider.length) }
    const overLimitPlaceholder = {
      ...overLimit,
      provider: "x".repeat(provider.length),
    }

    expect(Buffer.byteLength(JSON.stringify(placeholder), "utf8")).toBe(3_896)
    expect(Buffer.byteLength(JSON.stringify(overLimitPlaceholder), "utf8")).toBe(3_897)
    expect(Buffer.byteLength(JSON.stringify(atLimit), "utf8")).toBe(4_096)
    expect(Buffer.byteLength(JSON.stringify(overLimit), "utf8")).toBe(4_097)
    expect(normalizeBoundedJson(overLimitPlaceholder, securityAuditContextLimits)).toEqual(
      overLimitPlaceholder,
    )
    expect(createSecurityAuditContextWithProviderKey(atLimit)).toEqual(atLimit)
    expect(() => createSecurityAuditContextWithProviderKey(overLimit)).toThrow(
      "cannot exceed 4096 bytes",
    )
  })

  it.each([
    ["issuer", ["Bear", "er opaque-value"].join("")],
    ["reason", ["-----BEGIN ", "PRIVATE KEY-----"].join("")],
    ["metadata", ["client-", "secret:opaque-value"].join("")],
  ])("rejects credential-shaped %s outside the trusted provider field", (key, value) => {
    expect(() =>
      createSecurityAuditContextWithProviderKey({
        provider: parseProviderKey("secret:workforce"),
        [key]: value,
      }),
    ).toThrow("cannot contain credential or key material")
  })

  it("accepts safe ordinary metadata beside the trusted provider field", () => {
    expect(
      createSecurityAuditContextWithProviderKey({
        provider: parseProviderKey("secret:workforce"),
        issuer: "https://id.example.test",
        reason: "transaction_error",
        revision: 2,
        retryable: false,
        detail: null,
      }),
    ).toEqual({
      detail: null,
      issuer: "https://id.example.test",
      provider: "secret:workforce",
      reason: "transaction_error",
      retryable: false,
      revision: 2,
    })
  })
})
