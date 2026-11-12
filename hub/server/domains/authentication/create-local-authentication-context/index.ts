import { createHash } from "node:crypto"

import { createLocalUserAuthenticationAdapter } from "../create-local-user-authentication-adapter/index.ts"
import { createSharedAuthenticationContext } from "../create-shared-authentication-context/index.ts"

/**
 * Builds the local developer sign-in context. Hosted providers ask operators to bump a
 * revision setting, but local developers switch modes and origins often, so this picks
 * the next revision itself. Startup can then always re-enable local sign-in cleanly.
 */
export function createLocalAuthenticationContext(
  environment: NodeJS.ProcessEnv,
  latestRevision: { configurationDigest: string; enabled: boolean; revision: number } | null,
) {
  const shared = createSharedAuthenticationContext(environment)
  const callbackUri = new URL("/api/auth/local/callback", shared.applicationOrigin).toString()
  const adapter = createLocalUserAuthenticationAdapter({ callbackUri })
  const configurationDigest = createHash("sha256")
    .update(adapter.canonicalPublicConfiguration)
    .digest("hex")
  let providerRevision = 1
  if (latestRevision) {
    const unchanged =
      latestRevision.enabled && latestRevision.configurationDigest === configurationDigest
    providerRevision = unchanged ? latestRevision.revision : latestRevision.revision + 1
  }
  return {
    adapter,
    ...shared,
    callbackUri,
    configurationDigest,
    providerRevision,
    requiresProviderAssignmentEvidence: true,
  }
}
