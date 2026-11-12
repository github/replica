import { createHash } from "node:crypto"

import { createEnvironmentCopilotCredentialProvider } from "../create-environment-copilot-credential-provider/index.ts"
import { createGitHubAppInstallationCopilotCredentialProvider } from "../create-github-app-installation-copilot-credential-provider/index.ts"
import type { CopilotCredentialProvider } from "../types.ts"

const ambientDigest = createHash("sha256").update("ambient_cli:v1").digest("hex")

export function createCopilotCredentialProvider(
  environment: NodeJS.ProcessEnv,
): CopilotCredentialProvider {
  const mode = environment.REPLICA_COPILOT_AUTHENTICATION?.trim()
  const hasEnvironmentToken = Boolean(environment.REPLICA_COPILOT_TOKEN?.trim())
  const githubAppKeys = [
    "GITHUB_APP_ID",
    "GITHUB_APP_PRIVATE_KEY",
    "REPLICA_COPILOT_GITHUB_INSTALLATION_ID",
    "REPLICA_COPILOT_GITHUB_ORGANIZATION",
  ] as const
  const hasGitHubAppConfiguration = githubAppKeys.some((key) => Boolean(environment[key]?.trim()))
  if (!mode) {
    if (hasEnvironmentToken) {
      throw new Error(
        "REPLICA_COPILOT_AUTHENTICATION=environment-token is required when REPLICA_COPILOT_TOKEN is set.",
      )
    }
    if (hasGitHubAppConfiguration) {
      throw new Error(
        "REPLICA_COPILOT_AUTHENTICATION=github-app-installation is required when Copilot GitHub App configuration is set.",
      )
    }
    return {
      key: "unconfigured",
      configurationDigest: null,
      githubAppInstallation: null,
      getCredential: () => Promise.resolve(null),
    }
  }
  if (mode === "ambient-cli") {
    if (hasEnvironmentToken || hasGitHubAppConfiguration) {
      throw new Error(
        "Copilot token and GitHub App configuration must be unset when REPLICA_COPILOT_AUTHENTICATION=ambient-cli.",
      )
    }
    return {
      key: "ambient_cli",
      configurationDigest: ambientDigest,
      githubAppInstallation: null,
      getCredential: () => Promise.resolve({}),
    }
  }
  if (mode === "environment-token") {
    if (hasGitHubAppConfiguration) {
      throw new Error(
        "Copilot GitHub App configuration must be unset when REPLICA_COPILOT_AUTHENTICATION=environment-token.",
      )
    }
    if (!hasEnvironmentToken) {
      throw new Error(
        "REPLICA_COPILOT_TOKEN is required when REPLICA_COPILOT_AUTHENTICATION=environment-token.",
      )
    }
    return createEnvironmentCopilotCredentialProvider(environment)
  }
  if (mode === "github-app-installation") {
    if (hasEnvironmentToken) {
      throw new Error(
        "REPLICA_COPILOT_TOKEN must be unset when REPLICA_COPILOT_AUTHENTICATION=github-app-installation.",
      )
    }
    return createGitHubAppInstallationCopilotCredentialProvider(environment)
  }
  throw new Error(
    "REPLICA_COPILOT_AUTHENTICATION must be ambient-cli, environment-token, or github-app-installation.",
  )
}
