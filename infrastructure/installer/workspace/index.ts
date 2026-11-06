import { createHash } from "node:crypto"
import { join, resolve } from "node:path"

import { parseConfig } from "../config/index.ts"
import type { DeploymentConfig } from "../types.ts"

export function installationWorkspace(input: DeploymentConfig, parent: string): string {
  const config = parseConfig(input)
  const target = [
    config.cloud,
    config.azure.tenantId,
    config.azure.subscriptionId,
    config.name,
    config.azure.location,
    config.azure.resourceGroup.toLowerCase(),
  ]
  const identity = createHash("sha256").update(JSON.stringify(target)).digest("hex")
  return join(resolve(parent), `${config.name}-${identity}`)
}
