import { createHash } from "node:crypto"
import type { DeploymentConfig } from "../../installer/types.ts"

export function installationNames(config: DeploymentConfig) {
  const suffix = createHash("sha256")
    .update(`${config.azure.subscriptionId.toLowerCase()}/${config.name}`)
    .digest("hex")
    .slice(0, 10)
  return {
    stateGroup: `${config.name}-state`,
    foundationGroup: `${config.name}-foundation`,
    stateAccount: `replicastate${suffix}`,
    registry: `replicahub${suffix}`,
    vault: `replica-${suffix}`,
  }
}
