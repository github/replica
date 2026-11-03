import type { AuthenticationRouteDependencies } from "../routes/api/authentication/types.ts"

export async function createOptionalAuthenticationRouteDependencies(
  environment: NodeJS.ProcessEnv,
): Promise<AuthenticationRouteDependencies | undefined> {
  if (!environment.HUB_APPLICATION_ORIGIN) return undefined
  const { createAuthenticationRouteDependencies } =
    await import("../create-authentication-route-dependencies/index.ts")
  return createAuthenticationRouteDependencies(environment)
}
