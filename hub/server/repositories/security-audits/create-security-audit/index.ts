import type { Prisma } from "../../../generated/prisma/client.ts"
import { SecurityAuditOutcome } from "../../../generated/prisma/enums.ts"
import { normalizeBoundedJson } from "../../../utils/normalize-bounded-json/index.ts"
import { z } from "zod"
import type { CreateSecurityAuditDatabase, CreateSecurityAuditEvent } from "./types.ts"

const eventSchema = z.discriminatedUnion("type", [
  z
    .object({
      id: z.uuid(),
      type: z.literal("external_identity_created"),
      externalIdentityId: z.uuid(),
      issuer: z.string().min(1).max(500),
      provider: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,99}$/),
    })
    .strict(),
  z
    .object({
      id: z.uuid(),
      type: z.literal("external_identity_create_failed"),
      issuer: z.string().min(1).max(500),
      provider: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,99}$/),
      reason: z.enum(["retry_exhausted", "transaction_error"]),
    })
    .strict(),
  z
    .object({
      id: z.uuid(),
      type: z.literal("provider_revision_selected"),
      providerId: z.uuid(),
      providerKey: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,99}$/),
      revision: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      id: z.uuid(),
      type: z.literal("provider_revision_denied"),
      providerKey: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,99}$/),
      reason: z.enum(["invariant", "revision_gap", "rollback", "same_revision_drift"]),
      revision: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      id: z.uuid(),
      type: z.literal("provider_revision_persist_failed"),
      providerKey: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,99}$/),
      reason: z.enum(["retry_exhausted", "transaction_error"]),
      revision: z.number().int().positive(),
    })
    .strict(),
])

function context(value: Record<string, boolean | number | string | null>) {
  return normalizeBoundedJson(value, {
    maxArrayItems: 0,
    maxBytes: 4_096,
    maxDepth: 1,
    maxEntries: 8,
    maxKeyLength: 100,
    maxObjectFields: 8,
    maxStringLength: 500,
  })
}

function dataForEvent(event: CreateSecurityAuditEvent): Prisma.SecurityAuditCreateInput {
  switch (event.type) {
    case "external_identity_created":
      return {
        id: event.id,
        action: "identity.external.created",
        outcome: SecurityAuditOutcome.SUCCESS,
        targetType: "external_identity",
        targetId: event.externalIdentityId,
        context: context({ provider: event.provider, issuer: event.issuer }),
      }
    case "external_identity_create_failed":
      return {
        id: event.id,
        action: "identity.external.create_failed",
        outcome: SecurityAuditOutcome.FAILURE,
        targetType: "external_identity",
        context: context({
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
        context: context({ provider: event.providerKey, revision: event.revision }),
      }
    case "provider_revision_denied":
      return {
        id: event.id,
        action: "identity.provider_revision.denied",
        outcome: SecurityAuditOutcome.DENIED,
        targetType: "authentication_provider",
        context: context({
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
        context: context({
          provider: event.providerKey,
          revision: event.revision,
          reason: event.reason,
        }),
      }
  }
}

export function createSecurityAudit(
  database: CreateSecurityAuditDatabase,
  event: CreateSecurityAuditEvent,
): Promise<unknown>
export function createSecurityAudit(database: CreateSecurityAuditDatabase, input: unknown) {
  const event: CreateSecurityAuditEvent = eventSchema.parse(input)
  return database.securityAudit.create({ data: dataForEvent(event) })
}
