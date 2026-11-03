import type { AuthenticationRouteDependencies } from "../routes/api/auth/types.ts"

export async function createOptionalAuthenticationRouteDependencies(
  environment: NodeJS.ProcessEnv,
): Promise<AuthenticationRouteDependencies | undefined> {
  if (!environment.HUB_APPLICATION_ORIGIN) return undefined
  const { createAuthenticationRouteDependencies } =
    await import("../create-authentication-route-dependencies/index.ts")
  return createAuthenticationRouteDependencies(environment)
}
