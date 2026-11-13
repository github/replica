import { resolve } from "node:path"
import { expect, it, vi } from "vitest"

import { CommandExecutionError } from "../../../installer/command/index.ts"
import type { DeploymentConfig, WizardUI } from "../../../installer/types.ts"
import { installationNames } from "../../install/settings.ts"
import type { RemovalContext, RemovalResource } from "../types.ts"
import { inspectSharedRemoval } from "./index.ts"

function scenario() {
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
  const group = `/subscriptions/${config.azure.subscriptionId}/resourceGroups/${config.azure.resourceGroup}`
  const owned = {
    id: `${group}/providers/Microsoft.App/containerApps/${config.name}-hub`,
    environment: `${group}/providers/Microsoft.App/managedEnvironments/${config.name}-environment`,
  }
  const foreign: Record<string, unknown> = {
    id: `/subscriptions/${config.azure.subscriptionId}/resourceGroups/unrelated/providers/Microsoft.App/containerApps/unrelated`,
    environment: `/subscriptions/${config.azure.subscriptionId}/resourceGroups/unrelated/providers/Microsoft.App/managedEnvironments/unrelated`,
    images: ["unrelated.azurecr.io/app:latest"],
    initialImages: [],
    registries: ["unrelated.azurecr.io"],
    secrets: ["https://unrelated.vault.azure.net/secrets/runtime"],
    identityPresent: true,
    identity: null,
  }
  const evidence = {
    apps: [owned, foreign] as unknown,
    jobs: [] as unknown,
    revisions: [{
      name: "unrelated--current",
      active: true,
      replicas: 0,
      identityIds: [],
      images: ["unrelated.azurecr.io/app:latest"],
      initialImages: [],
      runtimeReferences: [],
      initialReferences: [],
    }] as unknown,
    grants: [] as unknown,
    detail: foreign as unknown,
  }
  const azure = vi.fn(async (...args: string[]) => {
    const show = args[1] === "show" || args[2] === "show"
    const operation = args.slice(0, 3).join(" ")
    if (!show && operation !== "containerapp revision list")
      expect(args).not.toContain("--resource-group")
    if (args[0] === "containerapp") {
      const projection = args[args.indexOf("--query") + 1]
      expect(projection).toContain(
        "runtimeReferences:properties.template.containers[].env[?name=='AZURE_KEY_VAULT_SECRET_REFERENCES'].value[]",
      )
      expect(projection).toContain(
        "initialReferences:properties.template.initContainers[].env[?name=='AZURE_KEY_VAULT_SECRET_REFERENCES'].value[]",
      )
      expect(projection?.startsWith("[].")).toBe(!show)
    }
    if (show) {
      if (args.includes("--ids")) expect(args[args.indexOf("--ids") + 1]).toBe(foreign.id)
      else {
        expect(args[args.indexOf("--name") + 1]).toBe("unrelated")
        expect(args[args.indexOf("--resource-group") + 1]).toBe("unrelated")
      }
      return JSON.stringify(evidence.detail)
    }
    if (operation === "containerapp revision list")
      return JSON.stringify(evidence.revisions)
    if (args[0] === "containerapp" && args[1] === "list") return JSON.stringify(evidence.apps)
    if (args.slice(0, 3).join(" ") === "containerapp job list") return JSON.stringify(evidence.jobs)
    if (args.slice(0, 3).join(" ") === "role assignment list") {
      expect(args).toEqual(
        expect.arrayContaining([
          "--all",
          "--fill-principal-name",
          "false",
          "--fill-role-definition-name",
          "false",
        ]),
      )
      return JSON.stringify(evidence.grants)
    }
    throw new Error("Shared removal inspection must only read projected workloads and grants")
  })
  const context: RemovalContext = {
    config,
    target: { path: resolve("synthetic-not-read.json"), config },
    directory: resolve("synthetic-not-read"),
    env: {},
    azure,
    run: vi.fn(),
    ui: {} as WizardUI,
  }
  const resources: RemovalResource[] = [
    {
      address: "azurerm_container_app.hub[0]",
      type: "azurerm_container_app",
      id: owned.id,
      values: {},
    },
  ]
  return { context, azure, resources, names, owned, foreign, evidence }
}

it("allows tracked workloads and unrelated consumers without treating the whole subscription as owned", async () => {
  const test = scenario()
  await expect(inspectSharedRemoval(test.context, test.resources)).resolves.toBeUndefined()
  expect(test.azure).toHaveBeenCalledTimes(4)
})

it("skips optional consumer metadata only for the exact canonical owned app and jobs", async () => {
  const test = scenario()
  const group = test.owned.id.split("/providers/")[0]!
  const jobs = ["setup", "provision"].map((kind) => ({
    id: `${group}/providers/Microsoft.App/jobs/${test.context.config.name}-${kind}`,
  }))
  test.evidence.apps = [{ id: test.owned.id }, test.foreign]
  test.evidence.jobs = jobs

  await expect(inspectSharedRemoval(test.context, [
    ...test.resources,
    ...jobs.map(({ id }, index) => ({
      address: `azurerm_container_app_job.owned${index}`,
      type: "azurerm_container_app_job",
      id,
      values: {},
    })),
  ])).resolves.toBeUndefined()
  expect(test.azure).toHaveBeenCalledTimes(4)
})

it.each(["absent", "null"])("accepts %s optional foreign reference lists without a detail lookup", async (value) => {
  const test = scenario()
  for (const field of [
    "images", "initialImages", "registries", "secrets", "runtimeReferences", "initialReferences",
  ]) {
    if (value === "absent") delete test.foreign[field]
    else test.foreign[field] = null
  }

  await expect(inspectSharedRemoval(test.context, test.resources)).resolves.toBeUndefined()
  expect(test.azure).toHaveBeenCalledTimes(4)
})

it("does not exempt an unselected workload whose ID merely starts with the owned app ID", async () => {
  const test = scenario()
  test.foreign.id = `${test.owned.id}-foreign`
  test.foreign.environment = test.owned.environment

  await expect(inspectSharedRemoval(test.context, test.resources)).rejects.toMatchObject({
    name: "RemovalInspectionError",
    message: expect.stringContaining(String(test.foreign.id)),
  })
})

it("blocks an unselected workload that attaches an identity scheduled for deletion", async () => {
  const test = scenario()
  const group = test.owned.id.split("/providers/")[0]!
  const identityId =
    `${group}/providers/Microsoft.ManagedIdentity/userAssignedIdentities/${test.context.config.name}-hub`
  test.foreign.identity = {
    type: "UserAssigned",
    userAssignedIdentities: { [identityId]: {} },
  }
  test.resources.push({
    address: "azurerm_user_assigned_identity.hub",
    type: "azurerm_user_assigned_identity",
    id: identityId,
    values: {},
  })

  await expect(inspectSharedRemoval(test.context, test.resources)).rejects.toMatchObject({
    name: "RemovalInspectionError",
    message: expect.stringContaining(String(test.foreign.id)),
  })
})

it.each(["app", "job"] as const)(
  "blocks an unselected $0 whose targeted detail reveals a shared identity",
  async (kind) => {
    const test = scenario()
    if (kind === "job")
      test.foreign.id = String(test.foreign.id).replace("/containerApps/", "/jobs/")
    const identityId =
      `${test.owned.id.split("/providers/")[0]}/providers/Microsoft.ManagedIdentity/userAssignedIdentities/${test.context.config.name}-hub`
    test.resources.push({
      address: "azurerm_user_assigned_identity.hub",
      type: "azurerm_user_assigned_identity",
      id: identityId,
      values: {},
    })
    const incomplete = { ...test.foreign, environment: null }
    test.evidence.apps = kind === "app" ? [test.owned, incomplete] : [test.owned]
    test.evidence.jobs = kind === "job" ? [incomplete] : []
    test.evidence.detail = {
      ...test.foreign,
      identity: { type: "UserAssigned", userAssignedIdentities: { [identityId]: {} } },
    }

    await expect(inspectSharedRemoval(test.context, test.resources)).rejects.toMatchObject({
      name: "RemovalInspectionError",
      message: expect.stringContaining(String(test.foreign.id)),
    })
    expect(test.azure.mock.calls.filter((args) => args.includes("show"))).toHaveLength(1)
  },
)

it.each(["absent", "malformed"] as const)(
  "blocks unknown identity metadata after a targeted detail lookup when it is %s",
  async (problem) => {
    const test = scenario()
    const identity = problem === "absent"
      ? { identityPresent: false }
      : { identityPresent: true, identity: { userAssignedIdentities: {} } }
    test.evidence.apps = [test.owned, { ...test.foreign, ...identity }]
    test.evidence.detail = { ...test.foreign, ...identity }

    await expect(inspectSharedRemoval(test.context, test.resources)).rejects.toMatchObject({
      name: "RemovalInspectionError",
      message: expect.stringContaining(String(test.foreign.id)),
    })
    expect(test.azure.mock.calls.filter((args) => args.includes("show"))).toHaveLength(1)
  },
)

it("allows a workload whose targeted detail confirms no identity", async () => {
  const test = scenario()
  test.evidence.apps = [test.owned, { ...test.foreign, identityPresent: false }]
  test.evidence.detail = { ...test.foreign, identityPresent: true, identity: null }

  await expect(inspectSharedRemoval(test.context, test.resources)).resolves.toBeUndefined()
  expect(test.azure.mock.calls.filter((args) => args.includes("show"))).toHaveLength(1)
})

it.each([
  { field: "images", state: "active", active: true, replicas: 0 },
  { field: "images", state: "replica", active: false, replicas: 1 },
  { field: "runtimeReferences", state: "active", active: true, replicas: 0 },
  { field: "runtimeReferences", state: "replica", active: false, replicas: 1 },
  { field: "identityIds", state: "active", active: true, replicas: 0 },
  { field: "identityIds", state: "replica", active: false, replicas: 1 },
] as const)(
  "blocks an older $state revision that still uses the installation through $field",
  async ({ field, state, active, replicas }) => {
    const test = scenario()
    const revision: Record<string, unknown> = {
      name: `${test.context.config.name}-hub--older-${state}`,
      active,
      replicas,
      identityIds: [],
    }
    if (field === "images")
      revision.images = [`${test.names.registry}.azurecr.io/replica-hub@sha256:${"a".repeat(64)}`]
    if (field === "runtimeReferences")
      revision.runtimeReferences = [
        JSON.stringify({
          SERVICE_API_KEY: `https://${test.names.vault}.vault.azure.net/secrets/runtime`,
        }),
      ]
    if (field === "identityIds") {
      revision.identityIds = [
        `${test.owned.id.split("/providers/")[0]}/providers/Microsoft.ManagedIdentity/userAssignedIdentities/${test.context.config.name}-hub`,
      ]
      test.resources.push({
        address: "azurerm_user_assigned_identity.hub",
        type: "azurerm_user_assigned_identity",
        id: revision.identityIds[0] as string,
        values: {},
      })
    }
    test.evidence.revisions = [revision]

    await expect(inspectSharedRemoval(test.context, test.resources)).rejects.toMatchObject({
      name: "RemovalInspectionError",
      message: expect.stringContaining(String(test.foreign.id)),
    })
    expect(
      test.azure.mock.calls.some((args) => args.slice(0, 3).join(" ") === "containerapp revision list"),
    ).toBe(true)
  },
)

it("ignores an inactive older revision with no replicas", async () => {
  const test = scenario()
  test.evidence.revisions = [{
    name: `${test.context.config.name}-hub--older-inactive`,
    active: false,
    replicas: 0,
    identityIds: [],
    images: [`${test.names.registry}.azurecr.io/replica-hub:latest`],
    runtimeReferences: [
      JSON.stringify({
        SERVICE_API_KEY: `https://${test.names.vault}.vault.azure.net/secrets/runtime`,
      }),
    ],
  }]

  await expect(inspectSharedRemoval(test.context, test.resources)).resolves.toBeUndefined()
})

it.each(["foreign subscription", "private URI"])(
  "rejects a workload identified by a %s without displaying unvalidated identity data",
  async (kind) => {
    const test = scenario()
    const untrusted = kind === "foreign subscription"
      ? String(test.foreign.id).replace(
        test.context.config.azure.subscriptionId,
        "00000000-0000-0000-0000-000000000099",
      )
      : "https://private.example.invalid/synthetic-private-path?private-token"
    test.foreign.id = untrusted
    const pending = inspectSharedRemoval(test.context, test.resources)

    await expect(pending).rejects.toMatchObject({ name: "RemovalInspectionError" })
    await expect(pending).rejects.toThrow(/resource.*id/i)
    await expect(pending).rejects.not.toThrow(untrusted)
    expect(test.azure.mock.calls.some((args) => args.includes("show"))).toBe(false)
  },
)

it.each([
  { kind: "app", field: "environment", value: null },
  { kind: "job", field: "images", value: {} },
])("resolves incomplete foreign $kind $field metadata with one targeted projected show", async ({
  kind, field, value,
}) => {
  const test = scenario()
  if (kind === "job")
    test.foreign.id = String(test.foreign.id).replace("/containerApps/", "/jobs/")
  const incomplete = { ...test.foreign, [field]: value }
  test.evidence.apps = kind === "app" ? [test.owned, incomplete] : [test.owned]
  test.evidence.jobs = kind === "job" ? [incomplete] : []

  await expect(inspectSharedRemoval(test.context, test.resources)).resolves.toBeUndefined()

  const shows = test.azure.mock.calls.filter((args) => args.includes("show"))
  expect(shows).toHaveLength(1)
  expect(shows[0]!.slice(0, kind === "job" ? 3 : 2)).toEqual(
    kind === "job" ? ["containerapp", "job", "show"] : ["containerapp", "show"],
  )
  const list = test.azure.mock.calls.find((args) =>
    args.slice(0, kind === "job" ? 3 : 2).join(" ") ===
    (kind === "job" ? "containerapp job list" : "containerapp list"),
  )!
  expect(shows[0]![shows[0]!.indexOf("--query") + 1]).toBe(
    list[list.indexOf("--query") + 1]!.slice(3),
  )
})

it("identifies an unresolved foreign field after one show without echoing private payloads", async () => {
  const test = scenario()
  const image = "private.azurecr.io/synthetic-private-image:latest"
  const encoded = '{"PRIVATE_VALUE":"https://private.vault.azure.net/secrets/private?private-token"}'
  const incomplete = {
    ...test.foreign,
    environment: null,
    images: [image],
    runtimeReferences: [encoded],
    privatePayload: "synthetic-private-payload",
  }
  test.evidence.apps = [test.owned, incomplete]
  test.evidence.detail = incomplete
  const pending = inspectSharedRemoval(test.context, test.resources)

  await expect(pending).rejects.toMatchObject({
    name: "RemovalInspectionError",
    message: expect.stringContaining(String(test.foreign.id)),
  })
  for (const target of [
    test.context.config.name, test.context.config.azure.subscriptionId, "environment",
  ])
    await expect(pending).rejects.toMatchObject({ message: expect.stringContaining(target) })
  await expect(pending).rejects.toThrow(/recheck|read.only/i)
  for (const secret of [image, encoded, "private-token", "synthetic-private-payload"])
    await expect(pending).rejects.not.toThrow(secret)
  expect(test.azure.mock.calls.filter((args) => args.includes("show"))).toHaveLength(1)
})

it("rejects detail metadata for a different workload instead of accepting replacement evidence", async () => {
  const test = scenario()
  test.evidence.apps = [test.owned, { ...test.foreign, environment: null }]
  test.evidence.detail = { ...test.foreign, id: test.owned.id }
  const pending = inspectSharedRemoval(test.context, test.resources)

  await expect(pending).rejects.toMatchObject({
    name: "RemovalInspectionError",
    message: expect.stringContaining(String(test.foreign.id)),
  })
  await expect(pending).rejects.toThrow(/identity|match/i)
  expect(test.azure.mock.calls.filter((args) => args.includes("show"))).toHaveLength(1)
})

it.each(["environment", "images", "initialImages", "registries", "secrets"])(
  "blocks a workload in another group that shares the dedicated foundation through %s",
  async (field) => {
    const test = scenario()
    const sharedEnvironment = test.owned.environment
    test.foreign[field] = field === "environment"
      ? sharedEnvironment
      : field === "secrets"
        ? [`https://${test.names.vault}.vault.azure.net/secrets/shared-value`]
        : [
            field === "registries"
              ? `${test.names.registry}.azurecr.io`
              : `${test.names.registry}.azurecr.io/hub@sha256:synthetic`,
          ]

    const pending = inspectSharedRemoval(test.context, test.resources)
    await expect(pending).rejects.toMatchObject({
      name: "RemovalInspectionError",
      message: expect.stringContaining(String(test.foreign.id)),
    })
    await expect(pending).rejects.toThrow(
      field === "environment" ? `${test.context.config.name}-environment`
        : field === "secrets" ? test.names.vault : test.names.registry,
    )
    expect(test.azure.mock.calls.some((args) => args.includes("show"))).toBe(false)
  },
)

it.each(["malformed images", "malformed secret URL", "unknown jobs"])(
  "fails closed on %s rather than assuming there are no external consumers",
  async (problem) => {
    const test = scenario()
    if (problem === "malformed images") test.foreign.images = {}
    if (problem === "malformed secret URL") test.foreign.secrets = ["not a secret URL"]
    if (problem === "unknown jobs") test.evidence.jobs = null

    await expect(inspectSharedRemoval(test.context, test.resources)).rejects.toMatchObject({
      name: "RemovalInspectionError",
    })
  },
)

it("does not accept an incomplete subscription discovery that omits a tracked workload", async () => {
  const test = scenario()
  test.evidence.apps = [test.foreign]
  await expect(inspectSharedRemoval(test.context, test.resources)).rejects.toThrow(
    /tracked app or job/i,
  )
})

it("accepts only tracked foundation grants while preserving unrelated grant scopes", async () => {
  const test = scenario()
  const scope = `/subscriptions/${test.context.config.azure.subscriptionId}/resourceGroups/${test.names.foundationGroup}/providers/Microsoft.KeyVault/vaults/${test.names.vault}`
  const id = `${scope}/providers/Microsoft.Authorization/roleAssignments/00000000-0000-0000-0000-000000000003`
  test.evidence.grants = [
    { id, scope, principalType: "User", principalName: "synthetic-private-operator@example.invalid" },
    {
      id: "/subscriptions/unrelated/providers/Microsoft.Authorization/roleAssignments/unrelated",
      scope: "/subscriptions/unrelated",
    },
  ]
  await expect(
    inspectSharedRemoval(test.context, [
      ...test.resources,
      {
        address: "azurerm_role_assignment.runtime_secrets",
        type: "azurerm_role_assignment",
        id,
        values: {},
      },
    ]),
  ).resolves.toBeUndefined()
  const pending = inspectSharedRemoval(test.context, test.resources)
  await expect(pending).rejects.toMatchObject({ name: "RemovalInspectionError" })
  for (const target of [scope, id, test.context.config.name, test.context.config.azure.subscriptionId])
    await expect(pending).rejects.toMatchObject({ message: expect.stringContaining(target) })
  await expect(pending).rejects.toThrow(/recheck|read.only/i)
  await expect(pending).rejects.not.toThrow("synthetic-private-operator@example.invalid")
})

it("propagates denied discovery rather than falling back to an empty inventory", async () => {
  const test = scenario()
  const denied = new CommandExecutionError("Synthetic metadata access denied", false, 1)
  test.azure.mockRejectedValueOnce(denied)
  await expect(inspectSharedRemoval(test.context, test.resources)).rejects.toBe(denied)
})

it("names malformed subscription discovery without displaying the response or treating it as empty", async () => {
  const test = scenario()
  const payload = "synthetic-private-non-json-payload"
  test.azure.mockResolvedValueOnce(payload)
  const pending = inspectSharedRemoval(test.context, test.resources)

  await expect(pending).rejects.toMatchObject({
    name: "RemovalInspectionError",
    message: expect.stringContaining("containerapp list"),
  })
  await expect(pending).rejects.not.toThrow(payload)
  expect(test.azure).toHaveBeenCalledOnce()
})

it("propagates a denied targeted show without treating the foreign workload as absent", async () => {
  const test = scenario()
  test.evidence.apps = [test.owned, { ...test.foreign, environment: null }]
  const denied = new CommandExecutionError("Synthetic workload inspection denied", false, 1)
  const execute = test.azure.getMockImplementation()!
  test.azure.mockImplementation(async (...args) => {
    if (args.includes("show")) throw denied
    return execute(...args)
  })

  await expect(inspectSharedRemoval(test.context, test.resources)).rejects.toBe(denied)
  expect(test.azure.mock.calls.filter((args) => args.includes("show"))).toHaveLength(1)
})

it("accepts decoded runtime and init-container maps that reference only an unrelated vault", async () => {
  const test = scenario()
  const encoded = JSON.stringify({
    RUNTIME_VALUE: "https://unrelated.vault.azure.net/secrets/runtime",
  })
  test.foreign.runtimeReferences = [encoded]
  test.foreign.initialReferences = [encoded]

  await expect(inspectSharedRemoval(test.context, test.resources)).resolves.toBeUndefined()
})

it.each(["runtimeReferences", "initialReferences"])(
  "blocks a cross-group workload referencing the owned vault through %s",
  async (field) => {
    const test = scenario()
    test.foreign[field] = [
      JSON.stringify({
        RUNTIME_VALUE: `https://${test.names.vault}.vault.azure.net/secrets/runtime`,
      }),
    ]

    const pending = inspectSharedRemoval(test.context, test.resources)
    await expect(pending).rejects.toMatchObject({
      name: "RemovalInspectionError",
      message: expect.stringContaining(String(test.foreign.id)),
    })
    await expect(pending).rejects.toThrow(test.names.vault)
    await expect(pending).rejects.not.toThrow("RUNTIME_VALUE")
    expect(test.azure.mock.calls.some((args) => args.includes("show"))).toBe(false)
  },
)

it.each([
  { field: "runtimeReferences", encoded: "{" },
  { field: "runtimeReferences", encoded: "[]" },
  { field: "initialReferences", encoded: '{"RUNTIME_VALUE":null}' },
])(
  "does not interpret a malformed $field map $encoded as no shared secrets",
  async ({ field, encoded }) => {
    const test = scenario()
    test.foreign[field] = [encoded]

    const pending = inspectSharedRemoval(test.context, test.resources)
    await expect(pending).rejects.toMatchObject({
      name: "RemovalInspectionError",
      message: expect.stringContaining(String(test.foreign.id)),
    })
    await expect(pending).rejects.toThrow(
      field === "initialReferences" ? /initialReferences|init.*reference/i
        : /runtimeReferences|runtime.*reference/i,
    )
    await expect(pending).rejects.not.toThrow("RUNTIME_VALUE")
  },
)

it.each([
  { target: "group", principalType: "User" },
  { target: "account", principalType: "Group" },
])(
  "blocks an untracked $principalType RBAC grant scoped to the application $target",
  async ({ target, principalType }) => {
    const test = scenario()
    const group = `/subscriptions/${test.context.config.azure.subscriptionId}/resourceGroups/${test.context.config.azure.resourceGroup}`
    const scope =
      target === "group"
        ? group
        : `${group}/providers/Microsoft.Storage/storageAccounts/samplehubhub`
    test.evidence.grants = [
      {
        scope,
        id: `${scope}/providers/Microsoft.Authorization/roleAssignments/00000000-0000-0000-0000-000000000099`,
        principalType,
      },
    ]

    await expect(inspectSharedRemoval(test.context, test.resources)).rejects.toThrow(
      /grants|shared|blocked/i,
    )
  },
)

it("keeps unknown RBAC metadata blocked without disclosing raw principal data", async () => {
  const test = scenario()
  test.evidence.grants = [{
    scope: null,
    id: null,
    principalId: "synthetic-private-principal",
    principalName: "synthetic-private-user@example.invalid",
  }]
  const pending = inspectSharedRemoval(test.context, test.resources)

  await expect(pending).rejects.toMatchObject({ name: "RemovalInspectionError" })
  await expect(pending).rejects.toThrow(/scope|id/i)
  await expect(pending).rejects.not.toThrow("synthetic-private-principal")
  await expect(pending).rejects.not.toThrow("synthetic-private-user@example.invalid")
})
