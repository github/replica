import { z } from "zod"
import { Prisma } from "../../../generated/prisma/client.ts"

import { lockSelectedAuthenticationProvider } from "../../../repositories/authentication-providers/lock-selected-authentication-provider/index.ts"
import { lockConsumedAuthorizationAttempt } from "../../../repositories/authorization-attempts/lock-consumed-authorization-attempt/index.ts"
import { lockExternalIdentity } from "../../../repositories/external-identities/lock-external-identity/index.ts"
import { createHubSession } from "../../../repositories/hub-sessions/create-hub-session/index.ts"
import { createOrRestoreBootstrapAssignment } from "../../../repositories/membership-assignments/create-or-restore-bootstrap-assignment/index.ts"
import { lockActiveMembershipAssignment } from "../../../repositories/membership-assignments/lock-active-membership-assignment/index.ts"
import { createOrRestoreMembership } from "../../../repositories/memberships/create-or-restore-membership/index.ts"
import { lockMembership } from "../../../repositories/memberships/lock-membership/index.ts"
import { createSecurityAudit } from "../../../repositories/security-audits/create-security-audit/index.ts"
import { lockSessionRevocationState } from "../../../repositories/session-revocation-states/lock-session-revocation-state/index.ts"
import { parseProviderKey } from "../../../utils/parse-provider-key/index.ts"
import { AdmissionDeniedError } from "../errors.ts"
import type {
  AdmitAuthenticationProofDependencies,
  AdmitAuthenticationProofInput,
  AdmittedHubSession,
  AdmissionTransaction,
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
  transaction: AdmissionTransaction,
  input: z.infer<typeof inputSchema>,
  userId: string,
  createId: () => string,
) {
  const membership = await createOrRestoreMembership(transaction, {
    id: createId(),
    userId,
  })
  const assignment = await createOrRestoreBootstrapAssignment(transaction, {
    externalIdentityId: input.proof.externalIdentityId,
    id: createId(),
    membershipId: membership.id,
  })
  if (assignment) {
    await createSecurityAudit(transaction, {
      id: createId(),
      type: assignment.inserted
        ? "membership_assignment_created"
        : "membership_assignment_restored",
      membershipId: membership.id,
      source: "bootstrap",
      role: "administrator",
    })
  }
  return { membershipId: membership.id, role: "administrator" as const }
}

async function requireActiveMembership(
  transaction: AdmissionTransaction,
  userId: string,
  externalIdentityId: string,
) {
  const membership = await lockMembership(transaction, userId)
  if (!membership) throw new AdmissionDeniedError("membership_missing", externalIdentityId)
  if (membership.lifecycle !== "ACTIVE") {
    throw new AdmissionDeniedError("membership_inactive", externalIdentityId)
  }
  const assignment = await lockActiveMembershipAssignment(transaction, membership.id)
  if (!assignment) throw new AdmissionDeniedError("membership_inactive", externalIdentityId)
  return {
    membershipId: membership.id,
    role: assignment.role === "ADMINISTRATOR" ? ("administrator" as const) : ("member" as const),
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
    return await dependencies.database.$transaction(
      async (transaction) => {
        const provider = await lockSelectedAuthenticationProvider(transaction, input.providerKey)
        const revocation = await lockSessionRevocationState(transaction)
        const attempt = await lockConsumedAuthorizationAttempt(
          transaction,
          input.proof.authorizationAttemptId,
        )
        const identity = await lockExternalIdentity(transaction, input.proof.externalIdentityId)
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
        const membership =
          attempt.purpose === "ADMIN_ENROLLMENT"
            ? await ensureBootstrapMembership(transaction, input, identity.userId, () =>
                dependencies.createId(),
              )
            : await requireActiveMembership(
                transaction,
                identity.userId,
                input.proof.externalIdentityId,
              )
        const session = await createHubSession(transaction, {
          digest: input.sessionDigest,
          id: input.sessionId,
          lifetimeSeconds: input.sessionLifetimeSeconds,
          membershipId: membership.membershipId,
          revocationRevision: revocation.revision,
          userId: identity.userId,
        })
        await createSecurityAudit(transaction, {
          id: dependencies.createId(),
          type: "session_created",
          sessionId: input.sessionId,
          membershipId: membership.membershipId,
        })
        return {
          expiresAt: session.expiresAt,
          membershipId: membership.membershipId,
          role: membership.role,
          sessionId: input.sessionId,
          userId: identity.userId,
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )
  } catch (error) {
    if (!(error instanceof AdmissionDeniedError)) throw error
    try {
      await createSecurityAudit(dependencies.database, {
        id: dependencies.createId(),
        type: "admission_denied",
        externalIdentityId: error.externalIdentityId,
        reason: error.reason,
      })
    } catch (auditError) {
      throw new AggregateError(
        [error, auditError],
        "Admission denial and its audit could not both be recorded.",
        { cause: auditError },
      )
    }
    throw error
  }
}
