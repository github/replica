import { describe, expect, it } from "vitest"

import { parseProviderKey } from "../../../utils/parse-provider-key"
import { createSecurityAuditContext, createSecurityAuditContextWithProviderKey } from "."

describe("createSecurityAuditContext()", () => {
  it.each([
    "secret:workforce",
    "Bearer opaque-value",
    ["-----BEGIN PRIVATE", " KEY-----"].join(""),
  ])("rejects the untyped credential-shaped value %s", (value) => {
    expect(() => createSecurityAuditContext({ value })).toThrow(
      "cannot contain credential or key material",
    )
  })

  it("rejects an untyped client secret field", () => {
    expect(() => createSecurityAuditContext({ clientSecret: "opaque-value" })).toThrow(
      "cannot contain secret-bearing fields",
    )
  })

  it("retains generic context string, entry, and byte bounds", () => {
    expect(() => createSecurityAuditContext({ value: "a".repeat(501) })).toThrow(
      "cannot exceed 500 characters",
    )
    expect(() =>
      createSecurityAuditContext({
        first: 1,
        second: 2,
        third: 3,
        fourth: 4,
        fifth: 5,
        sixth: 6,
        seventh: 7,
        eighth: 8,
        ninth: 9,
      }),
    ).toThrow("cannot exceed 8 fields")
    expect(() =>
      createSecurityAuditContext({
        first: "界".repeat(500),
        second: "界".repeat(500),
        third: "界".repeat(500),
        fourth: "界".repeat(500),
        fifth: "界".repeat(500),
        sixth: "界".repeat(500),
        seventh: "界".repeat(500),
        eighth: "界".repeat(500),
      }),
    ).toThrow("cannot exceed 4096 bytes")
  })

  it("retains context bounds for a canonically parsed provider key", () => {
    const provider = parseProviderKey("secret:workforce")

    expect(() =>
      createSecurityAuditContextWithProviderKey({
        provider,
        first: "界".repeat(500),
        second: "界".repeat(500),
        third: "界".repeat(500),
        fourth: "界".repeat(500),
        fifth: "界".repeat(500),
        sixth: "界".repeat(500),
        seventh: "界".repeat(500),
      }),
    ).toThrow("cannot exceed 4096 bytes")
  })
})
