import type { Prisma } from "../../../generated/prisma/client.ts"
import { SecurityAuditOutcome } from "../../../generated/prisma/enums.ts"
import { createSecurityAuditContextWithProviderKey } from "../create-security-audit-context-with-provider-key/index.ts"
import type { ParsedSecurityAuditEvent } from "../parse-security-audit-event/types.ts"

export function getSecurityAuditData(
  event: ParsedSecurityAuditEvent,
): Prisma.SecurityAuditCreateInput {
  switch (event.type) {
    case "bootstrap_attempt_denied":
      return {
        id: event.id,
        action: "admission.bootstrap.denied",
        outcome: SecurityAuditOutcome.DENIED,
        targetType: "bootstrap_enrollment",
        context: { reason: event.reason },
      }
    case "membership_assignment_created":
    case "membership_assignment_restored":
      return {
        id: event.id,
        action:
          event.type === "membership_assignment_created"
            ? "membership.assignment.created"
            : "membership.assignment.restored",
        outcome: SecurityAuditOutcome.SUCCESS,
        targetType: "membership",
        targetId: event.membershipId,
        context: { source: "bootstrap", role: "administrator" },
      }
    case "membership_created":
    case "membership_restored":
      return {
        id: event.id,
        action: event.type === "membership_created" ? "membership.created" : "membership.restored",
        outcome: SecurityAuditOutcome.SUCCESS,
        targetType: "membership",
        targetId: event.membershipId,
        context: {},
      }
    case "provider_membership_assignment_created":
    case "provider_membership_assignment_revoked":
    case "provider_membership_assignment_superseded":
      return {
        id: event.id,
        action: event.type.replaceAll("_", "."),
        outcome: SecurityAuditOutcome.SUCCESS,
        targetType: "membership_assignment",
        targetId: event.assignmentId,
        context: {
          membershipId: event.membershipId,
          role: event.role.toLowerCase(),
          source: "authentication_provider",
        },
      }
    case "administrator_membership_assignment_created":
    case "administrator_membership_assignment_revoked":
      return {
        id: event.id,
        action:
          event.type === "administrator_membership_assignment_created"
            ? "membership.assignment.administrator_created"
            : "membership.assignment.administrator_revoked",
        outcome: SecurityAuditOutcome.SUCCESS,
        targetType: "membership_assignment",
        targetId: event.assignmentId,
        context: {
          actorMembershipId: event.actorMembershipId,
          source: "hub_administrator",
          targetMembershipId: event.targetMembershipId,
        },
      }
    case "administrator_management_denied":
    case "administrator_management_failed":
      return {
        id: event.id,
        action:
          event.type === "administrator_management_denied"
            ? "membership.administrator_management.denied"
            : "membership.administrator_management.failed",
        outcome:
          event.type === "administrator_management_denied"
            ? SecurityAuditOutcome.DENIED
            : SecurityAuditOutcome.FAILURE,
        targetType: "administrator_management",
        context: {
          actorMembershipId: event.actorMembershipId,
          operation: event.operation,
          reason: event.reason,
        },
      }
    case "administrator_authorization":
      return {
        id: event.id,
        action:
          event.operation === "END_ALL_HUB_SESSIONS"
            ? `session.revocation.authorization.${event.phase}`
            : `administrator.authorization.${event.phase}`,
        outcome:
          event.phase === "denied" || event.phase === "expired"
            ? SecurityAuditOutcome.DENIED
            : SecurityAuditOutcome.SUCCESS,
        targetType: "sensitive_authorization",
        targetId: event.authorizationId,
        context: {
          actorMembershipId: event.actorMembershipId,
          operation: event.operation.toLowerCase(),
          phase: event.phase,
          ...(event.reason ? { reason: event.reason } : {}),
          targetCount: event.targetCount,
        },
      }
    case "all_hub_sessions_ended":
      return {
        id: event.id,
        action: "session.revocation.end_all",
        outcome: SecurityAuditOutcome.SUCCESS,
        targetType: "session_revocation_state",
        targetId: "global",
        context: {
          actorMembershipId: event.actorMembershipId,
          cancelledAuthorizationCount: event.cancelledAuthorizationCount,
          endedSessionCount: event.endedSessionCount,
          revision: event.revision,
        },
      }
    case "session_created":
    case "session_ended":
      return {
        id: event.id,
        action: event.type === "session_created" ? "session.created" : "session.ended",
        outcome: SecurityAuditOutcome.SUCCESS,
        targetType: "hub_session",
        targetId: event.sessionId,
        context: { membershipId: event.membershipId },
      }
    case "admission_denied":
      return {
        id: event.id,
        action: "admission.denied",
        outcome: SecurityAuditOutcome.DENIED,
        targetType: "external_identity",
        targetId: event.externalIdentityId,
        context: { reason: event.reason },
      }
    case "admission_failed":
      return {
        id: event.id,
        action: "admission.failed",
        outcome: SecurityAuditOutcome.FAILURE,
        targetType: "external_identity",
        targetId: event.externalIdentityId,
        context: { reason: event.reason },
      }
    case "authentication_attempt_denied":
      return {
        id: event.id,
        action: "authentication.attempt.denied",
        outcome: SecurityAuditOutcome.DENIED,
        targetType: "authorization_attempt",
        context: createSecurityAuditContextWithProviderKey({
          provider: event.provider,
          reason: event.reason,
        }),
      }
    case "external_identity_created":
      return {
        id: event.id,
        action: "identity.external.created",
        outcome: SecurityAuditOutcome.SUCCESS,
        targetType: "external_identity",
        targetId: event.externalIdentityId,
        context: createSecurityAuditContextWithProviderKey({
          provider: event.provider,
          issuer: event.issuer,
        }),
      }
    case "external_identity_create_failed":
      return {
        id: event.id,
        action: "identity.external.create_failed",
        outcome: SecurityAuditOutcome.FAILURE,
        targetType: "external_identity",
        context: createSecurityAuditContextWithProviderKey({
          provider: event.provider,
          issuer: event.issuer,
          reason: event.reason,
        }),
      }
    case "provider_revision_selected":
      return {
        id: event.id,
        action: "identity.provider_revision.selected",
        outcome: SecurityAuditOutcome.SUCCESS,
        targetType: "authentication_provider",
        targetId: event.providerId,
        context: createSecurityAuditContextWithProviderKey({
          provider: event.providerKey,
          revision: event.revision,
        }),
      }
    case "provider_revision_validation_failed":
      return {
        id: event.id,
        action: "identity.provider_revision.validation_failed",
        outcome: SecurityAuditOutcome.FAILURE,
        targetType: "authentication_provider",
        context: createSecurityAuditContextWithProviderKey({
          provider: event.providerKey,
          revision: event.revision,
          reason: "validation_failed",
        }),
      }
    case "provider_revision_denied":
      return {
        id: event.id,
        action: "identity.provider_revision.denied",
        outcome: SecurityAuditOutcome.DENIED,
        targetType: "authentication_provider",
        context: createSecurityAuditContextWithProviderKey({
          provider: event.providerKey,
          revision: event.revision,
          reason: event.reason,
        }),
      }
    case "provider_revision_persist_failed":
      return {
        id: event.id,
        action: "identity.provider_revision.persist_failed",
        outcome: SecurityAuditOutcome.FAILURE,
        targetType: "authentication_provider",
        context: createSecurityAuditContextWithProviderKey({
          provider: event.providerKey,
          revision: event.revision,
          reason: event.reason,
        }),
      }
    case "authentication_provider_disabled":
    case "authentication_provider_enabled":
      return {
        id: event.id,
        action:
          event.type === "authentication_provider_disabled"
            ? "identity.authentication_provider.disabled"
            : "identity.authentication_provider.enabled",
        outcome: SecurityAuditOutcome.SUCCESS,
        targetType: "authentication_provider",
        targetId: event.providerId,
        context: createSecurityAuditContextWithProviderKey({
          provider: event.providerKey,
        }),
      }
    case "authentication_providers_reconcile_failed":
      return {
        id: event.id,
        action: "identity.authentication_providers.reconcile_failed",
        outcome: SecurityAuditOutcome.FAILURE,
        targetType: "authentication_providers",
        context: {
          providerKeys: event.providerKeys,
          reason: event.reason,
        },
      }
    case "session_revocation_advanced":
      return {
        id: event.id,
        action: "session.revocation.advanced",
        outcome: SecurityAuditOutcome.SUCCESS,
        targetType: "session_revocation_state",
        targetId: "global",
        context: { reason: event.reason, revision: event.revision },
      }
  }
}
