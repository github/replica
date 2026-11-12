import { createHash } from "node:crypto"

import type { CopilotCredentialProvider } from "../types.ts"

export function createEnvironmentCopilotCredentialProvider(
  environment: NodeJS.ProcessEnv,
): CopilotCredentialProvider {
  const credential = environment.REPLICA_COPILOT_TOKEN?.trim() || null
  return {
    key: "environment_token",
    configurationDigest: credential ? createHash("sha256").update(credential).digest("hex") : null,
    getCredential: () => Promise.resolve(credential),
  }
}
