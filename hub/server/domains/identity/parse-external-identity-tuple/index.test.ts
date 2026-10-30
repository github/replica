import { describe, expect, it } from "vitest"

import { ExternalIdentityTupleTooLargeError } from "../errors"
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
})
