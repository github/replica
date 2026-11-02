import { createHash } from "node:crypto"
import { z } from "zod"

import { hashAuthenticationValue } from "../../../utils/authentication/hash-authentication-value/index.ts"
import { AuthenticationProofError } from "../errors.ts"
import { recordAuthenticationDenial } from "../record-authentication-denial/index.ts"
import type {
  StartAuthenticationProofDependencies,
  StartAuthenticationProofInput,
  StartAuthenticationProofResult,
} from "./types.ts"

const inputSchema = z.object({}).strict()
const ATTEMPT_LIFETIME_MS = 10 * 60 * 1_000

export async function startAuthenticationProof(
  input: StartAuthenticationProofInput,
  dependencies: StartAuthenticationProofDependencies,
): Promise<StartAuthenticationProofResult> {
  inputSchema.parse(input)
  await dependencies.deleteExpiredArtifacts()
  const selectedRevision = await dependencies.getSelectedProviderRevision()
  if (
    !selectedRevision ||
    selectedRevision.revision !== dependencies.expectedRevision ||
    selectedRevision.configurationDigest !== dependencies.configurationDigest
  ) {
    const error = new AuthenticationProofError(
      "configuration_changed",
      "The selected authentication provider configuration is unavailable.",
    )
    await recordAuthenticationDenial(error, () =>
      dependencies.writeDenialAudit("configuration_changed"),
    )
    throw error
  }

  const state = dependencies.createOpaqueValue()
  const browserBinding = dependencies.createOpaqueValue()
  const codeVerifier = dependencies.createOpaqueValue()
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url")
  const { expiresAt } = await dependencies.createAttempt({
    id: dependencies.createId(),
    providerRevisionId: selectedRevision.id,
    stateDigest: hashAuthenticationValue(state),
    browserBindingDigest: hashAuthenticationValue(browserBinding),
    codeVerifierCiphertext: dependencies.encryptCodeVerifier(codeVerifier),
    lifetimeSeconds: ATTEMPT_LIFETIME_MS / 1_000,
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
