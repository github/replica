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
    })
    .strict(),
  z
    .object({
      id: z.uuid(),
      type: z.literal("membership_assignment_restored"),
      membershipId: z.uuid(),
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
      assignmentId: z.uuid(),
      id: z.uuid(),
      membershipId: z.uuid(),
      role: z.enum(["MEMBER", "ADMINISTRATOR"]),
      type: z.enum([
        "provider_membership_assignment_created",
        "provider_membership_assignment_revoked",
        "provider_membership_assignment_superseded",
      ]),
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
        "authority_missing",
        "attempt_mismatch",
        "configuration_changed",
        "identity_mismatch",
        "membership_inactive",
        "membership_missing",
        "provider_evidence_missing",
        "provider_evidence_stale",
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
      reason: z.enum([
        "invariant",
        "reactivation_requires_revision",
        "revision_gap",
        "rollback",
        "same_revision_drift",
      ]),
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
  z
    .object({
      id: z.uuid(),
      providerId: z.uuid(),
      providerKey: z.unknown(),
      type: z.enum(["authentication_provider_disabled", "authentication_provider_enabled"]),
    })
    .strict(),
  z
    .object({
      id: z.uuid(),
      providerKeys: z.array(z.unknown()).max(10),
      reason: z.enum(["retry_exhausted", "transaction_error"]),
      type: z.literal("authentication_providers_reconcile_failed"),
    })
    .strict(),
  z
    .object({
      id: z.uuid(),
      reason: z.literal("provider_removed"),
      revision: z.number().int().nonnegative(),
      type: z.literal("session_revocation_advanced"),
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
    case "authentication_provider_disabled":
    case "authentication_provider_enabled":
      return { ...event, providerKey: parseProviderKey(event.providerKey) }
    case "authentication_providers_reconcile_failed":
      return {
        ...event,
        providerKeys: event.providerKeys.map((key) => parseProviderKey(key)),
      }
    default:
      return event
  }
}
