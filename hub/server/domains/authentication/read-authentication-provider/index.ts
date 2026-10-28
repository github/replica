export function readAuthenticationProvider(environment: NodeJS.ProcessEnv): "github" | "oidc" {
  const provider = environment.HUB_AUTH_PROVIDER
  if (provider !== "github" && provider !== "oidc") {
    throw new Error("Set HUB_AUTH_PROVIDER to github or oidc.")
  }
  return provider
}
