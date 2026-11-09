import { describe, expect, it } from "vitest"

import { parseAzureSecretConfiguration } from "."

describe("parseAzureSecretConfiguration()", () => {
  it("canonicalizes the explicit identity and preserves additional runtime secret URLs", () => {
    const references = {
      DATABASE_URL: "https://fixture.vault.azure.net/secrets/runtime-database",
      SERVICE_API_KEY:
        "https://service.vault.azure.net/secrets/api-key/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    }
    const environment = {
      AZURE_CLIENT_ID: "ABCDEFAB-1234-5678-9ABC-DEFABCDEFABC",
      AZURE_KEY_VAULT_SECRET_REFERENCES: JSON.stringify(references),
    }

    expect(parseAzureSecretConfiguration(environment, "runtime")).toEqual({
      managedIdentityClientId: "abcdefab-1234-5678-9abc-defabcdefabc",
      references,
    })
    expect(environment).not.toHaveProperty("DATABASE_URL")
    expect(environment).not.toHaveProperty("SERVICE_API_KEY")
  })

  it.each([
    "https://fixture.vault.azure.net/secrets/migration-database",
    "https://fixture.vault.azure.net/secrets/migration-database/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  ])("accepts the existing setup URL form %s", (url) => {
    const environment = {
      AZURE_CLIENT_ID: "00000000-0000-0000-0000-000000000003",
      AZURE_KEY_VAULT_SECRET_REFERENCES: JSON.stringify({ DATABASE_URL: url }),
    }

    expect(parseAzureSecretConfiguration(environment, "setup")).toEqual({
      managedIdentityClientId: environment.AZURE_CLIENT_ID,
      references: { DATABASE_URL: url },
    })
  })

  it("accepts exactly the three versioned provisioning references", () => {
    const references = {
      DATABASE_URL:
        "https://fixture.vault.azure.net/secrets/admin-database/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      HUB_MIGRATION_PASSWORD:
        "https://fixture.vault.azure.net/secrets/migration-password/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      HUB_RUNTIME_PASSWORD:
        "https://fixture.vault.azure.net/secrets/runtime-password/cccccccccccccccccccccccccccccccc",
    }
    const environment = {
      AZURE_CLIENT_ID: "00000000-0000-0000-0000-000000000005",
      AZURE_KEY_VAULT_SECRET_REFERENCES: JSON.stringify(references),
    }

    expect(parseAzureSecretConfiguration(environment, "provision")).toEqual({
      managedIdentityClientId: environment.AZURE_CLIENT_ID,
      references,
    })
  })

  it.each([undefined, "", "synthetic-client-token", " 00000000-0000-0000-0000-000000000001"])(
    "rejects a missing or malformed explicit managed identity",
    (clientId) => {
      const environment = {
        AZURE_CLIENT_ID: clientId,
        AZURE_KEY_VAULT_SECRET_REFERENCES: JSON.stringify({
          DATABASE_URL: "https://fixture.vault.azure.net/secrets/database",
        }),
      }

      expect(() => parseAzureSecretConfiguration(environment, "runtime")).toThrow()
    },
  )

  it.each([undefined, "", "null", "[]", '"synthetic-secret-value"', "{}"])(
    "requires an object containing secret references",
    (input) => {
      const environment = {
        AZURE_CLIENT_ID: "00000000-0000-0000-0000-000000000001",
        AZURE_KEY_VAULT_SECRET_REFERENCES: input,
      }

      expect(() => parseAzureSecretConfiguration(environment, "runtime")).toThrow()
    },
  )

  it.each(["runtime", "setup"] as const)("requires the database URL for %s", (target) => {
    const environment = {
      AZURE_CLIENT_ID: "00000000-0000-0000-0000-000000000001",
      AZURE_KEY_VAULT_SECRET_REFERENCES: JSON.stringify({
        SERVICE_API_KEY: "https://fixture.vault.azure.net/secrets/api-key",
      }),
    }

    expect(() => parseAzureSecretConfiguration(environment, target)).toThrow()
  })

  it.each(["DATABASE_URL", "HUB_MIGRATION_PASSWORD", "HUB_RUNTIME_PASSWORD"])(
    "requires the provisioning reference %s",
    (missing) => {
      const references: Record<string, string> = {
        DATABASE_URL:
          "https://fixture.vault.azure.net/secrets/admin-database/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        HUB_MIGRATION_PASSWORD:
          "https://fixture.vault.azure.net/secrets/migration-password/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        HUB_RUNTIME_PASSWORD:
          "https://fixture.vault.azure.net/secrets/runtime-password/cccccccccccccccccccccccccccccccc",
      }
      delete references[missing]
      const environment = {
        AZURE_CLIENT_ID: "00000000-0000-0000-0000-000000000005",
        AZURE_KEY_VAULT_SECRET_REFERENCES: JSON.stringify(references),
      }

      expect(() => parseAzureSecretConfiguration(environment, "provision")).toThrow()
    },
  )

  it.each(["setup", "provision"] as const)(
    "does not grant additional secret access to %s",
    (target) => {
      const references = {
        DATABASE_URL:
          "https://fixture.vault.azure.net/secrets/database/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        ...(target === "provision"
          ? {
              HUB_MIGRATION_PASSWORD:
                "https://fixture.vault.azure.net/secrets/migration-password/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              HUB_RUNTIME_PASSWORD:
                "https://fixture.vault.azure.net/secrets/runtime-password/cccccccccccccccccccccccccccccccc",
            }
          : {}),
        SERVICE_API_KEY:
          "https://fixture.vault.azure.net/secrets/api-key/dddddddddddddddddddddddddddddddd",
      }
      const environment = {
        AZURE_CLIENT_ID: "00000000-0000-0000-0000-000000000005",
        AZURE_KEY_VAULT_SECRET_REFERENCES: JSON.stringify(references),
      }

      expect(() => parseAzureSecretConfiguration(environment, target)).toThrow()
    },
  )

  it("requires a pinned version for provisioning passwords as well as the database URL", () => {
    const environment = {
      AZURE_CLIENT_ID: "00000000-0000-0000-0000-000000000005",
      AZURE_KEY_VAULT_SECRET_REFERENCES: JSON.stringify({
        DATABASE_URL:
          "https://fixture.vault.azure.net/secrets/admin-database/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        HUB_MIGRATION_PASSWORD: "https://fixture.vault.azure.net/secrets/migration-password",
        HUB_RUNTIME_PASSWORD:
          "https://fixture.vault.azure.net/secrets/runtime-password/cccccccccccccccccccccccccccccccc",
      }),
    }

    expect(() => parseAzureSecretConfiguration(environment, "provision")).toThrow()
  })

  it.each([
    "AZURE_CLIENT_ID",
    "AZURE_KEY_VAULT_SECRET_REFERENCES",
    "DATABASE_RUNTIME_ROLE",
    "NODE_ENV",
    "RUNTIME_MODE",
    "HOST",
    "PORT",
    "CLIENT_DIRECTORY",
    "SHUTDOWN_TIMEOUT_MS",
    "ARTIFACT_STORAGE_PROVIDER",
    "ARTIFACT_STORAGE_DIRECTORY",
    "AZURE_STORAGE_ACCOUNT",
    "AZURE_STORAGE_CONTAINER",
    "service_key",
    "_SERVICE_KEY",
    "SERVICE-KEY",
    "S".repeat(42),
  ])("rejects the reserved or invalid runtime destination %s", (name) => {
    const environment = {
      AZURE_CLIENT_ID: "00000000-0000-0000-0000-000000000001",
      AZURE_KEY_VAULT_SECRET_REFERENCES: JSON.stringify({
        DATABASE_URL: "https://fixture.vault.azure.net/secrets/database",
        [name]: "https://fixture.vault.azure.net/secrets/api-key",
      }),
    }

    expect(() => parseAzureSecretConfiguration(environment, "runtime")).toThrow()
  })

  it.each([
    ["DATABASE_URL", "synthetic-existing-database-url"],
    ["SERVICE_API_KEY", ""],
  ])(
    "does not overwrite an already defined destination, including an empty value",
    (name, existing) => {
      const environment = {
        AZURE_CLIENT_ID: "00000000-0000-0000-0000-000000000001",
        AZURE_KEY_VAULT_SECRET_REFERENCES: JSON.stringify({
          DATABASE_URL: "https://fixture.vault.azure.net/secrets/database",
          SERVICE_API_KEY: "https://fixture.vault.azure.net/secrets/api-key",
        }),
        [name]: existing,
      }
      const before = { ...environment }

      expect(() => parseAzureSecretConfiguration(environment, "runtime")).toThrow()
      expect(environment).toEqual(before)
    },
  )

  it.each([
    "synthetic-raw-secret-value",
    "http://fixture.vault.azure.net/secrets/database",
    "https://other.example/secrets/database",
    "https://fixture.vault.azure.net.other.example/secrets/database",
    "https://synthetic-user:synthetic-password@fixture.vault.azure.net/secrets/database",
    "https://fixture.vault.azure.net:443/secrets/database",
    "https://fixture.vault.azure.net/secrets/database?token=synthetic-query-token",
    "https://fixture.vault.azure.net/secrets/database#synthetic-fragment",
    "https://fixture.vault.azure.net/keys/database",
    "https://fixture.vault.azure.net/secrets/",
    "https://fixture.vault.azure.net/secrets/database/not-a-version",
    "https://fixture.vault.azure.net/secrets/%2e%2e/database",
  ])("rejects a value outside the public Azure secret URL contract", (url) => {
    const environment = {
      AZURE_CLIENT_ID: "00000000-0000-0000-0000-000000000001",
      AZURE_KEY_VAULT_SECRET_REFERENCES: JSON.stringify({ DATABASE_URL: url }),
    }

    expect(() => parseAzureSecretConfiguration(environment, "runtime")).toThrow()
  })

  it("requires reference values to be strings rather than nested configuration", () => {
    const environment = {
      AZURE_CLIENT_ID: "00000000-0000-0000-0000-000000000001",
      AZURE_KEY_VAULT_SECRET_REFERENCES: JSON.stringify({
        DATABASE_URL: { value: "synthetic-database-password" },
      }),
    }

    expect(() => parseAzureSecretConfiguration(environment, "runtime")).toThrow()
  })

  it.each([64, 65])("enforces the reference-count boundary at %i entries", (count) => {
    const references = Object.fromEntries(
      Array.from({ length: count }, (_, index) => [
        index === 0 ? "DATABASE_URL" : `SERVICE_SECRET_${index}`,
        "https://fixture.vault.azure.net/secrets/database",
      ]),
    )
    const environment = {
      AZURE_CLIENT_ID: "00000000-0000-0000-0000-000000000001",
      AZURE_KEY_VAULT_SECRET_REFERENCES: JSON.stringify(references),
    }

    if (count === 64) {
      expect(parseAzureSecretConfiguration(environment, "runtime").references).toEqual(references)
    } else {
      expect(() => parseAzureSecretConfiguration(environment, "runtime")).toThrow()
    }
  })

  it.each([65_536, 65_537])("enforces the metadata-size boundary at %i bytes", (bytes) => {
    const references = { DATABASE_URL: "https://fixture.vault.azure.net/secrets/database" }
    const environment = {
      AZURE_CLIENT_ID: "00000000-0000-0000-0000-000000000001",
      AZURE_KEY_VAULT_SECRET_REFERENCES: JSON.stringify(references).padEnd(bytes, " "),
    }

    if (bytes === 65_536) {
      expect(parseAzureSecretConfiguration(environment, "runtime").references).toEqual(references)
    } else {
      expect(() => parseAzureSecretConfiguration(environment, "runtime")).toThrow()
    }
  })

  it("does not retain rejected JSON or secret-bearing parser diagnostics", () => {
    const input = '{"DATABASE_URL":"synthetic-secret-value","token":"synthetic-token",}'
    const environment = {
      AZURE_CLIENT_ID: "00000000-0000-0000-0000-000000000001",
      AZURE_KEY_VAULT_SECRET_REFERENCES: input,
    }
    let failure: unknown

    try {
      parseAzureSecretConfiguration(environment, "runtime")
    } catch (error) {
      failure = error
    }

    expect(failure).toBeInstanceOf(Error)
    expect(failure).not.toHaveProperty("cause")
    expect(String(failure)).not.toMatch(/synthetic-secret-value|synthetic-token/)
  })
})
