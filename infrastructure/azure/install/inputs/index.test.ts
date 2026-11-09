import { beforeEach, describe, expect, it, vi } from "vitest"

import { readPrivateFile } from "../../../installer/private-files/index.ts"
import type { DeploymentConfig } from "../../../installer/types.ts"

import { readInstallationInputs } from "./index.ts"

vi.mock("../../../installer/private-files/index.ts", () => ({ readPrivateFile: vi.fn() }))

describe("readInstallationInputs()", () => {
  beforeEach(() => {
    vi.mocked(readPrivateFile).mockReset()
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
})
