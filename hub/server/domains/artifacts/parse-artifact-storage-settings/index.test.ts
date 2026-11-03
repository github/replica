import { describe, expect, it } from "vitest"

import { parseArtifactStorageSettings } from "."

describe("parseArtifactStorageSettings()", () => {
  it("accepts explicit filesystem or managed-identity Azure settings", () => {
    const filesystem = { provider: "filesystem", directory: "/srv/artifacts" }
    const azure = {
      provider: "azure-blob",
      accountUrl: "https://example.blob.core.windows.net",
      container: "artifacts",
      managedIdentityClientId: "ee5eeebb-74e0-4b79-8030-c325e50fec43",
    }
    expect(parseArtifactStorageSettings(filesystem)).toEqual(filesystem)
    expect(parseArtifactStorageSettings(azure)).toEqual(azure)
  })

  it("rejects missing, unknown, ambiguous, or credential-bearing settings without echoing input", () => {
    for (const input of [
      {},
      { provider: "other" },
      { provider: "filesystem", directory: "relative" },
      { provider: "filesystem", directory: "/srv/../artifacts" },
      { provider: "filesystem", directory: "/srv/artifacts", container: "artifacts" },
      {
        provider: "azure-blob",
        accountUrl: "https://example.blob.core.windows.net?sig=secret",
        container: "artifacts",
      },
      {
        provider: "azure-blob",
        accountUrl: "http://example.blob.core.windows.net",
        container: "artifacts",
      },
      {
        provider: "azure-blob",
        accountUrl: "https://example.blob.core.windows.net",
        container: "artifacts",
        accountKey: "secret",
      },
      {
        provider: "azure-blob",
        accountUrl: "https://example.blob.core.windows.net",
        container: "invalid/container",
      },
    ]) {
      expect(() => parseArtifactStorageSettings(input)).toThrow(
        "Artifact storage configuration is invalid.",
      )
    }
  })
})
