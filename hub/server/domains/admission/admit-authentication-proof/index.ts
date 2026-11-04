import { z } from "zod"

import { parseProviderKey } from "../../../utils/parse-provider-key/index.ts"
import { runWithBoundedRetries } from "../../identity/run-with-bounded-retries/index.ts"
import {
  AdmissionDeniedError,
  AdmissionPersistenceError,
  AdmissionTransactionConflictError,
} from "../errors.ts"
import type { AdmissionRepositories } from "../run-admission-transaction/types.ts"
import type {
  AdmitAuthenticationProofDependencies,
  AdmitAuthenticationProofInput,
  AdmittedHubSession,
} from "./types.ts"

const inputSchema = z
  .object({
    proof: z
      .object({
        authorizationAttemptId: z.uuid(),
        externalIdentityId: z.uuid(),
      })
      .strict(),
    providerKey: z.unknown(),
    sessionDigest: z.string().regex(/^[0-9a-f]{64}$/),
    sessionId: z.uuid(),
    sessionLifetimeSeconds: z.number().int().min(60).max(86_400),
  })
  .strict()

async function ensureBootstrapMembership(
  repositories: AdmissionRepositories,
  input: z.infer<typeof inputSchema>,
  userId: string,
  createId: () => string,
) {
  const membership = await repositories.createOrRestoreMembership({
    id: createId(),
    userId,
  })
  if (membership.transition !== "unchanged") {
    await repositories.createSecurityAudit({
      id: createId(),
      type: membership.transition === "created" ? "membership_created" : "membership_restored",
      membershipId: membership.id,
    })
  }
  const assignment = await repositories.createBootstrapAssignment({
    externalIdentityId: input.proof.externalIdentityId,
    id: createId(),
    membershipId: membership.id,
  })
  if (assignment === null) {
    throw new AdmissionDeniedError("identity_mismatch", input.proof.externalIdentityId)
  }
  if (assignment !== "unchanged") {
    await repositories.createSecurityAudit({
      id: createId(),
      type:
        assignment === "created"
          ? "membership_assignment_created"
          : "membership_assignment_restored",
      membershipId: membership.id,
    })
  }
  return {
    authorityRestored: membership.transition === "restored" || assignment === "restored",
    membershipId: membership.id,
  }
}

async function requireActiveMembership(
  repositories: AdmissionRepositories,
  userId: string,
  externalIdentityId: string,
) {
  const membership = await repositories.lockMembership(userId)
  if (!membership) throw new AdmissionDeniedError("membership_missing", externalIdentityId)
  if (membership.lifecycle !== "ACTIVE") {
    throw new AdmissionDeniedError("membership_inactive", externalIdentityId)
  }
  if (!(await repositories.lockActiveAssignment(membership.id))) {
    throw new AdmissionDeniedError("membership_inactive", externalIdentityId)
  }
  return membership.id
}

async function admitWithinTransaction(
  repositories: AdmissionRepositories,
  input: z.infer<typeof inputSchema> & { providerKey: string },
  createId: () => string,
): Promise<AdmittedHubSession> {
  const provider = await repositories.lockProvider(input.providerKey)
  const revocation = await repositories.lockRevocation()
  const attempt = await repositories.lockAttempt(input.proof.authorizationAttemptId)
  const identity = await repositories.getExternalIdentity(input.proof.externalIdentityId)
  if (!provider || !revocation || !attempt) {
    throw new AdmissionDeniedError("attempt_mismatch", input.proof.externalIdentityId)
  }
  if (!identity) {
    throw new AdmissionDeniedError("identity_mismatch", input.proof.externalIdentityId)
  }
  if (!attempt.consumedAt || provider.selectedRevisionId !== attempt.providerRevisionId) {
    throw new AdmissionDeniedError("configuration_changed", input.proof.externalIdentityId)
  }
  if (identity.provider !== input.providerKey) {
    throw new AdmissionDeniedError("identity_mismatch", input.proof.externalIdentityId)
  }
  let membershipId: string
  if (attempt.purpose === "ADMIN_ENROLLMENT") {
    const enrollment = await ensureBootstrapMembership(
      repositories,
      input,
      identity.userId,
      createId,
    )
    membershipId = enrollment.membershipId
    if (enrollment.authorityRestored) {
      const endedSessions = await repositories.endOpenHubSessionsForMembership(membershipId)
      for (const endedSession of endedSessions) {
        await repositories.createSecurityAudit({
          id: createId(),
          type: "session_ended",
          sessionId: endedSession.id,
          membershipId: endedSession.membershipId,
        })
      }
    }
  } else {
    membershipId = await requireActiveMembership(
      repositories,
      identity.userId,
      input.proof.externalIdentityId,
    )
  }
  const session = await repositories.createHubSession({
    digest: input.sessionDigest,
    id: input.sessionId,
    lifetimeSeconds: input.sessionLifetimeSeconds,
    membershipId,
    revocationRevision: revocation.revision,
  })
  await repositories.createSecurityAudit({
    id: createId(),
    type: "session_created",
    sessionId: input.sessionId,
    membershipId,
  })
  return {
    expiresAt: session.expiresAt,
  }
}

export async function admitAuthenticationProof(
  rawInput: AdmitAuthenticationProofInput,
  dependencies: AdmitAuthenticationProofDependencies,
): Promise<AdmittedHubSession> {
  const parsedInput = inputSchema.parse(rawInput)
  const input = {
    ...parsedInput,
    providerKey: parseProviderKey(parsedInput.providerKey),
  }
  try {
    return await runWithBoundedRetries(
      () =>
        dependencies.runTransaction((repositories) =>
          admitWithinTransaction(repositories, input, () => dependencies.createId()),
        ),
      (error) => error instanceof AdmissionTransactionConflictError,
    )
  } catch (error) {
    const denial = error instanceof AdmissionDeniedError
    const primary = denial ? error : new AdmissionPersistenceError({ cause: error })
    try {
      await dependencies.writeAudit(
        denial
          ? {
              id: dependencies.createId(),
              type: "admission_denied",
              externalIdentityId: input.proof.externalIdentityId,
              reason: error.reason,
            }
          : {
              id: dependencies.createId(),
              type: "admission_failed",
              externalIdentityId: input.proof.externalIdentityId,
              reason:
                error instanceof AdmissionTransactionConflictError
                  ? "retry_exhausted"
                  : "transaction_error",
            },
      )
    } catch (auditError) {
      throw new AggregateError(
        [primary, auditError],
        "The admission failure and its audit could not both be recorded.",
        { cause: auditError },
      )
    }
    throw primary
  }
}
