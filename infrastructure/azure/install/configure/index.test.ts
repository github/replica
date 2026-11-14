import { expect, it, vi } from "vitest"

import { CommandExecutionError } from "../../../installer/command/index.ts"
import type { DraftAnswers, WizardSession } from "../../../installer/session/index.ts"
import type { DeploymentConfig, RunCommand, WizardUI } from "../../../installer/types.ts"
import { guidedPostgresProfile, type PostgresAvailability } from "../profile.ts"
import { configureAzure } from "./index.ts"

function setup(subscriptionId = "00000000-0000-0000-0000-000000000001") {
  const accounts = [
    {
      id: "00000000-0000-0000-0000-000000000001",
      tenantId: "00000000-0000-0000-0000-000000000010",
      tenantDisplayName: "Development directory",
      name: "Development",
      state: "Enabled",
      isDefault: true,
    },
    {
      id: "00000000-0000-0000-0000-000000000002",
      tenantId: "00000000-0000-0000-0000-000000000020",
      tenantDisplayName: "Production directory",
      name: "Production",
      state: "Enabled",
    },
    {
      id: "00000000-0000-0000-0000-000000000003",
      tenantId: "00000000-0000-0000-0000-000000000020",
      tenantDisplayName: "Production directory",
      name: "Staging",
      state: "Enabled",
    },
    {
      id: "00000000-0000-0000-0000-000000000004",
      tenantId: "00000000-0000-0000-0000-000000000030",
      tenantDisplayName: "Disabled directory",
      name: "Disabled",
      state: "Disabled",
    },
  ]
  const answers = ["test-hub", "test-team"]
  const locations = [{ name: "eastus2", displayName: "East US 2" }]
  const providers = new Map([
    ["Microsoft.App", { resourceType: "managedEnvironments", locations: ["East US 2"] }],
    ["Microsoft.DBforPostgreSQL", { resourceType: "flexibleServers", locations: ["East US 2"] }],
    ["Microsoft.ContainerRegistry", { resourceType: "registries", locations: ["East US 2"] }],
    ["Microsoft.KeyVault", { resourceType: "vaults", locations: ["East US 2"] }],
  ])
  const ui: WizardUI = {
    cloud: vi.fn(),
    text: vi.fn(async () => {
      if (!answers.length) throw new Error("Unexpected extra input prompt")
      return answers.shift()!
    }),
    select: vi.fn(async (_message, options) => options[0]!.value),
    confirm: vi.fn(async () => false),
    status: vi.fn(),
    wait: vi.fn(async (message) => {
      throw new Error(message)
    }),
  }
  const run = vi.fn<RunCommand>(async (executable, args) => {
    if (executable === "terraform") return JSON.stringify({ terraform_version: "1.17.1" })
    if (executable === "docker" || args.includes("--help")) return ""
    if (args[0] === "version") return "{}"
    if (args[0] === "account" && args[1] === "list") return JSON.stringify(accounts)
    if (args.slice(0, 3).join(" ") === "postgres flexible-server list-skus")
      return JSON.stringify([{
        status: null, reason: null, restricted: null,
        supportedServerVersions: [{ name: "17", status: null, reason: null }],
        supportedServerEditions: [{
          name: "Burstable", status: null, reason: null,
          supportedServerSkus: [{ name: "Standard_B1ms", status: null, reason: null }],
        }],
      }])
    if (
      args[0] === "rest" &&
      args[args.indexOf("--method") + 1]?.toLowerCase() === "get" &&
      args[args.indexOf("--url") + 1]?.startsWith(`/subscriptions/${subscriptionId}/locations?`) &&
      args[args.indexOf("--subscription") + 1] === subscriptionId &&
      args[args.indexOf("--query") + 1] === "value" &&
      args[args.indexOf("--output") + 1] === "json"
    )
      return JSON.stringify(locations)
    if (
      args[0] === "provider" &&
      args[1] === "show" &&
      args[args.indexOf("--subscription") + 1] === subscriptionId
    ) {
      const provider = providers.get(args[args.indexOf("--namespace") + 1]!)
      if (provider) return JSON.stringify({ resourceTypes: [provider] })
    }
    throw new Error(`Unexpected operation ${executable} ${args.join(" ")}`)
  })
  return { accounts, locations, providers, answers, ui, run }
}

it("selects a tenant and scopes discovery to its chosen non-default subscription", async () => {
  const { accounts, ui, run } = setup("00000000-0000-0000-0000-000000000003")
  const tenant = accounts[1]!.tenantId
  const subscription = accounts[2]!.id
  ui.select = vi.fn(async (message, options) => {
    if (message === "Azure tenant") return tenant
    if (message === "Azure subscription") return subscription
    return options[0]!.value
  })

  const session = savedSession({})
  const config = await configureAzure(ui, run, undefined, session)

  const selections = vi.mocked(ui.select).mock.calls
  expect(selections[0]![0]).toBe("Azure tenant")
  expect(selections[0]![1].map(({ value }) => value)).toEqual([accounts[0]!.tenantId, tenant])
  expect(selections[0]![1][1]!.label).toContain("Production directory")
  expect(selections[1]![0]).toBe("Azure subscription")
  expect(selections[1]![1].map(({ value }) => value)).toEqual([accounts[1]!.id, subscription])
  expect(config.azure).toMatchObject({
    tenantId: tenant,
    subscriptionId: subscription,
    resourceGroup: "test-hub-hub",
  })
  expect(ui.text).toHaveBeenCalledTimes(2)
  expect(session.answer).toHaveBeenCalledWith("resourceGroup", "test-hub-hub")
  const discovery = run.mock.calls.filter(
    ([, args]) => args[0] === "rest" || args[0] === "provider",
  )
  expect(discovery).toHaveLength(5)
  for (const [, args] of discovery)
    expect(args[args.indexOf("--subscription") + 1]).toBe(subscription)
  const locations = discovery.find(([, args]) => args[0] === "rest")![1]
  expect(
    new URL(locations[locations.indexOf("--url") + 1]!, "https://management.azure.com").pathname,
  ).toBe(`/subscriptions/${subscription}/locations`)
  expect(run.mock.calls.some(([, args]) => args[0] === "account" && args[1] === "set")).toBe(false)
})

it("corrects only the invalid field immediately while retaining the selected Azure target and prior answers", async () => {
  const { accounts, answers, ui, run } = setup()
  answers.splice(
    0,
    answers.length,
    "Bad name",
    "test-hub",
    "",
    "test-team",
  )
  const helpCounts: number[] = []
  const text = ui.text
  ui.text = vi.fn(async (message, initial) => {
    helpCounts.push(vi.mocked(ui.status).mock.calls.length)
    return text(message, initial)
  })

  const config = await configureAzure(ui, run)

  expect(config).toEqual({
    version: 1,
    cloud: "azure",
    name: "test-hub",
    owner: "test-team",
    azure: {
      tenantId: accounts[0]!.tenantId,
      subscriptionId: accounts[0]!.id,
      location: "eastus2",
      resourceGroup: "test-hub-hub",
    },
  })
  const prompts = vi.mocked(ui.text).mock.calls
  expect(prompts).toHaveLength(4)
  for (const [invalid, retry] of [
    [0, 1],
    [2, 3],
  ] as const) {
    expect(prompts[retry]![0]).toBe(prompts[invalid]![0])
    expect(helpCounts[retry]).toBeGreaterThan(helpCounts[invalid]!)
  }
  expect(new Set(prompts.map(([message]) => message)).size).toBe(2)
  expect(prompts[1]![1]).toBe("Bad name")
  expect(ui.select).toHaveBeenCalledTimes(3)
  expect(
    run.mock.calls.filter(([, args]) => args[0] === "account" && args[1] === "list"),
  ).toHaveLength(1)
  expect(
    run.mock.calls.filter(([, args]) => args[0] === "rest" || args[0] === "provider"),
  ).toHaveLength(5)
})

it("corrects a credential-bearing npm registry without exposing or prefilling the rejected value", async () => {
  const { answers, ui, run } = setup()
  const rejected = "https://synthetic-user:synthetic-password@packages.example/npm/"
  answers.push(rejected, "https://packages.example/npm/")
  ui.confirm = vi.fn(async () => true)

  const config = await configureAzure(ui, run)

  expect(config.npmRegistry).toBe("https://packages.example/npm/")
  const prompts = vi.mocked(ui.text).mock.calls
  expect(prompts).toHaveLength(4)
  expect(prompts[3]![0]).toBe(prompts[2]![0])
  expect(prompts[3]![1] ?? "").toBe("")
  expect(ui.confirm).toHaveBeenCalledOnce()
  expect(ui.select).toHaveBeenCalledTimes(3)
  const visible = JSON.stringify({
    prompts,
    statuses: vi.mocked(ui.status).mock.calls,
    waits: vi.mocked(ui.wait).mock.calls,
    config,
  })
  expect(visible).not.toContain("synthetic-user")
  expect(visible).not.toContain("synthetic-password")
  expect(run.mock.calls.some(([, args]) => args.includes(rejected))).toBe(false)
})

it.each(["rest", "provider", "postgres"] as const)(
  "retries a failed read-only %s lookup without asking for the selected tenant or subscription again",
  async (operation) => {
    const subscriptionId = "00000000-0000-0000-0000-000000000003"
    const { accounts, ui, run } = setup(subscriptionId)
    ui.select = vi.fn(async (message, options) => {
      if (message === "Azure tenant") return accounts[2]!.tenantId
      if (message === "Azure subscription") return subscriptionId
      return options[0]!.value
    })
    ui.wait = vi.fn(async () => undefined)
    let failed = false
    const flakyRun = vi.fn<RunCommand>(async (executable, args, options) => {
      if (args[0] === operation && !failed) {
        failed = true
        throw new CommandExecutionError("Synthetic read-only discovery failure")
      }
      return run(executable, args, options)
    })

    const config = await configureAzure(ui, flakyRun)

    expect(config.azure.subscriptionId).toBe(subscriptionId)
    expect(ui.wait).toHaveBeenCalledOnce()
    expect(ui.select).toHaveBeenCalledTimes(3)
    const queries = flakyRun.mock.calls.filter(
      ([, args]) => ["rest", "provider", "postgres"].includes(args[0]!),
    )
    for (const [, args] of queries)
      expect(args[args.indexOf("--subscription") + 1]).toBe(subscriptionId)
    expect(queries.filter(([, args]) => args[0] === operation).length).toBeGreaterThan(
      operation === "provider" ? 4 : 1,
    )
    expect(flakyRun.mock.calls.some(([, args]) => args[0] === "account" && args[1] === "set")).toBe(
      false,
    )
  },
)

it.each([
  new Error("Cancelled"),
  new DOMException("Aborted", "AbortError"),
  new TypeError("Unexpected UI failure"),
])(
  "propagates input cancellation or unexpected failure instead of retrying: %s",
  async (failure) => {
    const { ui, run } = setup()
    ui.text = vi.fn(async () => {
      throw failure
    })

    await expect(configureAzure(ui, run)).rejects.toBe(failure)

    expect(ui.text).toHaveBeenCalledOnce()
    expect(ui.wait).not.toHaveBeenCalled()
    expect(ui.confirm).not.toHaveBeenCalled()
  },
)

it.each([
  new CommandExecutionError("Cancelled", true),
  new DOMException("Aborted", "AbortError"),
  new Error("Unexpected query failure"),
])("does not retry aborted or unexpected discovery failures: %s", async (failure) => {
  const { ui, run } = setup()
  const failedRun = vi.fn<RunCommand>(async (executable, args, options) => {
    if (args[0] === "rest") throw failure
    return run(executable, args, options)
  })

  await expect(configureAzure(ui, failedRun)).rejects.toBe(failure)

  expect(failedRun.mock.calls.filter(([, args]) => args[0] === "rest")).toHaveLength(1)
  expect(ui.wait).not.toHaveBeenCalled()
  expect(ui.text).not.toHaveBeenCalled()
})

it("propagates cancellation while waiting to retry discovery without repeating the failed query", async () => {
  const { ui, run } = setup()
  const cancelled = new Error("Cancelled while waiting")
  ui.wait = vi.fn(async () => {
    throw cancelled
  })
  const failedRun = vi.fn<RunCommand>(async (executable, args, options) => {
    if (args[0] === "rest") throw new CommandExecutionError("Synthetic lookup failure")
    return run(executable, args, options)
  })

  await expect(configureAzure(ui, failedRun)).rejects.toBe(cancelled)

  expect(ui.wait).toHaveBeenCalledOnce()
  expect(failedRun.mock.calls.filter(([, args]) => args[0] === "rest")).toHaveLength(1)
  expect(ui.text).not.toHaveBeenCalled()
})

it("does not turn malformed discovery data into a retry loop", async () => {
  const { ui, run } = setup()
  const malformedRun = vi.fn<RunCommand>(async (executable, args, options) => {
    if (args[0] === "rest") return '{"broken":'
    return run(executable, args, options)
  })

  await expect(configureAzure(ui, malformedRun)).rejects.toBeInstanceOf(SyntaxError)

  expect(ui.wait).not.toHaveBeenCalled()
  expect(malformedRun.mock.calls.filter(([, args]) => args[0] === "rest")).toHaveLength(1)
})

it("offers only regions matching the guided PostgreSQL profile and all four provider filters", async () => {
  const { locations, providers, ui, run } = setup()
  const unavailable = [
    { name: "westus2", displayName: "West US 2", provider: "Microsoft.App" },
    { name: "centralus", displayName: "Central US", provider: "Microsoft.DBforPostgreSQL" },
    { name: "northeurope", displayName: "North Europe", provider: "Microsoft.ContainerRegistry" },
    { name: "westeurope", displayName: "West Europe", provider: "Microsoft.KeyVault" },
  ]
  locations.push(...unavailable)
  for (const [namespace, provider] of providers)
    provider.locations.push(
      ...unavailable
        .filter((region) => region.provider !== namespace)
        .map(({ displayName }) => displayName),
    )
  locations.push({ name: "southcentralus", displayName: "South Central US" })
  for (const provider of providers.values()) provider.locations.push("South Central US")
  const availability = vi.fn<PostgresAvailability>(async (_subscription, location) =>
    location === "eastus2",
  )

  const config = await configureAzure(ui, run, undefined, undefined, availability)

  const regions = vi
    .mocked(ui.select)
    .mock.calls.find(([message]) => message === "Azure region")![1]
  expect(regions.map(({ value }) => value)).toEqual(["eastus2"])
  expect(config.azure.location).toBe("eastus2")
  expect(availability.mock.calls).toEqual([
    ["00000000-0000-0000-0000-000000000001", "eastus2", guidedPostgresProfile],
    ["00000000-0000-0000-0000-000000000001", "southcentralus", guidedPostgresProfile],
  ])
})

it("rechecks the fixed saved target without offering editable target or identity prompts", async () => {
  const { accounts, ui, run } = setup("00000000-0000-0000-0000-000000000003")
  const existing: DeploymentConfig = {
    version: 1,
    cloud: "azure",
    name: "test-hub",
    owner: "test-team",
    azure: {
      tenantId: accounts[2]!.tenantId,
      subscriptionId: accounts[2]!.id,
      resourceGroup: "test-hub-rg",
      location: "eastus2",
    },
  }

  const availability = vi.fn<PostgresAvailability>(async () => false)
  const config = await configureAzure(ui, run, existing, undefined, availability)

  expect(ui.select).not.toHaveBeenCalled()
  expect(ui.text).not.toHaveBeenCalled()
  expect(run.mock.calls.filter(([, args]) => args[0] === "account" && args[1] === "list")).toHaveLength(1)
  const discovery = run.mock.calls.filter(([, args]) => args[0] === "rest" || args[0] === "provider")
  expect(discovery).toHaveLength(5)
  for (const [, args] of discovery)
    expect(args[args.indexOf("--subscription") + 1]).toBe(existing.azure.subscriptionId)
  expect(config).toEqual(existing)
  expect(availability).not.toHaveBeenCalled()
})

it("stops before offering a region when no candidate advertises the guided profile", async () => {
  const { ui, run } = setup()
  const availability = vi.fn<PostgresAvailability>(async () => false)

  await expect(configureAzure(ui, run, undefined, undefined, availability))
    .rejects.toThrow(/no region/i)

  expect(vi.mocked(ui.select).mock.calls.map(([message]) => message))
    .toEqual(["Azure tenant", "Azure subscription"])
  expect(ui.text).not.toHaveBeenCalled()
  expect(ui.wait).not.toHaveBeenCalled()
})

it.each([
  new CommandExecutionError("Synthetic cancellation", true),
  new DOMException("Synthetic abort", "AbortError"),
  new Error("Synthetic unknown catalogue schema"),
])("propagates unknown or cancelled SKU checks without treating them as unsupported: %s", async (failure) => {
  const { ui, run } = setup()
  const availability = vi.fn<PostgresAvailability>(async () => { throw failure })

  await expect(configureAzure(ui, run, undefined, undefined, availability)).rejects.toBe(failure)

  expect(availability).toHaveBeenCalledOnce()
  expect(ui.wait).not.toHaveBeenCalled()
  expect(ui.text).not.toHaveBeenCalled()
  expect(vi.mocked(ui.select).mock.calls.some(([message]) => message === "Azure region")).toBe(false)
})

it("settles every regional check before asking once to retry a read-only failure", async () => {
  const { locations, providers, ui, run } = setup()
  locations.push({ name: "westus2", displayName: "West US 2" })
  for (const provider of providers.values()) provider.locations.push("West US 2")
  const slow = Promise.withResolvers<boolean>()
  const started = Promise.withResolvers<void>()
  let attempts = 0
  const availability = vi.fn<PostgresAvailability>(async (_subscription, location) => {
    if (location === "eastus2" && attempts++ === 0)
      throw new CommandExecutionError("Synthetic catalogue query failed")
    if (location === "westus2" && attempts === 1) {
      started.resolve()
      return slow.promise
    }
    return true
  })
  ui.wait = vi.fn(async () => undefined)
  const configuring = configureAzure(ui, run, undefined, undefined, availability)
  await started.promise
  expect(ui.wait).not.toHaveBeenCalled()
  slow.resolve(true)

  await expect(configuring).resolves.toMatchObject({ azure: { location: "eastus2" } })
  expect(ui.wait).toHaveBeenCalledOnce()
  expect(availability).toHaveBeenCalledTimes(4)
  expect(vi.mocked(ui.select).mock.calls.map(([message]) => message))
    .toEqual(["Azure tenant", "Azure subscription", "Azure region"])
})

it.each([
  new DOMException("Synthetic regional check aborted", "AbortError"),
  new Error("Synthetic unknown catalogue schema"),
])("propagates a non-retryable region failure before an earlier retryable command failure: %s", async (failure) => {
  const { locations, providers, ui, run } = setup()
  locations.push({ name: "westus2", displayName: "West US 2" })
  for (const provider of providers.values()) provider.locations.push("West US 2")
  const availability = vi.fn<PostgresAvailability>(async (_subscription, location) => {
    if (location === "eastus2") throw new CommandExecutionError("Synthetic read-only failure")
    throw failure
  })

  await expect(configureAzure(ui, run, undefined, undefined, availability)).rejects.toBe(failure)

  expect(ui.wait).not.toHaveBeenCalled()
  expect(ui.text).not.toHaveBeenCalled()
})

it("propagates cancellation from the SKU retry prompt without issuing another lookup", async () => {
  const { ui, run } = setup()
  const cancelled = new Error("Synthetic retry cancelled")
  const availability = vi.fn<PostgresAvailability>(async () => {
    throw new CommandExecutionError("Synthetic catalogue query failed")
  })
  ui.wait = vi.fn(async () => { throw cancelled })

  await expect(configureAzure(ui, run, undefined, undefined, availability)).rejects.toBe(cancelled)

  expect(ui.wait).toHaveBeenCalledOnce()
  expect(availability).toHaveBeenCalledOnce()
  expect(ui.text).not.toHaveBeenCalled()
})

function savedConfig(): DeploymentConfig {
  return {
    version: 1, cloud: "azure", name: "test-hub", owner: "test-team",
    azure: {
      tenantId: "00000000-0000-0000-0000-000000000010",
      subscriptionId: "00000000-0000-0000-0000-000000000001",
      location: "eastus2", resourceGroup: "test-hub-rg",
    },
  }
}

function savedSession(answers: DraftAnswers): WizardSession {
  return {
    path: "/synthetic/installation.json.draft.json",
    problem: undefined,
    draft: {
      version: 1,
      id: "00000000-0000-0000-0000-000000000099",
      configPath: "/synthetic/installation.json",
      createdAt: "2026-11-01T10:00:00Z",
      updatedAt: "2026-11-02T10:00:00Z",
      phase: "configure",
      deploymentStarted: false,
      answers,
    },
    answer: vi.fn(), clear: vi.fn(), phase: vi.fn(),
    restart: vi.fn(), complete: vi.fn(), close: vi.fn(),
  }
}

it("preserves a previously accepted custom resource group when resuming without asking for it", async () => {
  const { ui, run } = setup()
  const session = savedSession({
    name: "test-hub",
    owner: "test-team",
    resourceGroup: "previously-chosen-group",
    useProxy: false,
  })

  const config = await configureAzure(ui, run, undefined, session)

  expect(config.azure.resourceGroup).toBe("previously-chosen-group")
  expect(ui.text).not.toHaveBeenCalled()
  expect(ui.confirm).not.toHaveBeenCalled()
  expect(session.draft?.answers.resourceGroup).toBe("previously-chosen-group")
})

it("refuses lost access to a saved subscription without offering another target or rewriting answers", async () => {
  const { accounts, ui, run } = setup()
  const existing = savedConfig()
  accounts.shift()
  const session = savedSession({ name: existing.name })

  await expect(configureAzure(ui, run, existing, session)).rejects.toThrow(/saved.*subscription|restore access/i)

  expect(ui.select).not.toHaveBeenCalled()
  expect(ui.text).not.toHaveBeenCalled()
  expect(ui.confirm).not.toHaveBeenCalled()
  expect(session.answer).not.toHaveBeenCalled()
  expect(session.clear).not.toHaveBeenCalled()
  expect(run.mock.calls.some(([, args]) => args[0] === "rest" || args[0] === "provider")).toBe(false)
})

it.each(["Microsoft.App", "Microsoft.DBforPostgreSQL", "Microsoft.ContainerRegistry", "Microsoft.KeyVault"])(
  "refuses the existing region missing from %s before editable prompts or draft-answer writes",
  async (namespace) => {
    const { locations, providers, ui, run } = setup()
    const existing = savedConfig()
    locations.push({ name: "westus2", displayName: "West US 2" })
    for (const [name, provider] of providers)
      provider.locations.splice(0, provider.locations.length, ...(name === namespace ? [] : ["East US 2"]), "West US 2")
    const session = savedSession({
      tenantId: existing.azure.tenantId, subscriptionId: existing.azure.subscriptionId,
      location: existing.azure.location, name: existing.name,
    })

    await expect(configureAzure(ui, run, existing, session)).rejects.toThrow(/saved.*region|not available/i)

    expect(run.mock.calls.filter(([, args]) => args[0] === "provider")).toHaveLength(4)
    expect(ui.select).not.toHaveBeenCalled()
    expect(ui.text).not.toHaveBeenCalled()
    expect(ui.confirm).not.toHaveBeenCalled()
    expect(session.answer).not.toHaveBeenCalled()
    expect(session.clear).not.toHaveBeenCalled()
  },
)

it.each([
  ["name", "other-hub"],
  ["owner", "other-team"],
  ["tenantId", "00000000-0000-0000-0000-000000000020"],
  ["subscriptionId", "00000000-0000-0000-0000-000000000002"],
  ["location", "westus2"],
  ["resourceGroup", "other-hub-rg"],
] as const)(
  "refuses a conflicting saved draft %s before any cloud command or checkpoint",
  async (field, value) => {
    const { ui, run } = setup()
    const session = savedSession({ [field]: value })

    await expect(configureAzure(ui, run, savedConfig(), session)).rejects.toThrow(/draft|conflict|match/i)

    expect(run).not.toHaveBeenCalled()
    expect(ui.select).not.toHaveBeenCalled()
    expect(ui.text).not.toHaveBeenCalled()
    expect(session.answer).not.toHaveBeenCalled()
    expect(session.phase).not.toHaveBeenCalled()
    expect(session.clear).not.toHaveBeenCalled()
  },
)

it("rejects a subscription from another tenant before querying its services", async () => {
  const { accounts, ui, run } = setup()
  ui.select = vi.fn(async (message, options) => {
    if (message === "Azure tenant") return accounts[0]!.tenantId
    if (message === "Azure subscription") return accounts[1]!.id
    return options[0]!.value
  })

  await expect(configureAzure(ui, run)).rejects.toThrow("authorized subscription")
  expect(run.mock.calls.some(([, args]) => args[0] === "rest" || args[0] === "provider")).toBe(
    false,
  )
})

it("rejects an unavailable tenant before asking for a subscription", async () => {
  const { ui, run } = setup()
  ui.select = vi.fn(async () => "unavailable-tenant")

  await expect(configureAzure(ui, run)).rejects.toThrow("authorized tenant")
  expect(ui.select).toHaveBeenCalledOnce()
  expect(run.mock.calls.some(([, args]) => args[0] === "rest" || args[0] === "provider")).toBe(
    false,
  )
})

it("normalizes mixed-case account identifiers before selection and scoped Azure discovery", async () => {
  const subscriptionId = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff"
  const tenantId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
  const { accounts, ui, run } = setup(subscriptionId)
  accounts.splice(1)
  accounts[0]!.id = subscriptionId.toUpperCase()
  accounts[0]!.tenantId = tenantId.toUpperCase()

  const config = await configureAzure(ui, run)

  expect(config.azure).toMatchObject({ subscriptionId, tenantId })
  const selections = vi.mocked(ui.select).mock.calls
  expect(selections[0]![1].map(({ value }) => value)).toEqual([tenantId])
  expect(selections[1]![1].map(({ value }) => value)).toEqual([subscriptionId])
  const discovery = run.mock.calls.filter(
    ([, args]) => args[0] === "rest" || args[0] === "provider",
  )
  expect(discovery).toHaveLength(5)
  for (const [, args] of discovery)
    expect(args[args.indexOf("--subscription") + 1]).toBe(subscriptionId)
})

it.each(["id", "tenantId"] as const)(
  "rejects malformed discovered %s before offering it as a deployment target",
  async (field) => {
    const { accounts, ui, run } = setup()
    accounts[0]![field] = `${accounts[0]![field]}\n`

    await expect(configureAzure(ui, run)).rejects.toThrow()

    expect(ui.select).not.toHaveBeenCalled()
    expect(run.mock.calls.some(([, args]) => args[0] === "rest" || args[0] === "provider")).toBe(
      false,
    )
  },
)
