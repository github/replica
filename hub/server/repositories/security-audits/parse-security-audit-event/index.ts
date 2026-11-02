import { z } from "zod"

import { parseProviderKey } from "../../../utils/parse-provider-key/index.ts"
import type { ParsedSecurityAuditEvent } from "./types.ts"

const eventSchema = z.discriminatedUnion("type", [
  z
    .object({
      id: z.uuid(),
      type: z.literal("authentication_attempt_denied"),
      provider: z.unknown(),
      reason: z.enum([
        "configuration_changed",
        "invalid_or_expired",
        "provider_failed",
        "verification_state_invalid",
      ]),
    })
    .strict(),
  z
    .object({
      id: z.uuid(),
      type: z.literal("bootstrap_attempt_denied"),
      reason: z.enum(["invalid_secret", "rate_limited"]),
    })
    .strict(),
  z
    .object({
      id: z.uuid(),
      type: z.literal("membership_assignment_created"),
      membershipId: z.uuid(),
      source: z.literal("bootstrap"),
      role: z.literal("administrator"),
    })
    .strict(),
  z
    .object({
      id: z.uuid(),
      type: z.literal("membership_assignment_restored"),
      membershipId: z.uuid(),
      source: z.literal("bootstrap"),
      role: z.literal("administrator"),
    })
    .strict(),
  z
    .object({
      id: z.uuid(),
      type: z.literal("membership_assignment_revoked"),
      membershipId: z.uuid(),
      source: z.literal("bootstrap"),
      role: z.literal("administrator"),
    })
    .strict(),
  z
    .object({
      id: z.uuid(),
      type: z.literal("membership_created"),
      membershipId: z.uuid(),
    })
    .strict(),
  z
    .object({
      id: z.uuid(),
      type: z.literal("membership_restored"),
      membershipId: z.uuid(),
    })
    .strict(),
  z
    .object({
      id: z.uuid(),
      type: z.literal("session_created"),
      sessionId: z.uuid(),
      membershipId: z.uuid(),
    })
    .strict(),
  z
    .object({
      id: z.uuid(),
      type: z.literal("session_ended"),
      sessionId: z.uuid(),
      membershipId: z.uuid(),
    })
    .strict(),
  z
    .object({
      id: z.uuid(),
      type: z.literal("admission_denied"),
      externalIdentityId: z.uuid(),
      reason: z.enum([
        "attempt_mismatch",
        "configuration_changed",
        "identity_mismatch",
        "membership_inactive",
        "membership_missing",
        "provider_revoked",
      ]),
    })
    .strict(),
  z
    .object({
      id: z.uuid(),
      type: z.literal("admission_failed"),
      externalIdentityId: z.uuid(),
      reason: z.enum(["retry_exhausted", "transaction_error"]),
    })
    .strict(),
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

export function parseSecurityAuditEvent(input: unknown): ParsedSecurityAuditEvent {
  const event = eventSchema.parse(input)
  switch (event.type) {
    case "authentication_attempt_denied":
    case "external_identity_created":
    case "external_identity_create_failed":
      return { ...event, provider: parseProviderKey(event.provider) }
    case "provider_revision_validation_failed":
    case "provider_revision_selected":
    case "provider_revision_denied":
    case "provider_revision_persist_failed":
      return { ...event, providerKey: parseProviderKey(event.providerKey) }
    default:
      return event
  }
}
