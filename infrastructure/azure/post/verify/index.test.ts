import { expect, it, vi } from "vitest"

import type { RunCommand } from "../../../installer/types.ts"
import type { AzureInstallation } from "../../install/types.ts"
import type { PostDeployment } from "../types.ts"
import { verifyPostSetup } from "./index.ts"

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
  const deployment: PostDeployment = {
    appId: `/subscriptions/${config.azure.subscriptionId}/resourceGroups/${config.azure.resourceGroup}/providers/Microsoft.App/containerApps/sample-hub-hub`,
    appName: "sample-hub-hub",
    environmentId: "synthetic-environment-id",
    image: `registry.azurecr.io/hub@sha256:${"a".repeat(64)}`,
    revision: "sample-hub-hub--current",
    active: true,
    origin: "https://sample-hub.eastus2.azurecontainerapps.io",
    customHosts: [],
    principalId: "00000000-0000-0000-0000-000000000003",
    environment: {},
  }
  const run = vi.fn<RunCommand>(async (executable, args) => {
    expect(executable).toBe("az")
    if (args.slice(0, 2).join(" ") === "containerapp show")
      return JSON.stringify({
        id: deployment.appId,
        latest: deployment.revision,
        ready: deployment.revision,
        traffic: [{ weight: 100, revisionName: deployment.revision }],
      })
    if (args.slice(0, 3).join(" ") === "containerapp revision show")
      return JSON.stringify({
        name: deployment.revision,
        active: true,
        health: "Healthy",
        image: deployment.image,
      })
    throw new Error("Verification must not mutate the deployment")
  })
  const context: AzureInstallation = {
    config,
    directory: "unused-post-verify-fixture",
    env: {},
    run,
    ui: { status: vi.fn(), confirm: vi.fn(), wait: vi.fn() },
    azure: (...args) => run("az", args),
  }
  return { context, deployment, run }
}

it("accepts protected administrator setup access without requiring sign-in providers in shared-only mode", async () => {
  const test = scenario()
  const request = vi.fn<typeof fetch>(async (input, options) => {
    expect(options?.redirect).toBe("error")
    if (String(input).endsWith("/api/ready")) return new Response(null, { status: 200 })
    if (String(input).endsWith("/api/settings/github/status"))
      return Response.json({ requires: "administrator" }, { status: 403 })
    throw new Error("Shared-only setup must not require /api/auth/providers")
  })

  await expect(
    verifyPostSetup(test.context, test.deployment, {
      origin: test.deployment.origin,
      setup: true,
      github: false,
      restart: false,
      request,
    }),
  ).resolves.toBeUndefined()

  expect(request).toHaveBeenCalledTimes(2)
})

it("requires the GitHub provider after GitHub configuration rather than accepting setup access alone", async () => {
  const test = scenario()
  const request = vi.fn<typeof fetch>(async (input) => {
    if (String(input).endsWith("/api/ready")) return new Response(null, { status: 200 })
    if (String(input).endsWith("/api/settings/github/status"))
      return Response.json({ requires: "administrator" }, { status: 403 })
    return Response.json({ providers: [] })
  })

  await expect(
    verifyPostSetup(test.context, test.deployment, {
      origin: test.deployment.origin,
      setup: true,
      github: true,
      restart: false,
      request,
    }),
  ).rejects.toThrow(/GitHub sign-in/i)
})
