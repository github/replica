import { z } from "zod"

import { hashAuthenticationValue } from "../hash-authentication-value/index.ts"
import { AuthenticationProofError } from "../errors.ts"
import { parseImmutableIdentityEvidence } from "../parse-immutable-identity-evidence/index.ts"
import { recordAuthenticationDenial } from "../record-authentication-denial/index.ts"
import type {
  CompleteAuthenticationProofDependencies,
  CompleteAuthenticationProofInput,
  CompleteAuthenticationProofResult,
} from "./types.ts"

const inputSchema = z
  .object({
    browserBinding: z.string().min(32).max(200),
    code: z.string().min(1).max(2_048),
    state: z.string().min(32).max(200),
  })
  .strict()

async function configurationChanged(
  attempt: {
    providerRevisionId: string
    sessionRevocationRevision: number
  },
  dependencies: CompleteAuthenticationProofDependencies,
): Promise<boolean> {
  const state = await dependencies.getAuthenticationProofState()
  const selected = state?.selectedProviderRevision
  return (
    !state ||
    !selected ||
    selected.id !== attempt.providerRevisionId ||
    selected.revision !== dependencies.localRevision ||
    selected.configurationDigest !== dependencies.localConfigurationDigest ||
    state.sessionRevocationRevision !== attempt.sessionRevocationRevision
  )
}

export async function completeAuthenticationProof(
  input: CompleteAuthenticationProofInput,
  dependencies: CompleteAuthenticationProofDependencies,
): Promise<CompleteAuthenticationProofResult> {
  const parsed = inputSchema.parse(input)
  const browserBindingDigest = hashAuthenticationValue(parsed.browserBinding)
  const attempt = await dependencies.consumeAttempt({
    stateDigest: hashAuthenticationValue(parsed.state),
    browserBindingDigest,
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

  if (await configurationChanged(attempt, dependencies)) {
    const error = new AuthenticationProofError(
      "configuration_changed",
      "The authentication provider configuration changed during this attempt.",
    )
    await recordAuthenticationDenial(error, () =>
      dependencies.writeDenialAudit("configuration_changed"),
    )
    throw error
  }

  let codeVerifier
  let nonce
  try {
    codeVerifier = dependencies.decryptCodeVerifier(attempt.codeVerifierCiphertext)
    if (!attempt.nonceCiphertext) throw new Error("Missing nonce state.")
    nonce = dependencies.decryptNonce(attempt.nonceCiphertext)
  } catch {
    const error = new AuthenticationProofError(
      "verification_state_invalid",
      "The authentication attempt contains invalid verification state.",
    )
    await recordAuthenticationDenial(error, () =>
      dependencies.writeDenialAudit("verification_state_invalid"),
    )
    throw error
  }

  let evidence
  try {
    const completed = await dependencies.adapter.completeAuthenticationProof({
      authenticatedAfter: attempt.purpose === "ADMIN_ENROLLMENT" ? attempt.createdAt : undefined,
      callbackUri: dependencies.callbackUri,
      code: parsed.code,
      codeVerifier,
      nonce,
    })
    evidence = {
      ...completed,
      identity: parseImmutableIdentityEvidence(completed.identity),
    }
  } catch {
    const primaryError = new AuthenticationProofError(
      "provider_failed",
      "The authentication provider could not prove the external identity.",
    )
    await recordAuthenticationDenial(primaryError, () =>
      dependencies.writeDenialAudit("provider_failed"),
    )
    throw primaryError
  }
  if (evidence.identity.provider !== dependencies.adapter.providerKey) {
    const error = new AuthenticationProofError(
      "provider_failed",
      "The authentication provider returned mismatched identity evidence.",
    )
    await recordAuthenticationDenial(error, () => dependencies.writeDenialAudit("provider_failed"))
    throw error
  }

  if (await configurationChanged(attempt, dependencies)) {
    const error = new AuthenticationProofError(
      "configuration_changed",
      "The authentication provider configuration changed during this attempt.",
    )
    await recordAuthenticationDenial(error, () =>
      dependencies.writeDenialAudit("configuration_changed"),
    )
    throw error
  }
  let identity
  try {
    identity = await dependencies.resolveOrCreateIdentity({
      authorizationAttemptId: attempt.id,
      provider: evidence.identity.provider,
      issuer: evidence.identity.issuer,
      providerRevisionId: attempt.providerRevisionId,
      sessionRevocationRevision: attempt.sessionRevocationRevision,
      subject: evidence.identity.subject,
    })
  } catch (error) {
    if (!(error instanceof AuthenticationProofError)) throw error
    await recordAuthenticationDenial(error, () =>
      dependencies.writeDenialAudit("configuration_changed"),
    )
    throw error
  }
  return {
    providerAssignment: evidence.providerAssignment
      ? {
          ...evidence.providerAssignment,
          providerRevisionId: attempt.providerRevisionId,
        }
      : undefined,
    proof: {
      authorizationAttemptId: attempt.id,
      externalIdentityId: identity.externalIdentityId,
    },
  }
}
