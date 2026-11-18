import { expect, it, vi } from "vitest"

import type { RunCommand } from "../../../installer/types.ts"
import type { AzureInstallation } from "../../install/types.ts"
import { readPostDeployment } from "./index.ts"

function scenario() {
  const config: AzureInstallation["config"] = {
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
  const appId = `${group}/providers/Microsoft.App/containerApps/sample-hub-hub`
  const environmentId = `${group}/providers/Microsoft.App/managedEnvironments/sample-hub-environment`
  const identityId = `${group}/providers/Microsoft.ManagedIdentity/userAssignedIdentities/sample-hub-hub`
  const principalId = "00000000-0000-0000-0000-000000000003"
  const image = `registry.azurecr.io/hub@sha256:${"a".repeat(64)}`
  const revision = "sample-hub-hub--current"
  const tags = {
    application: "replica-hub",
    installation: config.name,
    owner: config.owner,
    managed_by: "terraform",
  }
  const app = {
    id: appId,
    name: "sample-hub-hub",
    fqdn: "sample-hub.eastus2.azurecontainerapps.io",
    environmentId,
    revisionMode: "Multiple",
    traffic: [{ weight: 100, latestRevision: true, revisionName: undefined as string | undefined }],
    customDomains: ["hub.example.com"],
  }
  const revisions = [
    { name: revision, active: true, image, env: [{ name: "PUBLIC_SETTING", value: "retained" }] },
    {
      name: "sample-hub-hub--old",
      active: false,
      image: `registry.azurecr.io/hub@sha256:${"b".repeat(64)}`,
      env: [],
    },
  ]
  const state = {
    latest: revision,
    jobs: ["sample-hub-setup", "unrelated-job"],
    statuses: ["Succeeded"],
  }
  const run = vi.fn<RunCommand>(async (executable, args) => {
    expect(executable).toBe("az")
    const operation = args.slice(0, 3).join(" ")
    if (operation.startsWith("group exists")) return "true"
    if (operation.startsWith("group show")) return JSON.stringify({ tags })
    if (operation.startsWith("containerapp show"))
      return JSON.stringify(
        args[args.indexOf("--query") + 1] === "properties.latestRevisionName" ? state.latest : app,
      )
    if (operation === "containerapp revision list") return JSON.stringify(revisions)
    if (operation.startsWith("identity show"))
      return JSON.stringify({ id: identityId, principalId })
    if (operation === "containerapp job list") return JSON.stringify(state.jobs)
    if (operation === "containerapp job execution") return JSON.stringify(state.statuses)
    throw new Error(`Unexpected Azure command: ${args.slice(0, 4).join(" ")}`)
  })
  const context: AzureInstallation = {
    config,
    directory: "unused-post-deployment-fixture",
    env: {},
    run,
    ui: { status: vi.fn(), confirm: vi.fn(), wait: vi.fn() },
    azure: (...args) =>
      run("az", [...args, "--subscription", config.azure.subscriptionId, "--output", "json"]),
  }
  return { context, run, app, revisions, state, tags, appId, image, revision, principalId }
}

it("uses the only traffic-serving revision and immutable image without inspecting other jobs or resource groups", async () => {
  const test = scenario()

  await expect(readPostDeployment(test.context)).resolves.toMatchObject({
    appId: test.appId,
    revision: test.revision,
    image: test.image,
    principalId: test.principalId,
    origin: `https://${test.app.fqdn}`,
    customHosts: ["hub.example.com"],
    environment: { PUBLIC_SETTING: "retained" },
  })

  for (const [, args] of test.run.mock.calls) {
    expect(args).toContain(test.context.config.azure.subscriptionId)
    expect(args.slice(0, 2)).not.toEqual(["resource", "list"])
    expect(args.slice(0, 2)).not.toEqual(["group", "list"])
    expect(args).not.toContain("unrelated-job")
    if (args.includes("--resource-group"))
      expect(args[args.indexOf("--resource-group") + 1]).toBe(
        test.context.config.azure.resourceGroup,
      )
  }
})

it.each([
  {
    reason: "a different app identity",
    change: (test: ReturnType<typeof scenario>) => {
      test.app.id = test.app.id.replace("sample-hub-hub", "another-hub")
    },
  },
  {
    reason: "resource-group ownership drift",
    change: (test: ReturnType<typeof scenario>) => {
      test.tags.owner = "another-team"
    },
  },
  {
    reason: "a stopped Hub selected for restart",
    change: (test: ReturnType<typeof scenario>) => {
      test.revisions[0]!.active = false
    },
  },
  {
    reason: "multiple active revisions",
    change: (test: ReturnType<typeof scenario>) => {
      test.revisions[1]!.active = true
    },
  },
  {
    reason: "traffic assigned to an inactive revision",
    change: (test: ReturnType<typeof scenario>) => {
      test.app.traffic[0]!.latestRevision = false
      test.app.traffic[0]!.revisionName = test.revisions[1]!.name
    },
  },
  {
    reason: "latest-revision traffic that disagrees with the active revision",
    change: (test: ReturnType<typeof scenario>) => {
      test.state.latest = test.revisions[1]!.name
    },
  },
  {
    reason: "a mutable image tag",
    change: (test: ReturnType<typeof scenario>) => {
      test.revisions[0]!.image = "registry.azurecr.io/hub:latest"
    },
  },
])("refuses $reason without making cloud changes", async ({ change }) => {
  const test = scenario()
  change(test)

  await expect(readPostDeployment(test.context)).rejects.toBeInstanceOf(Error)

  expect(
    test.run.mock.calls.some(([, args]) =>
      args.some((arg) =>
        ["restart", "activate", "deactivate", "start", "stop", "update", "set", "delete"].includes(
          arg,
        ),
      ),
    ),
  ).toBe(false)
})
