import { randomBytes } from "node:crypto"

import { isLocalDevelopmentDatabase } from "../../../utils/is-local-development-database/index.ts"
import { LocalSignInConfigurationError } from "../errors.ts"
import { readAuthenticationConfigurationState } from "../read-authentication-configuration-state/index.ts"

const loopbackHosts = new Set(["127.0.0.1", "[::1]", "localhost"])
const loopbackListenerHosts = new Set(["127.0.0.1", "::1", "localhost"])

/**
 * Prepares settings for local developer sign-in. It refuses anything that could reach
 * shared data or other people, because the local developer becomes an administrator
 * without any password. Missing secrets get throwaway values so no setup is needed.
 */
export function resolveLocalSignInEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const configuration = readAuthenticationConfigurationState(environment)
  if (!configuration.localConfigured) return environment
  if (!isLocalDevelopmentDatabase(environment)) {
    throw new LocalSignInConfigurationError(
      "HUB_LOCAL_SIGN_IN requires NODE_ENV=development and a local development DATABASE_URL.",
    )
  }
  if (configuration.githubConfigured || configuration.entraConfigured) {
    throw new LocalSignInConfigurationError(
      "HUB_LOCAL_SIGN_IN cannot be combined with GitHub or Entra sign-in settings.",
    )
  }
  const listenerHost = environment.HOST?.trim().toLowerCase() ?? "127.0.0.1"
  if (!loopbackListenerHosts.has(listenerHost)) {
    throw new LocalSignInConfigurationError(
      "HUB_LOCAL_SIGN_IN requires HOST to be 127.0.0.1, ::1, or localhost.",
    )
  }
  const applicationOrigin = configuration.applicationOrigin ?? "http://127.0.0.1:5173"
  const hostname = URL.parse(applicationOrigin)?.hostname
  if (!hostname || !loopbackHosts.has(hostname)) {
    throw new LocalSignInConfigurationError(
      "HUB_LOCAL_SIGN_IN requires a loopback HUB_APPLICATION_ORIGIN.",
    )
  }
  return {
    ...environment,
    HUB_APPLICATION_ORIGIN: applicationOrigin,
    HUB_AUTHENTICATION_ENCRYPTION_KEY:
      environment.HUB_AUTHENTICATION_ENCRYPTION_KEY?.trim() || randomBytes(32).toString("base64"),
    HUB_BOOTSTRAP_SECRET:
      environment.HUB_BOOTSTRAP_SECRET?.trim() || randomBytes(32).toString("base64url"),
  }
}
