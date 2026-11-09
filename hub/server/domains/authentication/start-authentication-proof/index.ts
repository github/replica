import { createHash } from "node:crypto"
import { z } from "zod"

import { hashAuthenticationValue } from "../hash-authentication-value/index.ts"
import { AuthenticationProofError } from "../errors.ts"
import { recordAuthenticationDenial } from "../record-authentication-denial/index.ts"
import type {
  StartAuthenticationProofDependencies,
  StartAuthenticationProofInput,
  StartAuthenticationProofResult,
} from "./types.ts"

const inputSchema = z
  .object({
    purpose: z.enum(["SIGN_IN", "ADMIN_ENROLLMENT", "ADMINISTRATOR_MANAGEMENT"]),
    sensitiveAuthorizationId: z.uuid().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.purpose === "ADMINISTRATOR_MANAGEMENT") !==
      (value.sensitiveAuthorizationId !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "Administrator management attempts require one sensitive authorization.",
      })
    }
  })
const ATTEMPT_LIFETIME_MS = 10 * 60 * 1_000

export async function startAuthenticationProof(
  input: StartAuthenticationProofInput,
  dependencies: StartAuthenticationProofDependencies,
): Promise<StartAuthenticationProofResult> {
  const parsed = inputSchema.parse(input)
  await dependencies.deleteExpiredArtifacts()
  const proofState = await dependencies.getAuthenticationProofState()
  const selectedRevision = proofState?.selectedProviderRevision
  if (
    !proofState ||
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
  const nonce = dependencies.createOpaqueValue()
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url")
  const authorizationAttemptId = dependencies.createId()
  const { expiresAt } = await dependencies.createAttempt({
    id: authorizationAttemptId,
    providerRevisionId: selectedRevision.id,
    stateDigest: hashAuthenticationValue(state),
    browserBindingDigest: hashAuthenticationValue(browserBinding),
    codeVerifierCiphertext: dependencies.encryptCodeVerifier(codeVerifier),
    lifetimeSeconds: ATTEMPT_LIFETIME_MS / 1_000,
    nonceCiphertext: dependencies.encryptNonce(nonce),
    purpose: parsed.purpose,
    sensitiveAuthorizationId: parsed.sensitiveAuthorizationId,
    sessionRevocationRevision: proofState.sessionRevocationRevision,
  })

  const authorizationUrl = await dependencies.adapter.createAuthorizationUrl({
    callbackUri: dependencies.callbackUri,
    codeChallenge,
    freshAuthentication: parsed.purpose !== "SIGN_IN",
    nonce,
    state,
  })
  return {
    authorizationAttemptId,
    authorizationUrl: authorizationUrl.toString(),
    browserBinding,
    expiresAt,
  }
}
