import { describe, expect, it } from "vitest"

import { createValidatedProviderRevision } from "."

describe("createValidatedProviderRevision()", () => {
  it("creates the same digest for recursively equivalent settings regardless of key order", () => {
    const first = createValidatedProviderRevision({
      providerKey: "workforce",
      revision: 1,
      settings: {
        z: 1,
        ä: 2,
        nested: { issuer: "https://id.example.test", audience: "hub" },
      },
    })
    const second = createValidatedProviderRevision({
      providerKey: "workforce",
      revision: 1,
      settings: {
        nested: { audience: "hub", issuer: "https://id.example.test" },
        ä: 2,
        z: 1,
      },
    })

    expect(first.configurationDigest).toMatch(/^[0-9a-f]{64}$/)
    expect(second.configurationDigest).toBe(first.configurationDigest)
    expect(second.settings).toEqual(first.settings)
    expect(Object.keys(first.settings)).toEqual(["nested", "z", "ä"])
  })

  it("rejects secret-bearing keys and values at every supported nesting level", () => {
    expect(() =>
      createValidatedProviderRevision({
        providerKey: "workforce",
        revision: 1,
        settings: { privateKey: "must-not-persist" },
      }),
    ).toThrow("cannot contain secret-bearing fields")
    const secrets: Array<Record<string, string>> = [
      { databasePassword: "must-not-persist" },
      { clientSecret: "must-not-persist" },
      { accessToken: "must-not-persist" },
      { signingPrivateKey: "must-not-persist" },
    ]
    for (const secret of secrets) {
      expect(() =>
        createValidatedProviderRevision({
          providerKey: "workforce",
          revision: 1,
          settings: { metadata: [secret] },
        }),
      ).toThrow("cannot contain secret-bearing fields")
    }
    expect(() =>
      createValidatedProviderRevision({
        providerKey: "workforce",
        revision: 1,
        settings: {
          certificate: [
            "-----BEGIN PRIVATE",
            " KEY-----\nmaterial\n-----END PRIVATE",
            " KEY-----",
          ].join(""),
        },
      }),
    ).toThrow("cannot contain credential or key material")
  })

  it("allows non-secret key metadata and enforces recursion bounds", () => {
    expect(() =>
      createValidatedProviderRevision({
        providerKey: "workforce",
        revision: 1,
        settings: {
          tokenEndpoint: "https://id.example.test/token",
          keyId: "signing-key-1",
          publicKeyUrl: "https://id.example.test/keys",
        },
      }),
    ).not.toThrow()
    expect(() =>
      createValidatedProviderRevision({
        providerKey: "workforce",
        revision: 1,
        settings: { a: { b: { c: { d: { e: "too-deep" } } } } },
      }),
    ).toThrow("cannot exceed 4 nested levels")
  })
})
