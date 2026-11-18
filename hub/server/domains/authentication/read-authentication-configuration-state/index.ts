import { readGitHubAppConfiguration } from "../read-github-app-configuration/index.ts"

const entraKeys = [
  "ENTRA_OIDC_CLIENT_AUTHENTICATION",
  "ENTRA_OIDC_CLIENT_ID",
  "ENTRA_OIDC_CLIENT_SECRET",
  "ENTRA_OIDC_ISSUER",
  "ENTRA_OIDC_MANAGED_IDENTITY_CLIENT_ID",
  "ENTRA_OIDC_PROVIDER_REVISION",
] as const

const sharedKeys = ["HUB_AUTHENTICATION_ENCRYPTION_KEY", "HUB_BOOTSTRAP_SECRET"] as const

export function readAuthenticationConfigurationState(environment: NodeJS.ProcessEnv) {
  function configured(key: string) {
    return Boolean(environment[key]?.trim())
  }
  const github = readGitHubAppConfiguration(environment)
  const copilotOnlyApp =
    environment.REPLICA_COPILOT_AUTHENTICATION?.trim() === "github-app-installation" &&
    github.signIn === "not_configured" &&
    !configured("GITHUB_APP_INSTALLATION_ID") &&
    !configured("GITHUB_WEBHOOK_SECRET")
  const githubStatus = copilotOnlyApp ? "not_configured" : github.status
  const githubConfigured = githubStatus === "configured"
  const entraConfigured = entraKeys.some(configured)
  const localConfigured = environment.HUB_LOCAL_SIGN_IN?.trim() === "true"
  return {
    applicationOrigin: environment.HUB_APPLICATION_ORIGIN?.trim() || undefined,
    entraConfigured,
    githubConfigured,
    githubProblems: copilotOnlyApp ? [] : github.problems,
    githubSettingsPresent: githubStatus !== "not_configured",
    githubStatus,
    localConfigured,
    providerConfigured: githubConfigured || entraConfigured || localConfigured,
    sharedConfigured: sharedKeys.some(configured),
  }
}
