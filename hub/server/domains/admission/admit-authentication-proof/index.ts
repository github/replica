import { timingSafeEqual } from "node:crypto"
import { z } from "zod"

import { parseProviderKey } from "../../../utils/parse-provider-key/index.ts"
import { runWithBoundedRetries } from "../../identity/run-with-bounded-retries/index.ts"
import { applyProviderAssignmentEvidence } from "../apply-provider-assignment-evidence/index.ts"
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
    providerAssignment: z
      .object({
        assignmentSubject: z.string().min(1).max(100).nullable(),
        issuedAt: z.date(),
        providerRevisionId: z.uuid(),
        role: z.enum(["MEMBER", "ADMINISTRATOR"]).nullable(),
      })
      .strict()
      .optional(),
    providerKey: z.unknown(),
    requiresProviderAssignmentEvidence: z.boolean(),
    sessionDigest: z.string().regex(/^[0-9a-f]{64}$/),
    sessionId: z.uuid(),
    sessionLifetimeSeconds: z.number().int().min(60).max(86_400),
  })
  .strict()
const authenticationDigestSchema = z.string().regex(/^[0-9a-f]{64}$/)

function matchesAuthenticationDigest(storedDigest: string | null, currentDigest: string): boolean {
  const stored = authenticationDigestSchema.safeParse(storedDigest)
  const current = authenticationDigestSchema.safeParse(currentDigest)
  if (!stored.success || !current.success) return false
  return timingSafeEqual(Buffer.from(stored.data, "hex"), Buffer.from(current.data, "hex"))
}

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
    authorityChanged:
      membership.transition === "restored" ||
      (membership.transition !== "created" && assignment !== "unchanged"),
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
  const assignments = await repositories.lockActiveAssignments(membership.id)
  if (!assignments.length) {
    throw new AdmissionDeniedError("authority_missing", externalIdentityId)
  }
  return {
    membershipId: membership.id,
    role: assignments.some((assignment) => assignment.role === "ADMINISTRATOR")
      ? ("ADMINISTRATOR" as const)
      : ("MEMBER" as const),
  }
}

async function endMembershipSessions(
  repositories: AdmissionRepositories,
  membershipId: string,
  createId: () => string,
) {
  const endedSessions = await repositories.endOpenHubSessionsForMembership(membershipId)
  for (const endedSession of endedSessions) {
    await repositories.createSecurityAudit({
      id: createId(),
      type: "session_ended",
      sessionId: endedSession.id,
      membershipId,
    })
  }
}

async function admitWithinTransaction(
  repositories: AdmissionRepositories,
  input: z.infer<typeof inputSchema> & { providerKey: string },
  createId: () => string,
  getBootstrapSecretDigest: () => string,
): Promise<
  | { admitted: AdmittedHubSession }
  | {
      denied: true
      reason: "authority_missing" | "membership_inactive" | "membership_missing"
    }
> {
  const provider = await repositories.lockProvider(input.providerKey)
  const revocation = await repositories.lockRevocation()
  const attempt = await repositories.lockAttempt(input.proof.authorizationAttemptId)
  const identity = await repositories.getExternalIdentity(input.proof.externalIdentityId)
  if (!provider || !provider.enabled || !revocation || !attempt) {
    throw new AdmissionDeniedError("attempt_mismatch", input.proof.externalIdentityId)
  }
  if (!identity) {
    throw new AdmissionDeniedError("identity_mismatch", input.proof.externalIdentityId)
  }
  if (
    !attempt.consumedAt ||
    provider.selectedRevisionId !== attempt.providerRevisionId ||
    revocation.revision !== attempt.sessionRevocationRevision
  ) {
    throw new AdmissionDeniedError("configuration_changed", input.proof.externalIdentityId)
  }
  if (identity.provider !== input.providerKey) {
    throw new AdmissionDeniedError("identity_mismatch", input.proof.externalIdentityId)
  }
  if (
    attempt.purpose === "ADMIN_ENROLLMENT" &&
    !matchesAuthenticationDigest(attempt.bootstrapSecretDigest, getBootstrapSecretDigest())
  ) {
    throw new AdmissionDeniedError("configuration_changed", input.proof.externalIdentityId)
  }
  if (input.requiresProviderAssignmentEvidence && !input.providerAssignment) {
    throw new AdmissionDeniedError("provider_evidence_missing", input.proof.externalIdentityId)
  }
  if (input.providerAssignment) {
    const claim = await repositories.claimProviderEvidence({
      externalIdentityId: input.proof.externalIdentityId,
      id: createId(),
      issuedAt: input.providerAssignment.issuedAt,
      role: input.providerAssignment.role,
    })
    if (claim === "conflict") throw new AdmissionTransactionConflictError()
    if (claim === "stale") {
      throw new AdmissionDeniedError("provider_evidence_stale", input.proof.externalIdentityId)
    }
  }
  let authority:
    | {
        membershipId: string
        role: "MEMBER" | "ADMINISTRATOR"
      }
    | undefined
  const administratorEnrollment = attempt.purpose === "ADMIN_ENROLLMENT"
  if (administratorEnrollment) {
    const enrollment = await ensureBootstrapMembership(
      repositories,
      input,
      identity.userId,
      createId,
    )
    authority = {
      membershipId: enrollment.membershipId,
      role: "ADMINISTRATOR",
    }
    if (enrollment.authorityChanged) {
      await endMembershipSessions(repositories, authority.membershipId, createId)
    }
  }
  if (input.providerAssignment) {
    if (input.providerAssignment.providerRevisionId !== attempt.providerRevisionId) {
      throw new AdmissionDeniedError("configuration_changed", input.proof.externalIdentityId)
    }
    const applied = await applyProviderAssignmentEvidence(
      {
        assignmentSubject: input.providerAssignment.assignmentSubject,
        externalIdentityId: input.proof.externalIdentityId,
        providerRevisionId: input.providerAssignment.providerRevisionId,
        role: input.providerAssignment.role,
        userId: identity.userId,
      },
      { createId, repositories },
    )
    if (applied.denied) {
      if (administratorEnrollment) {
        throw new AdmissionDeniedError(applied.reason, input.proof.externalIdentityId)
      }
      const reason = applied.reason
      await repositories.createSecurityAudit({
        id: createId(),
        type: "admission_denied",
        externalIdentityId: input.proof.externalIdentityId,
        reason,
      })
      return { denied: true, reason }
    }
    if (!administratorEnrollment) {
      authority = {
        membershipId: applied.membershipId,
        role: applied.role,
      }
    }
  } else if (!administratorEnrollment) {
    const active = await requireActiveMembership(
      repositories,
      identity.userId,
      input.proof.externalIdentityId,
    )
    authority = active
  }
  if (!authority) throw new AdmissionPersistenceError()
  const session = await repositories.createHubSession({
    digest: input.sessionDigest,
    externalIdentityId: input.proof.externalIdentityId,
    id: input.sessionId,
    lifetimeSeconds: input.sessionLifetimeSeconds,
    membershipId: authority.membershipId,
    providerRevisionId: attempt.providerRevisionId,
    revocationRevision: revocation.revision,
  })
  await repositories.createSecurityAudit({
    id: createId(),
    type: "session_created",
    sessionId: input.sessionId,
    membershipId: authority.membershipId,
  })
  return { admitted: { expiresAt: session.expiresAt, role: authority.role } }
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
  let result: Awaited<ReturnType<typeof admitWithinTransaction>>
  try {
    result = await runWithBoundedRetries(
      () =>
        dependencies.runTransaction((repositories) =>
          admitWithinTransaction(
            repositories,
            input,
            () => dependencies.createId(),
            () => dependencies.getBootstrapSecretDigest(),
          ),
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
  if ("admitted" in result) return result.admitted
  throw new AdmissionDeniedError(result.reason, input.proof.externalIdentityId)
}
