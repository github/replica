import { createHash } from "node:crypto"

import { createEnvironmentCopilotCredentialProvider } from "../create-environment-copilot-credential-provider/index.ts"
import type { CopilotCredentialProvider } from "../types.ts"

const ambientDigest = createHash("sha256").update("ambient_cli:v1").digest("hex")

export function createCopilotCredentialProvider(
  environment: NodeJS.ProcessEnv,
): CopilotCredentialProvider {
  const mode = environment.REPLICA_COPILOT_AUTHENTICATION?.trim()
  const hasEnvironmentToken = Boolean(environment.REPLICA_COPILOT_TOKEN?.trim())
  if (!mode) {
    if (hasEnvironmentToken) {
      throw new Error(
        "REPLICA_COPILOT_AUTHENTICATION=environment-token is required when REPLICA_COPILOT_TOKEN is set.",
      )
    }
    return {
      key: "unconfigured",
      configurationDigest: null,
      getCredential: () => Promise.resolve(null),
    }
  }
  if (mode === "ambient-cli") {
    if (hasEnvironmentToken) {
      throw new Error(
        "REPLICA_COPILOT_TOKEN must be unset when REPLICA_COPILOT_AUTHENTICATION=ambient-cli.",
      )
    }
    return {
      key: "ambient_cli",
      configurationDigest: ambientDigest,
      getCredential: () => Promise.resolve({}),
    }
  }
  if (mode === "environment-token") {
    if (!hasEnvironmentToken) {
      throw new Error(
        "REPLICA_COPILOT_TOKEN is required when REPLICA_COPILOT_AUTHENTICATION=environment-token.",
      )
    }
    return createEnvironmentCopilotCredentialProvider(environment)
  }
  throw new Error(
    "REPLICA_COPILOT_AUTHENTICATION must be ambient-cli or environment-token.",
  )
}
