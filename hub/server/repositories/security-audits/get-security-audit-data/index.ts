import type { Prisma } from "../../../generated/prisma/client.ts"
import { SecurityAuditOutcome } from "../../../generated/prisma/enums.ts"
import { createSecurityAuditContext } from "../create-security-audit-context/index.ts"
import type { CreateSecurityAuditEvent } from "../create-security-audit/types.ts"

export function getSecurityAuditData(
  event: CreateSecurityAuditEvent,
): Prisma.SecurityAuditCreateInput {
  switch (event.type) {
    case "external_identity_created":
      return {
        id: event.id,
        action: "identity.external.created",
        outcome: SecurityAuditOutcome.SUCCESS,
        targetType: "external_identity",
        targetId: event.externalIdentityId,
        context: createSecurityAuditContext({
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
        context: createSecurityAuditContext({
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
        context: createSecurityAuditContext({
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
        context: createSecurityAuditContext({
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
        context: createSecurityAuditContext({
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
        context: createSecurityAuditContext({
          provider: event.providerKey,
          revision: event.revision,
          reason: event.reason,
        }),
      }
  }
}
