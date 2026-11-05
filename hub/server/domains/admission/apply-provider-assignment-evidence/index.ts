import { z } from "zod"

import { AdmissionTransactionConflictError } from "../errors.ts"
import type {
  ApplyProviderAssignmentEvidenceDependencies,
  ApplyProviderAssignmentEvidenceInput,
  ApplyProviderAssignmentEvidenceResult,
} from "./types.ts"

const inputSchema = z
  .object({
    assignmentSubject: z.uuid().nullable(),
    externalIdentityId: z.uuid(),
    providerRevisionId: z.uuid(),
    role: z.enum(["MEMBER", "ADMINISTRATOR"]).nullable(),
    userId: z.uuid(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.role !== null && input.assignmentSubject === null) {
      context.addIssue({
        code: "custom",
        message: "Provider role evidence requires an assignment subject.",
        path: ["assignmentSubject"],
      })
    }
  })

async function endMembershipSessions(
  membershipId: string,
  dependencies: ApplyProviderAssignmentEvidenceDependencies,
) {
  const endedSessions =
    await dependencies.repositories.endOpenHubSessionsForMembership(membershipId)
  for (const endedSession of endedSessions) {
    await dependencies.repositories.createSecurityAudit({
      id: dependencies.createId(),
      type: "session_ended",
      sessionId: endedSession.id,
      membershipId,
    })
  }
}

export async function applyProviderAssignmentEvidence(
  input: ApplyProviderAssignmentEvidenceInput,
  dependencies: ApplyProviderAssignmentEvidenceDependencies,
): Promise<ApplyProviderAssignmentEvidenceResult> {
  const parsed = inputSchema.parse(input)
  const existingMembership = await dependencies.repositories.lockMembership(parsed.userId)
  const activeProviderAssignment = await dependencies.repositories.lockActiveProviderAssignment(
    parsed.externalIdentityId,
  )
  if (!existingMembership && parsed.role === null) {
    return {
      denied: true,
      reason: "membership_missing",
    }
  }
  let membershipId = existingMembership?.id
  if (!membershipId) {
    membershipId = dependencies.createId()
    const created = await dependencies.repositories.createMembership({
      id: membershipId,
      userId: parsed.userId,
    })
    if (!created) throw new AdmissionTransactionConflictError()
    await dependencies.repositories.createSecurityAudit({
      id: dependencies.createId(),
      type: "membership_created",
      membershipId,
    })
  }
  let sessionsMustEnd = false
  if (parsed.role === null) {
    if (activeProviderAssignment) {
      await dependencies.repositories.endProviderAssignment({
        id: activeProviderAssignment.id,
        lifecycle: "REVOKED",
      })
      await dependencies.repositories.createSecurityAudit({
        assignmentId: activeProviderAssignment.id,
        id: dependencies.createId(),
        membershipId,
        role: activeProviderAssignment.role,
        type: "provider_membership_assignment_revoked",
      })
      sessionsMustEnd = true
    }
  } else if (
    !activeProviderAssignment ||
    activeProviderAssignment.role !== parsed.role ||
    activeProviderAssignment.providerRevisionId !== parsed.providerRevisionId ||
    activeProviderAssignment.providerAssignmentSubject !== parsed.assignmentSubject?.toLowerCase()
  ) {
    if (activeProviderAssignment) {
      await dependencies.repositories.endProviderAssignment({
        id: activeProviderAssignment.id,
        lifecycle: "SUPERSEDED",
      })
      await dependencies.repositories.createSecurityAudit({
        assignmentId: activeProviderAssignment.id,
        id: dependencies.createId(),
        membershipId,
        role: activeProviderAssignment.role,
        type: "provider_membership_assignment_superseded",
      })
    }
    const assignmentId = dependencies.createId()
    const created = await dependencies.repositories.createProviderAssignment({
      externalIdentityId: parsed.externalIdentityId,
      id: assignmentId,
      membershipId,
      providerAssignmentSubject: parsed.assignmentSubject!,
      providerRevisionId: parsed.providerRevisionId,
      role: parsed.role,
    })
    if (!created) throw new AdmissionTransactionConflictError()
    await dependencies.repositories.createSecurityAudit({
      assignmentId,
      id: dependencies.createId(),
      membershipId,
      role: parsed.role,
      type: "provider_membership_assignment_created",
    })
    sessionsMustEnd = Boolean(existingMembership)
  }
  if (sessionsMustEnd) {
    await endMembershipSessions(membershipId, dependencies)
  }
  if (existingMembership && existingMembership.lifecycle !== "ACTIVE") {
    return {
      denied: true,
      reason: "membership_inactive",
    }
  }
  const assignments = await dependencies.repositories.lockActiveAssignments(membershipId)
  if (!assignments.length) {
    return {
      denied: true,
      reason: "authority_missing",
    }
  }
  return {
    denied: false,
    membershipId,
    role: assignments.some((assignment) => assignment.role === "ADMINISTRATOR")
      ? "ADMINISTRATOR"
      : "MEMBER",
  }
}
