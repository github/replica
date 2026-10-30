import { createHash } from "node:crypto"
import { z } from "zod"

import { hashAuthenticationValue } from "../../../utils/authentication/hash-authentication-value/index.ts"
import { AuthenticationProofError } from "../errors.ts"
import type {
  StartAuthenticationProofDependencies,
  StartAuthenticationProofInput,
  StartAuthenticationProofResult,
} from "./types.ts"

const inputSchema = z.object({ requestIp: z.string().min(1).max(200) }).strict()
const ATTEMPT_LIFETIME_MS = 10 * 60 * 1_000
const INITIATION_WINDOW_MS = 10 * 60 * 1_000
const INITIATION_LIMIT = 10

export async function startAuthenticationProof(
  input: StartAuthenticationProofInput,
  dependencies: StartAuthenticationProofDependencies,
): Promise<StartAuthenticationProofResult> {
  const parsed = inputSchema.parse(input)
  const now = dependencies.now()
  await dependencies.deleteExpiredArtifacts(now)
  const requestIpDigest = hashAuthenticationValue(parsed.requestIp)
  const recentAttemptCount = await dependencies.recentAttemptCount({
    requestIpDigest,
    createdAfter: new Date(now.getTime() - INITIATION_WINDOW_MS),
  })
  if (recentAttemptCount >= INITIATION_LIMIT) {
    await dependencies.writeDenialAudit("rate_limited")
    throw new AuthenticationProofError(
      "rate_limited",
      "Too many authentication attempts were started.",
    )
  }

  const selectedRevision = await dependencies.getSelectedProviderRevision()
  if (
    !selectedRevision ||
    selectedRevision.revision !== dependencies.expectedRevision ||
    selectedRevision.configurationDigest !== dependencies.configurationDigest
  ) {
    await dependencies.writeDenialAudit("configuration_changed")
    throw new AuthenticationProofError(
      "configuration_changed",
      "The selected authentication provider configuration is unavailable.",
    )
  }

  const state = dependencies.createOpaqueValue()
  const browserBinding = dependencies.createOpaqueValue()
  const codeVerifier = dependencies.createOpaqueValue()
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url")
  const expiresAt = new Date(now.getTime() + ATTEMPT_LIFETIME_MS)

  await dependencies.createAttempt({
    id: dependencies.createId(),
    providerRevisionId: selectedRevision.id,
    stateDigest: hashAuthenticationValue(state),
    browserBindingDigest: hashAuthenticationValue(browserBinding),
    codeChallenge,
    codeVerifierCiphertext: dependencies.encryptCodeVerifier(codeVerifier),
    requestIpDigest,
    expiresAt,
  })

  return {
    authorizationUrl: dependencies.adapter
      .createAuthorizationUrl({
        callbackUri: dependencies.callbackUri,
        codeChallenge,
        state,
      })
      .toString(),
    browserBinding,
    expiresAt,
  }
}
