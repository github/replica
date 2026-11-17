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

  it("retains named GitHub settings alongside generic client configuration and Key Vault references", async () => {
    const { config, inputs, reference } = boundaryInputs()
    const settings = {
      hub_application_origin: "https://hub.example.com",
      github_app_id: "123456",
      github_app_installation_id: "7890123",
      github_provider_revision: 2,
      runtime_environment_variables: {
        GITHUB_CLIENT_ID: "Iv23liExampleClient",
        PUBLIC_SETTING: "public",
      },
      runtime_secret_references: {
        GITHUB_CLIENT_SECRET: reference(6, 24, "client"),
        GITHUB_APP_PRIVATE_KEY_BASE64: reference(6, 24, "private"),
      },
    }
    vi.mocked(readPrivateFile).mockResolvedValue(JSON.stringify({ ...inputs, ...settings }))

    await expect(readInstallationInputs("synthetic-installation", config)).resolves.toEqual(settings)
  })

  it.each([
    { form: "a hostname", origin: "https://hub.example.com" },
    { form: "a non-default port", origin: "https://hub.example.com:8443" },
    { form: "a single-label hostname", origin: "https://localhost" },
    { form: "an IPv4 address and the lowest port", origin: "https://127.0.0.1:0" },
    { form: "an IPv6 address and the highest port", origin: "https://[::1]:65535" },
    { form: "a mapped IPv6 address", origin: "https://[::ffff:c000:280]" },
    {
      form: "the maximum length",
      origin: `https://${Array(7).fill("a".repeat(61)).join(".")}.${"a".repeat(58)}`,
    },
  ])("retains an exact HTTPS application origin with $form", async ({ origin }) => {
    const { config, inputs } = boundaryInputs()
    vi.mocked(readPrivateFile).mockResolvedValue(
      JSON.stringify({ ...inputs, hub_application_origin: origin }),
    )

    await expect(readInstallationInputs("synthetic-installation", config)).resolves.toEqual({
      hub_application_origin: origin,
      runtime_secret_references: {},
    })
  })

  it.each([
    { form: "omitted", origin: undefined },
    { form: "null", origin: null },
  ])("keeps the application origin optional when $form", async ({ origin }) => {
    const { config, inputs } = boundaryInputs()
    vi.mocked(readPrivateFile).mockResolvedValue(
      JSON.stringify({ ...inputs, hub_application_origin: origin }),
    )

    await expect(readInstallationInputs("synthetic-installation", config)).resolves.toEqual({
      runtime_secret_references: {},
    })
  })

  it.each([
    { form: "an uppercase host", origin: "https://HUB.example.com" },
    { form: "a shortened IPv4 address", origin: "https://127.1" },
    { form: "a dotted mapped IPv6 address", origin: "https://[::ffff:192.0.2.128]" },
    { form: "an explicit default port", origin: "https://hub.example.com:443" },
    { form: "a zero-padded port", origin: "https://hub.example.com:08443" },
    { form: "a non-numeric port", origin: "https://hub.example.com:not-a-port" },
    { form: "an out-of-range port", origin: "https://hub.example.com:65536" },
    {
      form: "an origin longer than the maximum",
      origin: `https://${Array(7).fill("a".repeat(61)).join(".")}.${"a".repeat(59)}`,
    },
    { form: "a trailing slash", origin: "https://hub.example.com/" },
    { form: "a path", origin: "https://hub.example.com/path" },
    { form: "a query", origin: "https://hub.example.com?synthetic-query" },
    { form: "a fragment", origin: "https://hub.example.com#synthetic-fragment" },
    {
      form: "credentials",
      origin: "https://synthetic-user:synthetic-password@hub.example.com",
    },
    { form: "an HTTP URL", origin: "http://hub.example.com" },
  ])("rejects $form as an application origin with a safe diagnostic", async ({ origin }) => {
    const { config, inputs } = boundaryInputs()
    vi.mocked(readPrivateFile).mockResolvedValue(
      JSON.stringify({ ...inputs, hub_application_origin: origin }),
    )

    const failure = await readInstallationInputs("synthetic-installation", config).catch(
      (error: unknown) => error,
    )

    expect(failure).toBeInstanceOf(Error)
    expect(String(failure)).toMatch(/exact|canonical/i)
    expect(String(failure)).toMatch(/origin/i)
    expect(String(failure)).toContain("https://hub.example.com")
    expect(String(failure)).not.toContain(origin)
    expect(String(failure)).not.toMatch(/synthetic-(user|password|query|fragment)/)
  })

  it("uses generic GitHub identifiers to satisfy client-secret and private-key requirements", async () => {
    const { config, inputs, reference } = boundaryInputs()
    const settings = {
      runtime_environment_variables: {
        HUB_APPLICATION_ORIGIN: "https://hub.example.com",
        GITHUB_APP_ID: "123456",
        GITHUB_CLIENT_ID: "Iv23liExampleClient",
        GITHUB_APP_INSTALLATION_ID: "7890123",
        GITHUB_PROVIDER_REVISION: "2",
      },
      runtime_secret_references: {
        GITHUB_CLIENT_SECRET: reference(6, 24, "client"),
        GITHUB_APP_PRIVATE_KEY_BASE64: reference(6, 24, "private"),
      },
    }
    vi.mocked(readPrivateFile).mockResolvedValue(JSON.stringify({ ...inputs, ...settings }))

    await expect(readInstallationInputs("synthetic-installation", config)).resolves.toEqual(settings)
  })

  it.each([
    { source: "a named App ID", appId: { github_app_id: "123456" }, environment: {} },
    { source: "a generic App ID", appId: {}, environment: { GITHUB_APP_ID: "123456" } },
  ])("accepts a Copilot-only App private key with $source", async ({ appId, environment }) => {
    const { config, inputs, reference } = boundaryInputs()
    const settings = {
      ...appId,
      runtime_environment_variables: {
        ...environment,
        REPLICA_COPILOT_AUTHENTICATION: "github-app-installation",
        REPLICA_COPILOT_GITHUB_INSTALLATION_ID: "7890123",
      },
      runtime_secret_references: {
        GITHUB_APP_PRIVATE_KEY_BASE64: reference(6, 24, "private"),
      },
    }
    vi.mocked(readPrivateFile).mockResolvedValue(JSON.stringify({ ...inputs, ...settings }))

    await expect(readInstallationInputs("synthetic-installation", config)).resolves.toEqual(settings)
  })

  it.each([
    { setting: "no App ID", environment: {}, secret: undefined },
    {
      setting: "a sign-in client ID",
      environment: { GITHUB_APP_ID: "123456", GITHUB_CLIENT_ID: "Iv23liExampleClient" },
      secret: undefined,
    },
    {
      setting: "an installation ID",
      environment: { GITHUB_APP_ID: "123456", GITHUB_APP_INSTALLATION_ID: "7890123" },
      secret: undefined,
    },
    {
      setting: "a webhook secret",
      environment: { GITHUB_APP_ID: "123456" },
      secret: "GITHUB_WEBHOOK_SECRET",
    },
  ])("rejects a Copilot private key with $setting and incomplete App identifiers", async ({
    environment,
    secret,
  }) => {
    const { config, inputs, reference } = boundaryInputs()
    vi.mocked(readPrivateFile).mockResolvedValue(
      JSON.stringify({
        ...inputs,
        runtime_environment_variables: {
          ...environment,
          REPLICA_COPILOT_AUTHENTICATION: "github-app-installation",
        },
        runtime_secret_references: {
          GITHUB_APP_PRIVATE_KEY_BASE64: reference(6, 24, "private"),
          ...(secret && { [secret]: reference(6, 24, "webhook") }),
        },
      }),
    )

    await expect(readInstallationInputs("synthetic-installation", config)).rejects.toBeInstanceOf(
      Error,
    )
  })

  it.each([
    {
      named: "hub_application_origin",
      environment: "HUB_APPLICATION_ORIGIN",
      value: "https://hub.example.com",
    },
    { named: "github_app_id", environment: "GITHUB_APP_ID", value: "123456" },
    { named: "github_client_id", environment: "GITHUB_CLIENT_ID", value: "Iv23liExampleClient" },
    {
      named: "github_app_installation_id",
      environment: "GITHUB_APP_INSTALLATION_ID",
      value: "7890123",
    },
    { named: "github_provider_revision", environment: "GITHUB_PROVIDER_REVISION", value: 2 },
  ])("rejects $named supplied again through generic configuration even when equal", async ({
    named,
    environment,
    value,
  }) => {
    const { config, inputs } = boundaryInputs()
    vi.mocked(readPrivateFile).mockResolvedValue(
      JSON.stringify({
        ...inputs,
        [named]: value,
        runtime_environment_variables: { [environment]: String(value) },
      }),
    )

    await expect(readInstallationInputs("synthetic-installation", config)).rejects.toBeInstanceOf(
      Error,
    )
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
