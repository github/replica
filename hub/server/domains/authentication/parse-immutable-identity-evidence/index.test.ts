import { describe, expect, it } from "vitest"

import { parseImmutableIdentityEvidence } from "."

describe("parseImmutableIdentityEvidence()", () => {
  it("accepts only immutable provider identity evidence", () => {
    expect(
      parseImmutableIdentityEvidence({
        provider: "oidc",
        issuer: "https://id.example.test",
        subject: "person-123",
      }),
    ).toEqual({
      provider: "oidc",
      issuer: "https://id.example.test",
      subject: "person-123",
    })
  })

  it("rejects presentation and unknown fields", () => {
    expect(() =>
      parseImmutableIdentityEvidence({
        provider: "oidc",
        issuer: "https://id.example.test",
        subject: "person-123",
        preferredUsername: "person",
      }),
    ).toThrow()
  })
})
