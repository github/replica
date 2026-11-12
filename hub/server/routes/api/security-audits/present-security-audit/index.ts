import { z } from "zod"

import type { SecurityAuditListRecord } from "../../../../repositories/security-audits/list-security-audits/types.ts"
import { parseProviderKey } from "../../../../utils/parse-provider-key/index.ts"
import { securityAuditRecordSchema } from "../contract.ts"

const actorContextSchema = z
  .object({
    actorMembershipId: z.uuid(),
  })
  .loose()
const membershipContextSchema = z
  .object({
    membershipId: z.uuid(),
  })
  .loose()
const reasonSchema = z.string().min(1).max(100)
const providerSchema = z.unknown().transform((value, context) => {
  try {
    return parseProviderKey(value)
  } catch {
    context.addIssue({ code: "custom", message: "Invalid provider key." })
    return z.NEVER
  }
})
const operationSchema = z.enum(["designate", "revoke"])

function actorFor(record: SecurityAuditListRecord) {
  switch (record.action) {
    case "administrator.authorization.requested":
    case "administrator.authorization.verified":
    case "administrator.authorization.completed":
    case "administrator.authorization.denied":
    case "administrator.authorization.expired":
    case "administrator.authorization.cancelled":
    case "session.revocation.authorization.requested":
    case "session.revocation.authorization.verified":
    case "session.revocation.authorization.completed":
    case "session.revocation.authorization.denied":
    case "session.revocation.authorization.expired":
    case "session.revocation.authorization.cancelled":
    case "session.revocation.end_all_failed":
    case "membership.administrator_management.denied":
    case "membership.administrator_management.failed":
    case "membership.assignment.administrator_created":
    case "membership.assignment.administrator_revoked": {
      const parsed = actorContextSchema.safeParse(record.context)
      return parsed.success ? { membershipId: parsed.data.actorMembershipId } : null
    }
    case "session.revocation.end_all": {
      const parsed = actorContextSchema.safeParse(record.context)
      return parsed.success ? { membershipId: parsed.data.actorMembershipId } : null
    }
    case "copilot.connection.connect":
    case "copilot.connection.disconnect":
    case "copilot.connection.view": {
      const parsed = actorContextSchema.safeParse(record.context)
      return parsed.success ? { membershipId: parsed.data.actorMembershipId } : null
    }
    case "session.created": {
      const parsed = membershipContextSchema.safeParse(record.context)
      return parsed.success ? { membershipId: parsed.data.membershipId } : null
    }
    case "copilot.connection.connected":
    case "copilot.connection.disconnected":
    case "copilot.connection.denied":
    case "copilot.connection.failed": {
      const parsed = actorContextSchema.safeParse(record.context)
      return parsed.success ? { membershipId: parsed.data.actorMembershipId } : null
    }
    default:
      return null
  }
}

function targetIdFor(record: SecurityAuditListRecord) {
  const parsed = z.uuid().safeParse(record.targetId)
  return parsed.success ? parsed.data : undefined
}

function contextFor(record: SecurityAuditListRecord): Record<string, string | number | string[]> {
  const targetId = targetIdFor(record)
  switch (record.action) {
    case "admission.bootstrap.denied":
    case "admission.denied":
    case "admission.failed": {
      const parsed = z.object({ reason: reasonSchema }).strict().safeParse(record.context)
      return parsed.success ? { reason: parsed.data.reason, ...(targetId ? { targetId } : {}) } : {}
    }
    case "authentication.attempt.denied": {
      const parsed = z
        .object({ provider: providerSchema, reason: reasonSchema })
        .strict()
        .safeParse(record.context)
      return parsed.success ? parsed.data : {}
    }
    case "membership.created":
    case "membership.restored":
      return targetId ? { targetId } : {}
    case "membership.assignment.created":
    case "membership.assignment.restored": {
      const parsed = z
        .object({
          role: z.literal("administrator"),
          source: z.literal("bootstrap"),
        })
        .strict()
        .safeParse(record.context)
      return parsed.success ? { ...parsed.data, ...(targetId ? { targetId } : {}) } : {}
    }
    case "provider.membership.assignment.created":
    case "provider.membership.assignment.revoked":
    case "provider.membership.assignment.superseded": {
      const parsed = z
        .object({
          membershipId: z.uuid(),
          role: z.enum(["member", "administrator"]),
          source: z.literal("authentication_provider"),
        })
        .strict()
        .safeParse(record.context)
      return parsed.success ? { ...parsed.data, ...(targetId ? { targetId } : {}) } : {}
    }
    case "membership.assignment.administrator_created":
    case "membership.assignment.administrator_revoked": {
      const parsed = z
        .object({
          actorMembershipId: z.uuid(),
          source: z.literal("hub_administrator"),
          targetMembershipId: z.uuid(),
        })
        .strict()
        .safeParse(record.context)
      return parsed.success
        ? {
            source: parsed.data.source,
            targetMembershipId: parsed.data.targetMembershipId,
            ...(targetId ? { targetId } : {}),
          }
        : {}
    }
    case "session.revocation.end_all_failed": {
      const parsed = z
        .object({
          actorMembershipId: z.uuid(),
          reason: z.enum(["retry_exhausted", "transaction_error"]),
        })
        .strict()
        .safeParse(record.context)
      return parsed.success ? { reason: parsed.data.reason } : {}
    }
    case "membership.administrator_management.denied":
    case "membership.administrator_management.failed": {
      const parsed = z
        .object({
          actorMembershipId: z.uuid().nullable(),
          operation: operationSchema,
          reason: reasonSchema,
        })
        .strict()
        .safeParse(record.context)
      return parsed.success ? { operation: parsed.data.operation, reason: parsed.data.reason } : {}
    }
    case "administrator.authorization.requested":
    case "administrator.authorization.verified":
    case "administrator.authorization.completed":
    case "administrator.authorization.denied":
    case "administrator.authorization.expired":
    case "administrator.authorization.cancelled":
    case "session.revocation.authorization.requested":
    case "session.revocation.authorization.verified":
    case "session.revocation.authorization.completed":
    case "session.revocation.authorization.denied":
    case "session.revocation.authorization.expired":
    case "session.revocation.authorization.cancelled": {
      const parsed = z
        .object({
          actorMembershipId: z.uuid(),
          operation: z.enum([
            "connect_copilot",
            "designate_administrators",
            "disconnect_copilot",
            "end_all_hub_sessions",
            "revoke_administrator",
          ]),
          phase: z.enum(["requested", "verified", "completed", "denied", "expired", "cancelled"]),
          reason: reasonSchema.optional(),
          targetCount: z.number().int().min(0).max(50),
        })
        .strict()
        .safeParse(record.context)
      return parsed.success
        ? {
            operation: parsed.data.operation,
            phase: parsed.data.phase,
            ...(parsed.data.reason ? { reason: parsed.data.reason } : {}),
            targetCount: parsed.data.targetCount,
            ...(targetId ? { targetId } : {}),
          }
        : {}
    }
    case "copilot.connection.connect":
    case "copilot.connection.disconnect":
    case "copilot.connection.view": {
      const parsed = z
        .object({
          actorMembershipId: z.uuid().nullable(),
          connectorMembershipId: z.uuid().optional(),
          operation: z.enum(["connect", "disconnect", "view"]),
          reason: reasonSchema.optional(),
        })
        .strict()
        .safeParse(record.context)
      return parsed.success
        ? {
            ...(parsed.data.connectorMembershipId
              ? { connectorMembershipId: parsed.data.connectorMembershipId }
              : {}),
            operation: parsed.data.operation,
            ...(parsed.data.reason ? { reason: parsed.data.reason } : {}),
          }
        : {}
    }
    case "session.created": {
      const parsed = z.object({ membershipId: z.uuid() }).strict().safeParse(record.context)
      return parsed.success && targetId ? { targetId } : {}
    }
    case "session.ended": {
      const parsed = z.object({ membershipId: z.uuid() }).strict().safeParse(record.context)
      return parsed.success && targetId ? { membershipId: parsed.data.membershipId, targetId } : {}
    }
    case "identity.external.created":
    case "identity.external.create_failed": {
      const parsed = z
        .object({
          issuer: z.string().min(1).max(500),
          provider: providerSchema,
          reason: reasonSchema.optional(),
        })
        .strict()
        .safeParse(record.context)
      return parsed.success
        ? {
            provider: parsed.data.provider,
            ...(parsed.data.reason ? { reason: parsed.data.reason } : {}),
            ...(targetId ? { targetId } : {}),
          }
        : {}
    }
    case "identity.provider_revision.selected":
    case "identity.provider_revision.denied":
    case "identity.provider_revision.persist_failed":
    case "identity.provider_revision.validation_failed": {
      const parsed = z
        .object({
          provider: providerSchema,
          reason: reasonSchema.optional(),
          revision: z.number().int().positive(),
        })
        .strict()
        .safeParse(record.context)
      return parsed.success
        ? {
            provider: parsed.data.provider,
            revision: parsed.data.revision,
            ...(parsed.data.reason ? { reason: parsed.data.reason } : {}),
            ...(targetId ? { targetId } : {}),
          }
        : {}
    }
    case "identity.authentication_provider.disabled":
    case "identity.authentication_provider.enabled": {
      const parsed = z.object({ provider: providerSchema }).strict().safeParse(record.context)
      return parsed.success
        ? { provider: parsed.data.provider, ...(targetId ? { targetId } : {}) }
        : {}
    }
    case "identity.authentication_providers.reconcile_failed": {
      const parsed = z
        .object({
          providerKeys: z.array(providerSchema).max(10),
          reason: reasonSchema,
        })
        .strict()
        .safeParse(record.context)
      return parsed.success ? parsed.data : {}
    }
    case "session.revocation.advanced": {
      const parsed = z
        .object({
          reason: z.literal("provider_removed"),
          revision: z.number().int().nonnegative(),
        })
        .strict()
        .safeParse(record.context)
      return parsed.success ? parsed.data : {}
    }
    case "session.revocation.end_all": {
      const parsed = z
        .object({
          actorMembershipId: z.uuid(),
          cancelledAuthorizationCount: z.number().int().nonnegative(),
          endedSessionCount: z.number().int().nonnegative(),
          revision: z.number().int().nonnegative(),
        })
        .strict()
        .safeParse(record.context)
      return parsed.success
        ? {
            cancelledAuthorizationCount: parsed.data.cancelledAuthorizationCount,
            endedSessionCount: parsed.data.endedSessionCount,
            revision: parsed.data.revision,
          }
        : {}
    }
    case "copilot.connection.connected":
    case "copilot.connection.disconnected":
    case "copilot.connection.denied":
    case "copilot.connection.failed": {
      const parsed = z
        .object({
          actorMembershipId: z.uuid().nullable(),
          credentialProvider: z.string().min(1).max(100),
          phase: z.enum(["connected", "disconnected", "denied", "failed"]),
          reason: reasonSchema.optional(),
        })
        .strict()
        .safeParse(record.context)
      return parsed.success
        ? {
            provider: parsed.data.credentialProvider,
            phase: parsed.data.phase,
            ...(parsed.data.reason ? { reason: parsed.data.reason } : {}),
            ...(targetId ? { targetId } : {}),
          }
        : {}
    }
    default:
      return {}
  }
}

export function presentSecurityAudit(record: SecurityAuditListRecord) {
  return securityAuditRecordSchema.parse({
    action: record.action,
    actor: actorFor(record),
    context: contextFor(record),
    id: record.id,
    occurredAt: record.createdAt.toISOString(),
    outcome: record.outcome?.toLowerCase() ?? null,
  })
}
