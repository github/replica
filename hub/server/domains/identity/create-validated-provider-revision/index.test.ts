import { describe, expect, it } from "vitest"

import { createValidatedProviderRevision } from "."

describe("createValidatedProviderRevision()", () => {
  it("creates the same digest for equivalent settings regardless of key order", () => {
    const first = createValidatedProviderRevision({
      providerKey: "workforce",
      revision: 1,
      settings: { issuer: "https://id.example.test", audience: "hub" },
    })
    const second = createValidatedProviderRevision({
      providerKey: "workforce",
      revision: 1,
      settings: { audience: "hub", issuer: "https://id.example.test" },
    })

    expect(first.configurationDigest).toMatch(/^[0-9a-f]{64}$/)
    expect(second.configurationDigest).toBe(first.configurationDigest)
    expect(second.settings).toEqual(first.settings)
  })

  it("rejects credentials and settings that exceed the bounded contract", () => {
    expect(() =>
      createValidatedProviderRevision({
        providerKey: "workforce",
        revision: 1,
        settings: { clientSecret: "must-not-persist" },
      }),
    ).toThrow("cannot contain credentials or secrets")
    expect(() =>
      createValidatedProviderRevision({
        providerKey: "workforce",
        revision: 1,
        settings: { issuer: "x".repeat(2_001) },
      }),
    ).toThrow("cannot exceed 2000 characters")
  })
})
