import { expect, it } from "vitest"

import { validatePostPlan } from "./index.ts"

function scenario() {
  const appId =
    "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/sample-hub-rg/providers/Microsoft.App/containerApps/sample-hub-hub"
  const image = `registry.azurecr.io/hub@sha256:${"a".repeat(64)}`
  const principalId = "00000000-0000-0000-0000-000000000003"
  const secretScope =
    "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/sample-foundation/providers/Microsoft.KeyVault/vaults/sample-vault/secrets/github-client-secret"
  const references = {
    DATABASE_URL: `https://sample-vault.vault.azure.net/secrets/runtime-database/${"a".repeat(32)}`,
    SERVICE_API_KEY: `https://sample-vault.vault.azure.net/secrets/service-key/${"b".repeat(32)}`,
  }
  const scope = {
    appId,
    image,
    principalId,
    secretScopes: [secretScope],
    environment: {
      PUBLIC_SETTING: "retained",
      HUB_TRUSTED_PROXY_HOPS: "2",
      AZURE_KEY_VAULT_SECRET_REFERENCES: JSON.stringify(references),
    },
  }
  const before = {
    id: appId,
    name: "sample-hub-hub",
    resource_group_name: "sample-hub-rg",
    identity: [{ type: "UserAssigned", identity_ids: ["synthetic-hub-identity"] }],
    ingress: [{ external_enabled: true, target_port: 3001 }],
    template: [
      {
        min_replicas: 1,
        max_replicas: 1,
        container: [
          {
            name: "hub",
            image,
            cpu: 0.5,
            memory: "1Gi",
            env: [
              { name: "PUBLIC_SETTING", value: "retained" },
              { name: "AZURE_KEY_VAULT_SECRET_REFERENCES", value: JSON.stringify(references) },
            ],
          },
        ],
      },
    ],
  }
  const after = structuredClone(before)
  after.template[0]!.container[0]!.env.push({ name: "HUB_TRUSTED_PROXY_HOPS", value: "2" })
  const app = {
    address: "azurerm_container_app.hub[0]",
    mode: "managed",
    type: "azurerm_container_app",
    change: { actions: ["update"], before, after },
  }
  const grant = {
    address: `azurerm_role_assignment.runtime_secrets[${JSON.stringify(secretScope)}]`,
    mode: "managed",
    type: "azurerm_role_assignment",
    change: {
      actions: ["create"],
      before: null,
      after: {
        scope: secretScope,
        principal_id: principalId,
        role_definition_name: "Key Vault Secrets User",
      },
    },
  }
  const plan = { resource_changes: [app, grant] }
  return { scope, plan, app, grant }
}

it("allows only the selected app's intended environment update and its intended secret-scoped read grant", () => {
  const test = scenario()
  test.plan.resource_changes.reverse()
  test.app.change.after.template[0]!.container[0]!.env.reverse()
  const references = test.app.change.after.template[0]!.container[0]!.env.find(
    ({ name }) => name === "AZURE_KEY_VAULT_SECRET_REFERENCES",
  )!
  references.value = JSON.stringify(
    Object.fromEntries(
      Object.entries(JSON.parse(references.value) as Record<string, string>).reverse(),
    ),
  )

  expect(validatePostPlan(test.plan, test.scope)).toBe(true)
})

it.each([
  {
    reason: "a different app resource ID",
    change: (test: ReturnType<typeof scenario>) => {
      test.app.change.after.id = test.app.change.after.id.replace("sample-hub-hub", "another-hub")
    },
  },
  {
    reason: "image drift",
    change: (test: ReturnType<typeof scenario>) => {
      test.app.change.after.template[0]!.container[0]!.image = `registry.azurecr.io/hub@sha256:${"b".repeat(64)}`
    },
  },
  {
    reason: "non-environment app configuration drift",
    change: (test: ReturnType<typeof scenario>) => {
      test.app.change.after.template[0]!.container[0]!.cpu = 1
    },
  },
  {
    reason: "an environment setting outside the requested configuration",
    change: (test: ReturnType<typeof scenario>) => {
      test.app.change.after.template[0]!.container[0]!.env.push({
        name: "UNREQUESTED",
        value: "not approved",
      })
    },
  },
  {
    reason: "app deletion",
    change: (test: ReturnType<typeof scenario>) => {
      test.app.change.actions = ["delete"]
    },
  },
  {
    reason: "app replacement",
    change: (test: ReturnType<typeof scenario>) => {
      test.app.change.actions = ["delete", "create"]
    },
  },
  {
    reason: "a grant to another principal",
    change: (test: ReturnType<typeof scenario>) => {
      test.grant.change.after.principal_id = "00000000-0000-0000-0000-000000000004"
    },
  },
  {
    reason: "a vault-wide grant",
    change: (test: ReturnType<typeof scenario>) => {
      test.grant.change.after.scope = test.grant.change.after.scope.split("/secrets/")[0]!
      test.grant.address = `azurerm_role_assignment.runtime_secrets[${JSON.stringify(test.grant.change.after.scope)}]`
    },
  },
  {
    reason: "a more powerful role on the intended secret",
    change: (test: ReturnType<typeof scenario>) => {
      test.grant.change.after.role_definition_name = "Key Vault Administrator"
    },
  },
])("blocks $reason before apply", ({ change }) => {
  const test = scenario()
  change(test)

  expect(() => validatePostPlan(test.plan, test.scope)).toThrow()
})
