import { readFile } from "node:fs/promises"

import type { DeploymentConfig } from "../types.ts"
import { configurationFields, parseAzureId } from "./fields/index.ts"
import { writePrivateJson } from "../write-private-json/index.ts"

export function parseConfig(value: unknown): DeploymentConfig {
  function record(input: unknown): Record<string, unknown> {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      throw new Error("Installation configuration must contain JSON objects.")
    }
    return input as Record<string, unknown>
  }
  function string(input: unknown, label: string, pattern: RegExp): string {
    if (
      typeof input !== "string" ||
      input.trim() !== input ||
      /[\u0000-\u001f\u007f]/.test(input) ||
      !pattern.test(input)
    ) {
      throw new Error(`Invalid ${label} in installation configuration.`)
    }
    return input
  }
  function keys(input: Record<string, unknown>, allowed: string[]): void {
    if (Object.keys(input).some((key) => !allowed.includes(key))) {
      throw new Error("Unknown configuration field. Store only documented settings, never secrets.")
    }
  }
  const config = record(value)
  keys(config, ["version", "cloud", "name", "owner", "npmRegistry", "azure"])
  if (config.version !== 1 || config.cloud !== "azure") {
    throw new Error("This installer supports configuration version 1 and cloud azure.")
  }
  const azure = record(config.azure)
  // Legacy v1 IP settings are accepted on read, but are no longer used or saved.
  keys(azure, ["subscriptionId", "tenantId", "location", "resourceGroup", "stateAllowedIp"])
  const name = configurationFields.name.parse(config.name)
  const npmRegistry =
    config.npmRegistry === undefined
      ? undefined
      : configurationFields.npmRegistry.parse(config.npmRegistry)
  return {
    version: 1,
    cloud: "azure",
    name,
    owner: configurationFields.owner.parse(config.owner),
    ...(npmRegistry ? { npmRegistry } : {}),
    azure: {
      subscriptionId: parseAzureId(azure.subscriptionId),
      tenantId: parseAzureId(azure.tenantId),
      location: string(azure.location, "Azure region", /^[a-z][a-z0-9]+$/),
      resourceGroup: configurationFields.resourceGroup.parse(azure.resourceGroup),
    },
  }
}

export async function loadConfig(path: string): Promise<DeploymentConfig> {
  return parseConfig(JSON.parse(await readFile(path, "utf8")))
}

export async function saveConfig(path: string, config: DeploymentConfig): Promise<void> {
  await writePrivateJson(path, parseConfig(config))
}
