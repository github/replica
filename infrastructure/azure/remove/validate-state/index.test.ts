import { expect, it } from "vitest"

import type { DeploymentConfig } from "../../../installer/types.ts"
import { installationNames } from "../../install/settings.ts"
import { validateRemovalState } from "./index.ts"

function fixture() {
  const config: DeploymentConfig = {
    version: 1,
    cloud: "azure",
    name: "sample-hub",
    owner: "sample-team",
    azure: {
      subscriptionId: "00000000-0000-0000-0000-000000000001",
      tenantId: "00000000-0000-0000-0000-000000000002",
      location: "eastus2",
      resourceGroup: "sample-hub-rg",
    },
  }
  const group = `/subscriptions/${config.azure.subscriptionId}/resourceGroups/${config.azure.resourceGroup}`
  const identity = {
    address: "azurerm_user_assigned_identity.hub",
    mode: "managed",
    type: "azurerm_user_assigned_identity",
    values: {
      id: `${group}/providers/Microsoft.ManagedIdentity/userAssignedIdentities/sample-hub`,
      principal_id: "00000000-0000-0000-0000-000000000003",
      location: config.azure.location,
      tags: {
        application: "replica-hub",
        installation: config.name,
        owner: config.owner,
        managed_by: "terraform",
      },
    },
  }
  return { config, group, identity }
}

function state(...resources: unknown[]) {
  return { format_version: "1.0", values: { root_module: { resources } } }
}

it("projects owned resources from modern state without treating data lookups as deletions", () => {
  const { config, identity } = fixture()
  expect(
    validateRemovalState(
      state(identity, {
        address: "data.azurerm_client_config.current",
        mode: "data",
        type: "azurerm_client_config",
        values: { id: "/outside/the/installation" },
      }),
      config,
      "app",
    ),
  ).toEqual([
    {
      address: identity.address,
      type: identity.type,
      id: identity.values.id,
      values: identity.values,
    },
  ])
})

it.each([
  { format_version: "1.0", terraform_version: "1.17.1" },
  { format_version: "1.0", values: { outputs: {} } },
  { format_version: "1.0", values: { root_module: {} } },
  state(),
])("accepts an empty valid state without inventing resources", (value) => {
  expect(validateRemovalState(value, fixture().config, "app")).toEqual([])
})

it.each(["artifacts", "releases", "releases/deployment.lock"])(
  "recognizes the owned URL-format storage ID for %s",
  (path) => {
    const { config } = fixture()
    const blob = path.includes("/")
    const type = blob ? "azurerm_storage_blob" : "azurerm_storage_container"
    const address = `${type}.${blob ? "release_lock" : path}`
    const id = `https://samplehubhub.blob.core.windows.net/${path}`
    expect(
      validateRemovalState(
        state({ address, type, mode: "managed", values: { id } }),
        config,
        "app",
      ),
    ).toMatchObject([{ address, id }])
  },
)

it.each(["subscription", "group", "owner", "region", "address", "type", "foreign storage"])(
  "rejects a state resource with a different %s",
  (change) => {
    const { config, identity } = fixture()
    if (change === "subscription")
      identity.values.id = identity.values.id.replace(
        config.azure.subscriptionId,
        config.azure.tenantId,
      )
    if (change === "group")
      identity.values.id = identity.values.id.replace(config.azure.resourceGroup, "another-group")
    if (change === "owner") identity.values.tags.owner = "another-team"
    if (change === "region") identity.values.location = "westus2"
    if (change === "address") identity.address = "azurerm_user_assigned_identity.unmanaged"
    if (change === "type") identity.type = "azurerm_storage_account"
    if (change === "foreign storage") {
      identity.address = "azurerm_storage_container.artifacts"
      identity.type = "azurerm_storage_container"
      identity.values.id = "https://foreign.blob.core.windows.net/artifacts"
    }
    expect(() => validateRemovalState(state(identity), config, "app")).toThrow(
      /unknown|ownership|scope/i,
    )
  },
)

it.each([
  null,
  [],
  { format_version: "1.0", resources: [] },
  { format_version: "1.0", values: null },
  {
    format_version: "1.0",
    values: { root_module: { child_modules: [{ address: "module.unreviewed", resources: [] }] } },
  },
  { format_version: "1.0", values: { root_module: { resources: {} } } },
])("fails closed on malformed or nested state", (value) => {
  expect(() => validateRemovalState(value, fixture().config, "app")).toThrow()
})

it("does not accept an application resource through the foundation allowlist", () => {
  const { config, identity } = fixture()
  expect(() => validateRemovalState(state(identity), config, "foundation")).toThrow()
})

it("rejects duplicated resource addresses or IDs instead of authorizing ambiguous state", () => {
  const { config, identity } = fixture()
  expect(() =>
    validateRemovalState(
      state(identity, {
        ...identity,
        values: { ...identity.values, id: `${identity.values.id}-other` },
      }),
      config,
      "app",
    ),
  ).toThrow()
  expect(() =>
    validateRemovalState(
      state(identity, {
        ...identity,
        address: "azurerm_user_assigned_identity.setup",
      }),
      config,
      "app",
    ),
  ).toThrow()
})

it.each(["0.1", "2.0", undefined])(
  "rejects an unsupported or missing state format %s",
  (format_version) => {
    expect(() =>
      validateRemovalState({ ...state(), format_version }, fixture().config, "app"),
    ).toThrow()
  },
)

it("accepts a known identity's image grant on the exact owned registry", () => {
  const { config, identity } = fixture()
  const names = installationNames(config)
  const scope = `/subscriptions/${config.azure.subscriptionId}/resourceGroups/${names.foundationGroup}/providers/Microsoft.ContainerRegistry/registries/${names.registry}`
  const role = {
    address: "azurerm_role_assignment.image_pull[0]",
    type: "azurerm_role_assignment",
    mode: "managed",
    values: {
      scope,
      role_definition_name: "AcrPull",
      principal_id: identity.values.principal_id,
      id: `${scope}/providers/Microsoft.Authorization/roleAssignments/00000000-0000-0000-0000-000000000004`,
    },
  }
  expect(validateRemovalState(state(identity, role), config, "app")).toHaveLength(2)
})

it.each([
  "foreign principal",
  "foreign role",
  "foreign scope",
  "invalid grant GUID",
  "extra grant path",
])("rejects a role assignment with a %s even when another identity is owned", (change) => {
  const { config, group, identity } = fixture()
  const foundation = `/subscriptions/${config.azure.subscriptionId}/resourceGroups/${installationNames(config).foundationGroup}`
  const values = {
    id: "",
    scope: `${foundation}/providers/Microsoft.ContainerRegistry/registries/${installationNames(config).registry}`,
    principal_id: identity.values.principal_id,
    role_definition_name: "AcrPull",
  }
  if (change === "foreign principal") values.principal_id = "00000000-0000-0000-0000-000000000099"
  if (change === "foreign role") values.role_definition_name = "Owner"
  if (change === "foreign scope")
    values.scope = `${group}-foreign/providers/Microsoft.ContainerRegistry/registries/unrelated`
  values.id = `${values.scope}/providers/Microsoft.Authorization/roleAssignments/00000000-0000-0000-0000-000000000004`
  if (change === "invalid grant GUID")
    values.id = values.id.replace("00000000-0000-0000-0000-000000000004", "not-a-guid")
  if (change === "extra grant path") values.id += "/unreviewed-child"
  expect(() =>
    validateRemovalState(
      state(identity, {
        address: "azurerm_role_assignment.image_pull[0]",
        mode: "managed",
        type: "azurerm_role_assignment",
        values,
      }),
      config,
      "app",
    ),
  ).toThrow(/ownership|scope|unknown/i)
})

it.each(["", "[1]", '["0"]', "[0].unreviewed"])(
  "rejects a count address with suffix %j instead of the only declared instance",
  (suffix) => {
    const { config, group } = fixture()
    expect(() =>
      validateRemovalState(
        state({
          address: `azurerm_container_app.hub${suffix}`,
          type: "azurerm_container_app",
          mode: "managed",
          values: { id: `${group}/providers/Microsoft.App/containerApps/${config.name}-hub` },
        }),
        config,
        "app",
      ),
    ).toThrow()
  },
)

it("does not accept an index on a singleton resource", () => {
  const { config, identity } = fixture()
  identity.address += "[0]"
  expect(() => validateRemovalState(state(identity), config, "app")).toThrow()
})

it.each(["", "[0]", '["FIRST","SECOND"]'])(
  "requires exactly one string key for a runtime-secret for_each address with suffix %j",
  (suffix) => {
    const { config, identity } = fixture()
    const names = installationNames(config)
    const scope = `/subscriptions/${config.azure.subscriptionId}/resourceGroups/${names.foundationGroup}/providers/Microsoft.KeyVault/vaults/${names.vault}/secrets/runtime-value`
    const role = {
      address: `azurerm_role_assignment.runtime_secrets${suffix}`,
      type: "azurerm_role_assignment",
      mode: "managed",
      values: {
        scope,
        role_definition_name: "Key Vault Secrets User",
        principal_id: identity.values.principal_id,
        id: `${scope}/providers/Microsoft.Authorization/roleAssignments/00000000-0000-0000-0000-000000000004`,
      },
    }
    expect(
      validateRemovalState(
        state(identity, {
          ...role,
          address: `azurerm_role_assignment.runtime_secrets[${JSON.stringify(scope)}]`,
        }),
        config,
        "app",
      ),
    ).toHaveLength(2)
    expect(() => validateRemovalState(state(identity, role), config, "app")).toThrow()
  },
)

it("rejects a runtime-secret state key that does not identify its grant scope", () => {
  const { config, identity } = fixture()
  const scope = `/subscriptions/${config.azure.subscriptionId}/resourceGroups/external/providers/Microsoft.KeyVault/vaults/external/secrets/runtime`
  const role = {
    address: `azurerm_role_assignment.runtime_secrets[${JSON.stringify(scope)}]`,
    type: "azurerm_role_assignment",
    mode: "managed",
    values: {
      scope,
      role_definition_name: "Key Vault Secrets User",
      principal_id: identity.values.principal_id,
      id: `${scope}/providers/Microsoft.Authorization/roleAssignments/00000000-0000-0000-0000-000000000004`,
    },
  }
  expect(validateRemovalState(state(identity, role), config, "app")).toHaveLength(2)
  role.address = 'azurerm_role_assignment.runtime_secrets["unverified-scope"]'
  expect(() => validateRemovalState(state(identity, role), config, "app")).toThrow()
})

it("limits provisioning secret keys to the declared database credentials", () => {
  const { config, identity } = fixture()
  const names = installationNames(config)
  identity.address = "azurerm_user_assigned_identity.provision"
  const scope = `/subscriptions/${config.azure.subscriptionId}/resourceGroups/${names.foundationGroup}/providers/Microsoft.KeyVault/vaults/${names.vault}/secrets/database-url`
  const role = {
    address: 'azurerm_role_assignment.secrets["DATABASE_URL"]',
    type: "azurerm_role_assignment",
    mode: "managed",
    values: {
      scope,
      role_definition_name: "Key Vault Secrets User",
      principal_id: identity.values.principal_id,
      id: `${scope}/providers/Microsoft.Authorization/roleAssignments/00000000-0000-0000-0000-000000000004`,
    },
  }
  expect(validateRemovalState(state(identity, role), config, "provision")).toHaveLength(2)
  role.address = 'azurerm_role_assignment.secrets["UNREVIEWED_SECRET"]'
  expect(() => validateRemovalState(state(identity, role), config, "provision")).toThrow()
})

it.each(["image_pull", "setup_image_pull"])(
  "does not interchange the two owned workload principals for %s",
  (name) => {
    const { config, group, identity } = fixture()
    const names = installationNames(config)
    const setup = {
      ...identity,
      address: "azurerm_user_assigned_identity.setup",
      values: {
        ...identity.values,
        id: `${group}/providers/Microsoft.ManagedIdentity/userAssignedIdentities/sample-setup`,
        principal_id: "00000000-0000-0000-0000-000000000005",
      },
    }
    const scope = `/subscriptions/${config.azure.subscriptionId}/resourceGroups/${names.foundationGroup}/providers/Microsoft.ContainerRegistry/registries/${names.registry}`
    const role = {
      address: `azurerm_role_assignment.${name}[0]`,
      type: "azurerm_role_assignment",
      mode: "managed",
      values: {
        scope,
        role_definition_name: "AcrPull",
        principal_id:
          name === "image_pull" ? identity.values.principal_id : setup.values.principal_id,
        id: `${scope}/providers/Microsoft.Authorization/roleAssignments/00000000-0000-0000-0000-000000000004`,
      },
    }
    expect(validateRemovalState(state(identity, setup, role), config, "app")).toHaveLength(3)
    role.values.principal_id =
      name === "image_pull" ? setup.values.principal_id : identity.values.principal_id
    expect(() => validateRemovalState(state(identity, setup, role), config, "app")).toThrow()
  },
)

it.each([
  {
    module: "foundation",
    name: "secrets",
    role: "Key Vault Secrets Officer",
    target: "vault",
    wrong: "foreign vault",
  },
  { module: "foundation", name: "image_push", role: "AcrPush", target: "registry", wrong: "vault" },
  {
    module: "app",
    name: "artifacts",
    role: "Storage Blob Data Contributor",
    target: "container",
    wrong: "release container",
  },
  {
    module: "app",
    name: "deployment_storage[0]",
    role: "Storage Blob Data Contributor",
    target: "account",
    wrong: "container",
  },
  { module: "app", name: "image_pull[0]", role: "AcrPull", target: "registry", wrong: "vault" },
] as const)(
  "limits $name grants to the exact $target rather than a $wrong",
  ({ module, name, role: roleName, target, wrong }) => {
    const { config, group, identity } = fixture()
    const names = installationNames(config)
    const foundation = `/subscriptions/${config.azure.subscriptionId}/resourceGroups/${names.foundationGroup}`
    const vault = `${foundation}/providers/Microsoft.KeyVault/vaults/${names.vault}`
    const account = `${group}/providers/Microsoft.Storage/storageAccounts/samplehubhub`
    const scopes = {
      vault,
      account,
      registry: `${foundation}/providers/Microsoft.ContainerRegistry/registries/${names.registry}`,
      container: `${account}/blobServices/default/containers/artifacts`,
      "foreign vault": `${foundation}/providers/Microsoft.KeyVault/vaults/unrelated`,
      "release container": `${account}/blobServices/default/containers/releases`,
    }
    const values = {
      scope: scopes[target],
      role_definition_name: roleName,
      principal_id: identity.values.principal_id,
      id: "",
    }
    const role = {
      address: `azurerm_role_assignment.${name}`,
      type: "azurerm_role_assignment",
      mode: "managed",
      values,
    }
    values.id = `${values.scope}/providers/Microsoft.Authorization/roleAssignments/00000000-0000-0000-0000-000000000004`
    const resources = module === "app" ? [identity, role] : [role]
    expect(validateRemovalState(state(...resources), config, module)).toHaveLength(resources.length)
    values.scope = scopes[wrong]
    values.id = `${values.scope}/providers/Microsoft.Authorization/roleAssignments/00000000-0000-0000-0000-000000000004`
    expect(() => validateRemovalState(state(...resources), config, module)).toThrow()
  },
)
