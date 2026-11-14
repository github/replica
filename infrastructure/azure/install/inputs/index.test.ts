import { beforeEach, describe, expect, it, vi } from "vitest"

import { readPrivateFile } from "../../../installer/private-files/index.ts"
import type { DeploymentConfig } from "../../../installer/types.ts"

import { readInstallationInputs } from "./index.ts"

vi.mock("../../../installer/private-files/index.ts", () => ({ readPrivateFile: vi.fn() }))

describe("readInstallationInputs()", () => {
  beforeEach(() => {
    vi.mocked(readPrivateFile).mockReset()
  })

  it.each([
    { name: "omitted", environment: undefined, expected: {} },
    { name: "empty", environment: {}, expected: { runtime_environment_variables: {} } },
  ])("accepts an $name runtime environment map", async ({ environment, expected }) => {
    const { config, inputs } = boundaryInputs()
    const { runtime_secret_references: _, ...saved } = inputs
    vi.mocked(readPrivateFile).mockResolvedValue(
      JSON.stringify({ ...saved, runtime_environment_variables: environment }),
    )

    await expect(readInstallationInputs("synthetic-installation", config)).resolves.toEqual(expected)
  })

  it("retains public runtime values, empty strings, and boundary names without a secret-reference count limit", async () => {
    const { config, inputs } = boundaryInputs()
    const environment = {
      ...Object.fromEntries(Array.from({ length: 61 }, (_, index) => [`PUBLIC_${index}`, "public"])),
      GITHUB_CLIENT_ID: "synthetic-public-client",
      HUB_APPLICATION_ORIGIN: "https://hub.example.com",
      EMPTY_SETTING: "",
      [`A${"B".repeat(40)}`]: "maximum-length-name",
    }
    vi.mocked(readPrivateFile).mockResolvedValue(
      JSON.stringify({ ...inputs, runtime_environment_variables: environment }),
    )

    await expect(readInstallationInputs("synthetic-installation", config)).resolves.toMatchObject({
      runtime_environment_variables: environment,
    })
  })

  it.each([
    { reason: "a null map", environment: null },
    { reason: "an array map", environment: [] },
    { reason: "a scalar map", environment: "synthetic-invalid-map" },
    { reason: "a lowercase name", environment: { github_client_id: "synthetic-invalid-value" } },
    { reason: "a punctuation name", environment: { "GITHUB-CLIENT-ID": "synthetic-invalid-value" } },
    { reason: "a leading digit", environment: { "1SETTING": "synthetic-invalid-value" } },
    { reason: "an oversized name", environment: { ["A".repeat(42)]: "synthetic-invalid-value" } },
    { reason: "a database override", environment: { DATABASE_URL: "synthetic-invalid-value" } },
    { reason: "a runtime port override", environment: { PORT: "synthetic-invalid-value" } },
    {
      reason: "an Azure metadata override",
      environment: { AZURE_KEY_VAULT_SECRET_REFERENCES: "synthetic-invalid-value" },
    },
    { reason: "a null value", environment: { PUBLIC_SETTING: null } },
    { reason: "a numeric value", environment: { PUBLIC_SETTING: 12345 } },
    { reason: "a boolean value", environment: { PUBLIC_SETTING: true } },
    { reason: "an object value", environment: { PUBLIC_SETTING: { value: "synthetic-invalid-value" } } },
  ])("rejects $reason without exposing runtime values", async ({ environment }) => {
    const { config, inputs } = boundaryInputs()
    vi.mocked(readPrivateFile).mockResolvedValue(
      JSON.stringify({ ...inputs, runtime_environment_variables: environment }),
    )

    const failure = await readInstallationInputs("synthetic-installation", config).catch(
      (error: unknown) => error,
    )

    expect(failure).toBeInstanceOf(Error)
    expect(String(failure)).not.toMatch(/synthetic-invalid|12345/)
  })

  it("rejects a name shared by public configuration and secret references even when values match", async () => {
    const { config, inputs, reference } = boundaryInputs()
    const secret = reference(24, 127)
    vi.mocked(readPrivateFile).mockResolvedValue(
      JSON.stringify({
        ...inputs,
        runtime_environment_variables: { SERVICE_API_KEY: secret.secret_id },
        runtime_secret_references: { SERVICE_API_KEY: secret },
      }),
    )

    const failure = await readInstallationInputs("synthetic-installation", config).catch(
      (error: unknown) => error,
    )

    expect(failure).toBeInstanceOf(Error)
    expect(String(failure)).not.toContain(secret.secret_id)
  })

  it("rejects an operator secret reference that would replace Azure startup metadata", async () => {
    const config: DeploymentConfig = {
      version: 1,
      cloud: "azure",
      name: "fixture-hub",
      owner: "fixture-team",
      azure: {
        subscriptionId: "00000000-0000-0000-0000-000000000000",
        tenantId: "00000000-0000-0000-0000-000000000001",
        location: "eastus2",
        resourceGroup: "fixture-hub",
      },
    }
    vi.mocked(readPrivateFile).mockResolvedValue(
      JSON.stringify({
        subscription_id: config.azure.subscriptionId,
        name: config.name,
        owner: config.owner,
        location: config.azure.location,
        resource_group_name: config.azure.resourceGroup,
        setup_database_secret: {
          key_vault_id:
            "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/fixture/providers/Microsoft.KeyVault/vaults/database",
          secret_id: "https://database.vault.azure.net/secrets/setup-database",
        },
        runtime_secret_references: {
          AZURE_KEY_VAULT_SECRET_REFERENCES: {
            key_vault_id:
              "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/fixture/providers/Microsoft.KeyVault/vaults/service",
            secret_id: "https://service.vault.azure.net/secrets/synthetic-metadata-override",
          },
        },
      }),
    )

    const failure = await readInstallationInputs("synthetic-installation", config).catch(
      (error: unknown) => error,
    )

    expect(failure).toBeInstanceOf(Error)
    expect(String(failure)).not.toMatch(/synthetic-metadata-override|service\.vault/)
  })

  it("reserves the exact metadata name without blocking a distinct valid runtime secret name", async () => {
    const config: DeploymentConfig = {
      version: 1,
      cloud: "azure",
      name: "fixture-hub",
      owner: "fixture-team",
      azure: {
        subscriptionId: "00000000-0000-0000-0000-000000000000",
        tenantId: "00000000-0000-0000-0000-000000000001",
        location: "eastus2",
        resourceGroup: "fixture-hub",
      },
    }
    const reference = {
      key_vault_id:
        "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/fixture/providers/Microsoft.KeyVault/vaults/service",
      secret_id: "https://service.vault.azure.net/secrets/api-key/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    }
    vi.mocked(readPrivateFile).mockResolvedValue(
      JSON.stringify({
        subscription_id: config.azure.subscriptionId,
        name: config.name,
        owner: config.owner,
        location: config.azure.location,
        resource_group_name: config.azure.resourceGroup,
        setup_database_secret: {
          key_vault_id:
            "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/fixture/providers/Microsoft.KeyVault/vaults/database",
          secret_id: "https://database.vault.azure.net/secrets/setup-database",
        },
        runtime_secret_references: { AZURE_KEY_VAULT_SECRET_REFERENCES_EXTRA: reference },
      }),
    )

    expect(await readInstallationInputs("synthetic-installation", config)).toEqual({
      runtime_secret_references: { AZURE_KEY_VAULT_SECRET_REFERENCES_EXTRA: reference },
    })
  })

  it("accepts 63 optional references alongside the runtime DATABASE_URL reference", async () => {
    const config: DeploymentConfig = {
      version: 1,
      cloud: "azure",
      name: "fixture-hub",
      owner: "fixture-team",
      azure: {
        subscriptionId: "00000000-0000-0000-0000-000000000000",
        tenantId: "00000000-0000-0000-0000-000000000001",
        location: "eastus2",
        resourceGroup: "fixture-hub",
      },
    }
    const optionalReferences = Object.fromEntries(
      Array.from({ length: 63 }, (_, index) => [
        `SERVICE_${index}`,
        {
          key_vault_id:
            "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/fixture/providers/Microsoft.KeyVault/vaults/service",
          secret_id: `https://service.vault.azure.net/secrets/service-${index}`,
        },
      ]),
    )
    vi.mocked(readPrivateFile).mockResolvedValue(
      JSON.stringify({
        subscription_id: config.azure.subscriptionId,
        name: config.name,
        owner: config.owner,
        location: config.azure.location,
        resource_group_name: config.azure.resourceGroup,
        runtime_database_secret: {
          key_vault_id:
            "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/fixture/providers/Microsoft.KeyVault/vaults/database",
          secret_id: "https://database.vault.azure.net/secrets/runtime-database",
        },
        setup_database_secret: {
          key_vault_id:
            "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/fixture/providers/Microsoft.KeyVault/vaults/database",
          secret_id: "https://database.vault.azure.net/secrets/setup-database",
        },
        runtime_secret_references: optionalReferences,
      }),
    )

    await expect(readInstallationInputs("synthetic-installation", config)).resolves.toMatchObject({
      runtime_secret_references: optionalReferences,
    })
  })

  it("rejects 64 optional references because DATABASE_URL occupies the remaining runtime slot", async () => {
    const config: DeploymentConfig = {
      version: 1,
      cloud: "azure",
      name: "fixture-hub",
      owner: "fixture-team",
      azure: {
        subscriptionId: "00000000-0000-0000-0000-000000000000",
        tenantId: "00000000-0000-0000-0000-000000000001",
        location: "eastus2",
        resourceGroup: "fixture-hub",
      },
    }
    const optionalReferences = Object.fromEntries(
      Array.from({ length: 64 }, (_, index) => [
        `SERVICE_${index}`,
        {
          key_vault_id:
            "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/fixture/providers/Microsoft.KeyVault/vaults/service",
          secret_id: `https://service.vault.azure.net/secrets/service-${index}`,
        },
      ]),
    )
    vi.mocked(readPrivateFile).mockResolvedValue(
      JSON.stringify({
        subscription_id: config.azure.subscriptionId,
        name: config.name,
        owner: config.owner,
        location: config.azure.location,
        resource_group_name: config.azure.resourceGroup,
        runtime_database_secret: {
          key_vault_id:
            "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/fixture/providers/Microsoft.KeyVault/vaults/database",
          secret_id: "https://database.vault.azure.net/secrets/runtime-database",
        },
        setup_database_secret: {
          key_vault_id:
            "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/fixture/providers/Microsoft.KeyVault/vaults/database",
          secret_id: "https://database.vault.azure.net/secrets/setup-database",
        },
        runtime_secret_references: optionalReferences,
      }),
    )

    const failure = await readInstallationInputs("synthetic-installation", config).catch(
      (error: unknown) => error,
    )

    expect(failure).toBeInstanceOf(Error)
  })

  it("accepts a full runtime map with maximum-length versioned Azure references", async () => {
    const { config, inputs, reference } = boundaryInputs()
    const secret = reference(24, 127)
    const references = Object.fromEntries(
      Array.from({ length: 63 }, (_, index) => [
        `S${String(index).padStart(2, "0")}${"A".repeat(38)}`,
        secret,
      ]),
    )
    inputs.runtime_database_secret = secret
    inputs.setup_database_secret = reference(24, 127, "setup")
    inputs.runtime_secret_references = references
    vi.mocked(readPrivateFile).mockResolvedValue(JSON.stringify(inputs))

    await expect(readInstallationInputs("synthetic-installation", config)).resolves.toMatchObject({
      runtime_secret_references: references,
    })
    const metadata = JSON.stringify({
      DATABASE_URL: secret.secret_id,
      ...Object.fromEntries(Object.entries(references).map(([name, value]) => [name, value.secret_id])),
    })
    expect(Buffer.byteLength(metadata, "utf8")).toBeLessThan(65_536)
  })

  it.each([
    { target: "runtime", component: "vault" },
    { target: "runtime", component: "secret" },
    { target: "setup", component: "vault" },
    { target: "setup", component: "secret" },
  ] as const)(
    "rejects an oversized $component name in the $target reference before maintenance",
    async ({ target, component }) => {
      const { config, inputs, reference } = boundaryInputs()
      const oversized = reference(component === "vault" ? 25 : 24, component === "secret" ? 128 : 127)
      if (target === "runtime") inputs.runtime_secret_references = { SERVICE_KEY: oversized }
      if (target === "setup") {
        inputs.setup_database_secret = oversized
        inputs.runtime_secret_references = { SERVICE_KEY: reference(24, 127) }
      }
      vi.mocked(readPrivateFile).mockResolvedValue(JSON.stringify(inputs))

      const failure = await readInstallationInputs("synthetic-installation", config).catch(
        (error: unknown) => error,
      )
      expect(failure).toBeInstanceOf(Error)
      expect(String(failure)).not.toContain(oversized.secret_id)
    },
  )
})

function boundaryInputs() {
  const config: DeploymentConfig = {
    version: 1,
    cloud: "azure",
    name: "fixture-hub",
    owner: "fixture-team",
    azure: {
      subscriptionId: "00000000-0000-0000-0000-000000000000",
      tenantId: "00000000-0000-0000-0000-000000000001",
      location: "eastus2",
      resourceGroup: "fixture-hub",
    },
  }
  const reference = (vaultLength: number, secretLength: number, prefix = "runtime") => {
    const vault = "v".repeat(vaultLength)
    const secret = prefix + "s".repeat(secretLength - prefix.length)
    return {
      key_vault_id: `/subscriptions/${config.azure.subscriptionId}/resourceGroups/fixture/providers/Microsoft.KeyVault/vaults/${vault}`,
      secret_id: `https://${vault}.vault.azure.net/secrets/${secret}/${"a".repeat(32)}`,
    }
  }
  const inputs = {
    subscription_id: config.azure.subscriptionId,
    name: config.name,
    owner: config.owner,
    location: config.azure.location,
    resource_group_name: config.azure.resourceGroup,
    runtime_database_secret: reference(24, 127),
    setup_database_secret: reference(24, 127, "setup"),
    runtime_secret_references: {} as Record<string, ReturnType<typeof reference>>,
  }
  return { config, inputs, reference }
}
