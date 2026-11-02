import { describe, expect, it } from "vitest"

import { parseImmutableIdentityEvidence } from "."

describe("parseImmutableIdentityEvidence()", () => {
  it("normalizes absent provider-neutral presentation attributes to null", () => {
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
      attributes: {
        avatarUrl: null,
        email: null,
        name: null,
        preferredUsername: null,
      },
    })
  })

  it("rejects unknown, oversized, and unsafe presentation values", () => {
    const base = {
      provider: "oidc",
      issuer: "https://id.example.test",
      subject: "person-123",
    }
    expect(() =>
      parseImmutableIdentityEvidence({
        ...base,
        attributes: { preferredUsername: null, login: "not-shared" },
      }),
    ).toThrow()
    expect(() =>
      parseImmutableIdentityEvidence({
        ...base,
        attributes: { preferredUsername: "x".repeat(201) },
      }),
    ).toThrow()
    expect(() =>
      parseImmutableIdentityEvidence({
        ...base,
        attributes: { email: "not-an-email" },
      }),
    ).toThrow()
    expect(() =>
      parseImmutableIdentityEvidence({
        ...base,
        attributes: { avatarUrl: "javascript:alert(1)" },
      }),
    ).toThrow()
  })
})
