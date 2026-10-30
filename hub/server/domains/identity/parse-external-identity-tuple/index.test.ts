import { describe, expect, it } from "vitest"

import { ExternalIdentityTupleTooLargeError, ExternalIdentityTupleUnicodeError } from "../errors"
import { externalIdentityTupleMaxBytes, parseExternalIdentityTuple } from "."

const provider = "p"
const issuer = "界".repeat(500)
const subjectAtLimit = `${"界".repeat(165)}aa`

describe("parseExternalIdentityTuple()", () => {
  it("accepts the exact combined UTF-8 index byte limit", () => {
    const tuple = { provider, issuer, subject: subjectAtLimit }
    const bytes =
      Buffer.byteLength(provider) +
      Buffer.byteLength(issuer) +
      Buffer.byteLength(subjectAtLimit) +
      2

    expect(bytes).toBe(externalIdentityTupleMaxBytes)
    expect(parseExternalIdentityTuple(tuple)).toEqual(tuple)
  })

  it("rejects one byte over the combined UTF-8 index limit", () => {
    expect(() =>
      parseExternalIdentityTuple({
        provider,
        issuer,
        subject: `${subjectAtLimit}a`,
      }),
    ).toThrow(ExternalIdentityTupleTooLargeError)
  })

  it("preserves ordinary provider identity sizes", () => {
    const tuple = {
      provider: "github",
      issuer: "https://github.com/login/oauth",
      subject: "123456789",
    }

    expect(parseExternalIdentityTuple(tuple)).toEqual(tuple)
  })

  it.each([
    ["issuer NUL", { provider, issuer: "https://id.example.test\0", subject: "person" }],
    ["subject NUL", { provider, issuer: "https://id.example.test", subject: "person\0" }],
    ["issuer lone high surrogate", { provider, issuer: "issuer-\ud800", subject: "person" }],
    ["issuer lone low surrogate", { provider, issuer: "issuer-\udc00", subject: "person" }],
    ["subject lone high surrogate", { provider, issuer: "issuer", subject: "person-\ud800" }],
    ["subject lone low surrogate", { provider, issuer: "issuer", subject: "person-\udc00" }],
  ])("rejects %s with a typed safe error", (_name, tuple) => {
    expect(() => parseExternalIdentityTuple(tuple)).toThrow(ExternalIdentityTupleUnicodeError)
  })

  it("rejects distinct malformed subjects that encode to the same replacement bytes", () => {
    const high = "person-\ud800"
    const low = "person-\udc00"

    expect(Buffer.from(high).equals(Buffer.from(low))).toBe(true)
    expect(() => parseExternalIdentityTuple({ provider, issuer: "issuer", subject: high })).toThrow(
      ExternalIdentityTupleUnicodeError,
    )
    expect(() => parseExternalIdentityTuple({ provider, issuer: "issuer", subject: low })).toThrow(
      ExternalIdentityTupleUnicodeError,
    )
  })

  it("allows valid surrogate pairs and non-BMP code points", () => {
    const tuple = { provider, issuer: "issuer-\ud83d\ude80", subject: "person-\u{1f680}" }

    expect(parseExternalIdentityTuple(tuple)).toEqual(tuple)
  })
})
