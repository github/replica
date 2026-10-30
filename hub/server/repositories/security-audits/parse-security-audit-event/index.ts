import { z } from "zod"

import { parseProviderKey } from "../../../utils/parse-provider-key/index.ts"
import type { CreateSecurityAuditEvent } from "../create-security-audit/types.ts"

const eventSchema = z.discriminatedUnion("type", [
  z
    .object({
      id: z.uuid(),
      type: z.literal("external_identity_created"),
      externalIdentityId: z.uuid(),
      issuer: z.string().min(1).max(500),
      provider: z.unknown(),
    })
    .strict(),
  z
    .object({
      id: z.uuid(),
      type: z.literal("external_identity_create_failed"),
      issuer: z.string().min(1).max(500),
      provider: z.unknown(),
      reason: z.enum(["retry_exhausted", "transaction_error"]),
    })
    .strict(),
  z
    .object({
      id: z.uuid(),
      type: z.literal("provider_revision_validation_failed"),
      providerKey: z.unknown(),
      revision: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      id: z.uuid(),
      type: z.literal("provider_revision_selected"),
      providerId: z.uuid(),
      providerKey: z.unknown(),
      revision: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      id: z.uuid(),
      type: z.literal("provider_revision_denied"),
      providerKey: z.unknown(),
      reason: z.enum(["invariant", "revision_gap", "rollback", "same_revision_drift"]),
      revision: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      id: z.uuid(),
      type: z.literal("provider_revision_persist_failed"),
      providerKey: z.unknown(),
      reason: z.enum(["retry_exhausted", "transaction_error"]),
      revision: z.number().int().positive(),
    })
    .strict(),
])

export function parseSecurityAuditEvent(input: unknown): CreateSecurityAuditEvent {
  const event = eventSchema.parse(input)
  switch (event.type) {
    case "external_identity_created":
    case "external_identity_create_failed":
      return { ...event, provider: parseProviderKey(event.provider) }
    default:
      return { ...event, providerKey: parseProviderKey(event.providerKey) }
  }
}
