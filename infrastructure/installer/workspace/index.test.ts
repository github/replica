import { dirname, isAbsolute, resolve } from "node:path"
import { expect, it } from "vitest"

import type { DeploymentConfig } from "../types.ts"
import { installationWorkspace } from "./index.ts"

function configuration(): DeploymentConfig {
  return {
    version: 1,
    cloud: "azure",
    name: "test-hub",
    owner: "platform-team",
    azure: {
      subscriptionId: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
      tenantId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      location: "eastus2",
      resourceGroup: "test-hub-rg",
    },
  }
}

it("derives one absolute workspace from the normalized Azure target and configuration parent", () => {
  const config = configuration()
  const parent = resolve(".installer-workspace-test")
  const workspace = installationWorkspace(config, parent)
  const mixed = {
    ...config,
    azure: {
      ...config.azure,
      subscriptionId: config.azure.subscriptionId.toUpperCase(),
      tenantId: config.azure.tenantId.toUpperCase(),
      resourceGroup: config.azure.resourceGroup.toUpperCase(),
    },
  }

  expect(isAbsolute(workspace)).toBe(true)
  expect(dirname(workspace)).toBe(parent)
  expect(workspace).not.toBe(resolve(parent, config.name))
  expect(installationWorkspace(mixed, ".installer-workspace-test")).toBe(workspace)
  expect(
    installationWorkspace(
      { ...config, owner: "different-team", npmRegistry: "https://packages.example/npm/" },
      parent,
    ),
  ).toBe(workspace)
})

it.each([
  { name: "another-hub" },
  { subscriptionId: "cccccccc-dddd-4eee-8fff-aaaaaaaaaaaa" },
  { tenantId: "cccccccc-dddd-4eee-8fff-aaaaaaaaaaaa" },
  { location: "westus2" },
  { resourceGroup: "another-hub-rg" },
])("isolates the workspace when target component %j changes", (change) => {
  const config = configuration()
  const other = {
    ...config,
    ...(change.name ? { name: change.name } : {}),
    azure: { ...config.azure, ...("name" in change ? {} : change) },
  }

  expect(installationWorkspace(other, ".installer-workspace-test")).not.toBe(
    installationWorkspace(config, ".installer-workspace-test"),
  )
})

it("rejects malformed Azure UUIDs instead of deriving another workspace", () => {
  const config = configuration()
  config.azure.tenantId += "\n"

  expect(() => installationWorkspace(config, ".installer-workspace-test")).toThrow()
})
