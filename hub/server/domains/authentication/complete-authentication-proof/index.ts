import { z } from "zod"

import { hashAuthenticationValue } from "../../../utils/authentication/hash-authentication-value/index.ts"
import { AuthenticationProofError } from "../errors.ts"
import { recordAuthenticationDenial } from "../record-authentication-denial/index.ts"
import type {
  CompleteAuthenticationProofDependencies,
  CompleteAuthenticationProofInput,
  CompleteAuthenticationProofResult,
} from "./types.ts"

const inputSchema = z
  .object({
    browserBinding: z.string().min(32).max(200),
    code: z.string().min(1).max(1_000),
    state: z.string().min(32).max(200),
  })
  .strict()
const HANDOFF_LIFETIME_MS = 5 * 60 * 1_000

export async function completeAuthenticationProof(
  input: CompleteAuthenticationProofInput,
  dependencies: CompleteAuthenticationProofDependencies,
): Promise<CompleteAuthenticationProofResult> {
  const parsed = inputSchema.parse(input)
  const now = dependencies.now()
  const browserBindingDigest = hashAuthenticationValue(parsed.browserBinding)
  const attempt = await dependencies.consumeAttempt({
    stateDigest: hashAuthenticationValue(parsed.state),
    browserBindingDigest,
    consumedAt: now,
  })
  if (!attempt) {
    const error = new AuthenticationProofError(
      "attempt_invalid",
      "The authentication attempt is invalid or has expired.",
    )
    await recordAuthenticationDenial(error, () =>
      dependencies.writeDenialAudit("invalid_or_expired"),
    )
    throw error
  }

  const selectedBeforeProof = await dependencies.getSelectedProviderRevision()
  if (!selectedBeforeProof || selectedBeforeProof.id !== attempt.providerRevisionId) {
    const error = new AuthenticationProofError(
      "configuration_changed",
      "The authentication provider configuration changed during this attempt.",
    )
    await recordAuthenticationDenial(error, () =>
      dependencies.writeDenialAudit("configuration_changed"),
    )
    throw error
  }

  let evidence
  try {
    evidence = await dependencies.adapter.completeAuthenticationProof({
      callbackUri: dependencies.callbackUri,
      code: parsed.code,
      codeVerifier: dependencies.decryptCodeVerifier(attempt.codeVerifierCiphertext),
    })
  } catch (error) {
    const primaryError = new AuthenticationProofError(
      "provider_failed",
      "The authentication provider could not prove the external identity.",
      { cause: error },
    )
    await recordAuthenticationDenial(primaryError, () =>
      dependencies.writeDenialAudit("provider_failed"),
    )
    throw primaryError
  }
  if (evidence.provider !== dependencies.adapter.providerKey) {
    const error = new AuthenticationProofError(
      "provider_failed",
      "The authentication provider returned mismatched identity evidence.",
    )
    await recordAuthenticationDenial(error, () => dependencies.writeDenialAudit("provider_failed"))
    throw error
  }

  const selectedAfterProof = await dependencies.getSelectedProviderRevision()
  if (!selectedAfterProof || selectedAfterProof.id !== attempt.providerRevisionId) {
    const error = new AuthenticationProofError(
      "configuration_changed",
      "The authentication provider configuration changed during this attempt.",
    )
    await recordAuthenticationDenial(error, () =>
      dependencies.writeDenialAudit("configuration_changed"),
    )
    throw error
  }
  const expectedRevocationGeneration = await dependencies.getRevocationGeneration()
  const identity = await dependencies.resolveOrCreateIdentity({
    provider: evidence.provider,
    issuer: evidence.issuer,
    subject: evidence.subject,
  })
  const handoffToken = dependencies.createOpaqueValue()
  const expiresAt = new Date(dependencies.now().getTime() + HANDOFF_LIFETIME_MS)
  const handoff = await dependencies.createHandoff({
    externalIdentityId: identity.externalIdentityId,
    providerRevisionId: attempt.providerRevisionId,
    browserBindingDigest,
    tokenDigest: hashAuthenticationValue(handoffToken),
    displayAttributes: evidence.attributes,
    expiresAt,
    expectedRevocationGeneration,
  })
  if (handoff.status === "restart") {
    const error = new AuthenticationProofError(
      "configuration_changed",
      "Authentication state changed before the admission handoff was created.",
    )
    await recordAuthenticationDenial(error, () =>
      dependencies.writeDenialAudit("configuration_changed"),
    )
    throw error
  }

  return {
    status: "authentication_proved",
    handoffToken,
    attributes: evidence.attributes,
    expiresAt,
  }
}
