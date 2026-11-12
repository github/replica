const githubKeys = ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET", "GITHUB_PROVIDER_REVISION"] as const

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
  const githubConfigured = githubKeys.some(configured)
  const entraConfigured = entraKeys.some(configured)
  const localConfigured = environment.HUB_LOCAL_SIGN_IN?.trim() === "true"
  return {
    applicationOrigin: environment.HUB_APPLICATION_ORIGIN?.trim() || undefined,
    entraConfigured,
    githubConfigured,
    localConfigured,
    providerConfigured: githubConfigured || entraConfigured || localConfigured,
    sharedConfigured: sharedKeys.some(configured),
  }
}
