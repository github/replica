import { randomUUID } from "node:crypto"
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { afterEach, expect, it, vi } from "vitest"

import type { DeploymentConfig, RunCommand, WizardUI } from "../../../installer/types.ts"
import { installationNames } from "../../install/settings.ts"
import type { RemovalContext, RemovalModule } from "../types.ts"
import { prepareRemovalModule } from "./index.ts"

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function scenario(kind: RemovalModule = "app") {
  const root = resolve(`.removal-prepare-test-${randomUUID()}`)
  directories.push(root)
  await mkdir(root, { mode: 0o700 })
  const directory = join(root, "original")
  const staging = join(root, "staging")
  await mkdir(directory, { mode: 0o700 })
  await mkdir(staging, { mode: 0o700 })
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
  const names = installationNames(config)
  const group = `/subscriptions/${config.azure.subscriptionId}/resourceGroups/${kind === "foundation" ? names.foundationGroup : config.azure.resourceGroup}`
  const resource = {
    address: kind === "foundation" ? "azurerm_key_vault.hub" : "azurerm_resource_group.hub",
    type: kind === "foundation" ? "azurerm_key_vault" : "azurerm_resource_group",
    mode: "managed",
    values: {
      id:
        kind === "foundation"
          ? `${group}/providers/Microsoft.KeyVault/vaults/${names.vault}`
          : group,
      location: config.azure.location,
      tags: {
        application: "replica-hub",
        installation: config.name,
        owner: config.owner,
        managed_by: "terraform",
      },
    },
  }
  const inputs = {
    subscription_id: config.azure.subscriptionId,
    name: config.name,
    owner: config.owner,
    location: config.azure.location,
    resource_group_name: config.azure.resourceGroup,
    postgres_sku: "GP_Standard_D2ds_v5",
    postgres_version: "17",
    backup_retention_days: 14,
    image: "sample.azurecr.io/hub@sha256:synthetic",
    runtime_secret_references: {
      SAMPLE: {
        key_vault_id: `${group}/providers/Microsoft.KeyVault/vaults/sample-secrets`,
        secret_id: "https://sample-secrets.vault.azure.net/secrets/runtime-value",
      },
    },
    setup_database_secret: {
      key_vault_id: `${group}/providers/Microsoft.KeyVault/vaults/sample-secrets`,
      secret_id: "https://sample-secrets.vault.azure.net/secrets/setup-value",
    },
  }
  const original = join(directory, "installation.tfvars.json")
  const retained = JSON.stringify(inputs)
  await writeFile(original, retained, { mode: 0o600 })
  await writeFile(join(directory, "backend.hcl"), 'storage_account_name = "foreign-account"\n', {
    mode: 0o600,
  })
  const evidence = {
    resources: [resource],
    actions: ["delete"],
    plannedId: resource.values.id,
    stateAfter: [] as string[],
  }
  const run = vi.fn<RunCommand>(async (executable, args) => {
    expect(executable).toBe("terraform")
    const operation = args[1]
    if (operation === "show" && args.at(-1)?.endsWith(".tfplan"))
      return JSON.stringify({
        format_version: "1.2",
        resource_changes: evidence.resources.map((value) => ({
          address: value.address,
          change: { actions: evidence.actions, before: { id: evidence.plannedId }, after: null },
        })),
      })
    if (operation === "show")
      return JSON.stringify({
        format_version: "1.0",
        values: { root_module: { resources: evidence.resources } },
      })
    if (operation === "state") return evidence.stateAfter.join("\n")
    if (["init", "plan", "apply"].includes(operation!)) return ""
    throw new Error("Unexpected synthetic Terraform operation")
  })
  const ui: WizardUI = {
    cloud: vi.fn(),
    select: vi.fn(),
    text: vi.fn(),
    confirm: vi.fn(),
    wait: vi.fn(),
    status: vi.fn(),
    notice: vi.fn(),
  }
  const context: RemovalContext = {
    config,
    target: { path: join(root, "config.json"), config },
    directory,
    run,
    ui,
    env: { ARM_SUBSCRIPTION_ID: config.azure.subscriptionId },
    azure: vi.fn(async () => {
      throw new Error("Removal must not read live secrets")
    }),
  }
  return { context, root, staging, original, retained, inputs, resource, run, evidence, names }
}

it("uses the owned backend, retains app customizations privately, and destroys with a non-secret password placeholder", async () => {
  const test = await scenario()
  const module = await prepareRemovalModule(test.context, "app", test.staging)
  const variables = JSON.parse(await readFile(join(test.staging, "app-variables.json"), "utf8"))
  expect(variables).toMatchObject({
    ...test.inputs,
    deploy_hub: false,
    postgres_admin_password: expect.any(String),
  })
  expect(variables.postgres_admin_password).toMatch(/destroy.only/i)
  const backend = await readFile(join(test.staging, "app-backend.hcl"), "utf8")
  for (const value of [
    test.names.stateAccount,
    test.names.stateGroup,
    "sample-hub/app.tfstate",
    test.context.config.azure.tenantId,
  ])
    expect(backend).toContain(value)
  expect(backend).not.toContain("foreign-account")

  await module.verifyInputs()
  await module.destroy()
  await module.empty()

  expect(await readFile(test.original, "utf8")).toBe(test.retained)
  expect(test.context.azure).not.toHaveBeenCalled()
  expect(test.context.ui.select).not.toHaveBeenCalled()
  expect(test.context.ui.confirm).not.toHaveBeenCalled()
  expect(test.run.mock.calls.find(([, args]) => args[1] === "plan")![1]).toContain("-destroy")
  const apply = test.run.mock.calls.find(([, args]) => args[1] === "apply")![1]
  const show = test.run.mock.calls.find(
    ([, args]) => args[1] === "show" && args.at(-1)?.endsWith(".tfplan"),
  )![1]
  expect(apply.at(-1)).toBe(show.at(-1))
  expect(await readdir(join(test.staging, "app-data"))).toEqual([])
})

it.each(["foreign subscription", "foreign resource group", "missing saved inputs"])(
  "stops before destroy planning for %s without rewriting originals",
  async (problem) => {
    const test = await scenario()
    if (problem === "foreign subscription")
      test.inputs.subscription_id = test.context.config.azure.tenantId
    if (problem === "foreign resource group") test.inputs.resource_group_name = "foreign-group"
    const content = JSON.stringify(test.inputs)
    if (problem === "missing saved inputs") await rm(test.original)
    else await writeFile(test.original, content, { mode: 0o600 })

    await expect(prepareRemovalModule(test.context, "app", test.staging)).rejects.toThrow(
      /inputs|identity/i,
    )

    expect(test.run.mock.calls.some(([, args]) => args[1] === "plan")).toBe(false)
    if (problem !== "missing saved inputs")
      expect(await readFile(test.original, "utf8")).toBe(content)
  },
)

it("detects changed generated inputs before a later deletion", async () => {
  const test = await scenario()
  const module = await prepareRemovalModule(test.context, "app", test.staging)
  const changed = JSON.stringify({ ...test.inputs, postgres_version: "16" })
  await writeFile(test.original, changed, { mode: 0o600 })

  await expect(module.verifyInputs()).rejects.toThrow(/changed/i)

  expect(await readFile(test.original, "utf8")).toBe(changed)
  expect(test.run.mock.calls.some(([, args]) => args[1] === "apply")).toBe(false)
})

it("accepts empty app state without reading or overwriting invalid legacy generated inputs", async () => {
  const test = await scenario()
  test.evidence.resources = []
  await writeFile(test.original, "synthetic invalid retained input", { mode: 0o600 })
  const module = await prepareRemovalModule(test.context, "app", test.staging)

  await module.verifyInputs()
  await module.destroy()
  await module.empty()

  expect(test.run.mock.calls.some(([, args]) => args[1] === "plan")).toBe(false)
  expect(await readFile(test.original, "utf8")).toBe("synthetic invalid retained input")
  expect(await readdir(test.staging)).not.toContain("app-variables.json")
})

it("does not treat data-source-only state as a managed resource after destroy", async () => {
  const test = await scenario()
  test.evidence.stateAfter = ["data.azurerm_client_config.current"]
  const module = await prepareRemovalModule(test.context, "app", test.staging)

  await expect(module.destroy()).resolves.toBeUndefined()
  await expect(module.empty()).resolves.toBeUndefined()

  expect(test.run.mock.calls.some(([, args]) => args[1] === "apply")).toBe(true)
})

it("derives foundation variables from the selected identity without consuming retained inputs or secrets", async () => {
  const test = await scenario("foundation")
  await writeFile(
    join(test.context.directory, "foundation.tfvars.json"),
    "untrusted saved content",
    { mode: 0o600 },
  )

  const module = await prepareRemovalModule(test.context, "foundation", test.staging)
  await module.destroy()

  expect(
    JSON.parse(await readFile(join(test.staging, "foundation-variables.json"), "utf8")),
  ).toMatchObject({
    name: test.context.config.name,
    tenant_id: test.context.config.azure.tenantId,
    registry_name: test.names.registry,
    vault_name: test.names.vault,
  })
  expect(await readFile(join(test.context.directory, "foundation.tfvars.json"), "utf8")).toBe(
    "untrusted saved content",
  )
  expect(test.context.azure).not.toHaveBeenCalled()
})

it("removes retained provisioning with case-insensitive ARM IDs without retrieving credentials", async () => {
  const test = await scenario("provision")
  const config = test.context.config
  const foundation = `/subscriptions/${config.azure.subscriptionId}/resourceGroups/${test.names.foundationGroup.toUpperCase()}`
  const group = `/subscriptions/${config.azure.subscriptionId}/resourceGroups/${config.azure.resourceGroup.toUpperCase()}`
  test.resource.address = "azurerm_container_app_job.provision"
  test.resource.type = "azurerm_container_app_job"
  delete test.resource.values.tags
  const identityId =
    `${group}/providers/Microsoft.ManagedIdentity/userAssignedIdentities/${config.name}-provision`
  test.resource.values.id = `${group}/providers/Microsoft.App/jobs/${config.name}-provision`
  Object.assign(test.resource.values, {
    name: `${config.name}-provision`,
    resource_group_name: config.azure.resourceGroup,
    container_app_environment_id:
      `${group}/providers/Microsoft.App/managedEnvironments/${config.name}-environment`,
    identity: [{
      type: "UserAssigned",
      identity_ids: [identityId],
    }],
  })
  test.evidence.plannedId = test.resource.values.id
  const original = join(test.context.directory, "provision.tfvars.json")
  const content = JSON.stringify({
    subscription_id: config.azure.subscriptionId,
    name: config.name,
    location: config.azure.location,
    resource_group: config.azure.resourceGroup,
    environment_id: `${group}/providers/Microsoft.App/managedEnvironments/${config.name}-environment`,
    vault_id: `${foundation}/providers/Microsoft.KeyVault/vaults/${test.names.vault}`,
    registry_id: `${foundation}/providers/Microsoft.ContainerRegistry/registries/${test.names.registry}`,
    image: `${test.names.registry}.azurecr.io/hub@sha256:${"a".repeat(64)}`,
    secret_urls: Object.fromEntries(
      ["DATABASE_URL", "HUB_MIGRATION_PASSWORD", "HUB_RUNTIME_PASSWORD"].map((key) => [
        key,
        `https://${test.names.vault}.vault.azure.net/secrets/${key.toLowerCase().replaceAll("_", "-")}/${"a".repeat(32)}`,
      ]),
    ),
  })
  await writeFile(original, content, { mode: 0o600 })

  const module = await prepareRemovalModule(test.context, "provision", test.staging)
  await module.destroy()

  expect(await readFile(original, "utf8")).toBe(content)
  expect(test.context.azure).not.toHaveBeenCalled()
  expect(test.context.ui.confirm).not.toHaveBeenCalled()
  expect(test.run.mock.calls.some(([, args]) => args[1] === "apply")).toBe(true)
})

it.each(["changed ID", "update"])(
  "rejects a destroy plan containing %s even with the approved address",
  async (problem) => {
    const test = await scenario()
    const module = await prepareRemovalModule(test.context, "app", test.staging)
    if (problem === "changed ID") test.evidence.plannedId += "-foreign"
    else test.evidence.actions = ["update"]

    await expect(module.destroy()).rejects.toThrow(/scope|identity|actions/i)

    expect(test.run.mock.calls.some(([, args]) => args[1] === "apply")).toBe(false)
    expect(test.context.ui.select).not.toHaveBeenCalled()
    expect(await readdir(join(test.staging, "app-data"))).toEqual([])
  },
)

it("requires empty Terraform state after apply and before deleting state storage", async () => {
  const test = await scenario()
  test.evidence.stateAfter = [test.resource.address]
  const module = await prepareRemovalModule(test.context, "app", test.staging)

  await expect(module.destroy()).rejects.toThrow(/empty.*state|backend.*preserved/i)
  await expect(module.empty()).rejects.toThrow(/still tracks|cannot be removed/i)

  expect(test.run.mock.calls.filter(([, args]) => args[1] === "apply")).toHaveLength(1)
  expect(await readFile(test.original, "utf8")).toBe(test.retained)
})
