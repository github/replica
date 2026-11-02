import { describe, expect, it, vi } from "vitest"

import type { Prisma } from "../../../generated/prisma/client"
import { createSecurityAudit } from "."

describe("createSecurityAudit()", () => {
  it.each(["secret:workforce", "GitHub.App/V2", "Entra:Tenant", "custom+提供者"])(
    "stores the exact canonical provider key %s through the typed audit mapping",
    async (providerKey) => {
      const create = vi.fn<(input: { data: Prisma.SecurityAuditCreateInput }) => Promise<unknown>>()
      create.mockResolvedValue(undefined)

      await createSecurityAudit(
        { securityAudit: { create } },
        {
          id: "5dd31031-6f1c-4c16-87c2-aee5342145cc",
          type: "provider_revision_selected",
          providerId: "df75faa4-ed4c-44ed-8db0-443cc3b426ed",
          providerKey,
          revision: 1,
        },
      )

      expect(create).toHaveBeenCalledOnce()
      expect(create.mock.calls[0]?.[0].data.context).toEqual({
        provider: providerKey,
        revision: 1,
      })
    },
  )

  it("maps each kernel event to its allowlisted audit record", async () => {
    const create = vi.fn<(input: { data: Prisma.SecurityAuditCreateInput }) => Promise<unknown>>()
    create.mockResolvedValue(undefined)
    const database = { securityAudit: { create } }
    const id = "5dd31031-6f1c-4c16-87c2-aee5342145cc"

    await createSecurityAudit(database, {
      id,
      type: "authentication_attempt_denied",
      provider: "github",
      reason: "invalid_or_expired",
    })
    await createSecurityAudit(database, {
      id,
      type: "authentication_attempt_denied",
      provider: "github",
      reason: "verification_state_invalid",
    })
    await createSecurityAudit(database, {
      id,
      type: "bootstrap_attempt_denied",
      reason: "invalid_secret",
    })
    await createSecurityAudit(database, {
      id,
      type: "membership_assignment_created",
      membershipId: "8a2479e7-3ca4-46f8-9749-c35d8e4eb09e",
      source: "bootstrap",
      role: "administrator",
    })
    await createSecurityAudit(database, {
      id,
      type: "membership_created",
      membershipId: "8a2479e7-3ca4-46f8-9749-c35d8e4eb09e",
    })
    await createSecurityAudit(database, {
      id,
      type: "membership_restored",
      membershipId: "8a2479e7-3ca4-46f8-9749-c35d8e4eb09e",
    })
    await createSecurityAudit(database, {
      id,
      type: "membership_assignment_restored",
      membershipId: "8a2479e7-3ca4-46f8-9749-c35d8e4eb09e",
      source: "bootstrap",
      role: "administrator",
    })
    await createSecurityAudit(database, {
      id,
      type: "session_created",
      sessionId: "85956fe6-022e-4092-a2ee-8435f612844f",
      membershipId: "8a2479e7-3ca4-46f8-9749-c35d8e4eb09e",
    })
    await createSecurityAudit(database, {
      id,
      type: "session_ended",
      sessionId: "85956fe6-022e-4092-a2ee-8435f612844f",
      membershipId: "8a2479e7-3ca4-46f8-9749-c35d8e4eb09e",
    })
    await createSecurityAudit(database, {
      id,
      type: "admission_denied",
      externalIdentityId: "e8714e71-52a7-45e8-a639-99ec37f2d85f",
      reason: "membership_missing",
    })
    await createSecurityAudit(database, {
      id,
      type: "admission_failed",
      externalIdentityId: "e8714e71-52a7-45e8-a639-99ec37f2d85f",
      reason: "retry_exhausted",
    })
    await createSecurityAudit(database, {
      id,
      type: "external_identity_created",
      externalIdentityId: "e8714e71-52a7-45e8-a639-99ec37f2d85f",
      provider: "workforce",
      issuer: "https://id.example.test",
    })
    await createSecurityAudit(database, {
      id,
      type: "external_identity_create_failed",
      provider: "workforce",
      issuer: "https://id.example.test",
      reason: "retry_exhausted",
    })
    await createSecurityAudit(database, {
      id,
      type: "provider_revision_validation_failed",
      providerKey: "workforce",
      revision: 1,
    })
    await createSecurityAudit(database, {
      id,
      type: "provider_revision_selected",
      providerId: "df75faa4-ed4c-44ed-8db0-443cc3b426ed",
      providerKey: "workforce",
      revision: 1,
    })
    await createSecurityAudit(database, {
      id,
      type: "provider_revision_denied",
      providerKey: "workforce",
      revision: 1,
      reason: "same_revision_drift",
    })
    await createSecurityAudit(database, {
      id,
      type: "provider_revision_persist_failed",
      providerKey: "workforce",
      revision: 1,
      reason: "transaction_error",
    })

    expect(create.mock.calls.map(([{ data }]) => data)).toEqual([
      expect.objectContaining({
        action: "authentication.attempt.denied",
        outcome: "DENIED",
        targetType: "authorization_attempt",
        context: { provider: "github", reason: "invalid_or_expired" },
      }),
      expect.objectContaining({
        action: "authentication.attempt.denied",
        outcome: "DENIED",
        targetType: "authorization_attempt",
        context: { provider: "github", reason: "verification_state_invalid" },
      }),
      expect.objectContaining({
        action: "admission.bootstrap.denied",
        outcome: "DENIED",
        targetType: "bootstrap_enrollment",
        context: { reason: "invalid_secret" },
      }),
      expect.objectContaining({
        action: "membership.assignment.created",
        outcome: "SUCCESS",
        targetType: "membership",
        context: { source: "bootstrap", role: "administrator" },
      }),
      expect.objectContaining({
        action: "membership.created",
        outcome: "SUCCESS",
        targetType: "membership",
        context: {},
      }),
      expect.objectContaining({
        action: "membership.restored",
        outcome: "SUCCESS",
        targetType: "membership",
        context: {},
      }),
      expect.objectContaining({
        action: "membership.assignment.restored",
        outcome: "SUCCESS",
        targetType: "membership",
        context: { source: "bootstrap", role: "administrator" },
      }),
      expect.objectContaining({
        action: "session.created",
        outcome: "SUCCESS",
        targetType: "hub_session",
        context: { membershipId: "8a2479e7-3ca4-46f8-9749-c35d8e4eb09e" },
      }),
      expect.objectContaining({
        action: "session.ended",
        outcome: "SUCCESS",
        targetType: "hub_session",
        context: { membershipId: "8a2479e7-3ca4-46f8-9749-c35d8e4eb09e" },
      }),
      expect.objectContaining({
        action: "admission.denied",
        outcome: "DENIED",
        targetType: "external_identity",
        context: { reason: "membership_missing" },
      }),
      expect.objectContaining({
        action: "admission.failed",
        outcome: "FAILURE",
        targetType: "external_identity",
        context: { reason: "retry_exhausted" },
      }),
      expect.objectContaining({
        action: "identity.external.created",
        outcome: "SUCCESS",
        targetType: "external_identity",
        context: { issuer: "https://id.example.test", provider: "workforce" },
      }),
      expect.objectContaining({
        action: "identity.external.create_failed",
        outcome: "FAILURE",
        context: {
          issuer: "https://id.example.test",
          provider: "workforce",
          reason: "retry_exhausted",
        },
      }),
      expect.objectContaining({
        action: "identity.provider_revision.validation_failed",
        outcome: "FAILURE",
        context: { provider: "workforce", reason: "validation_failed", revision: 1 },
      }),
      expect.objectContaining({
        action: "identity.provider_revision.selected",
        outcome: "SUCCESS",
        targetType: "authentication_provider",
        context: { provider: "workforce", revision: 1 },
      }),
      expect.objectContaining({
        action: "identity.provider_revision.denied",
        outcome: "DENIED",
        context: { provider: "workforce", reason: "same_revision_drift", revision: 1 },
      }),
      expect.objectContaining({
        action: "identity.provider_revision.persist_failed",
        outcome: "FAILURE",
        context: { provider: "workforce", reason: "transaction_error", revision: 1 },
      }),
    ])
  })

  it("rejects unknown fields and caller-supplied context before writing", () => {
    const create = vi.fn<(input: { data: Prisma.SecurityAuditCreateInput }) => Promise<unknown>>()
    const base = {
      id: "5dd31031-6f1c-4c16-87c2-aee5342145cc",
      type: "provider_revision_selected" as const,
      providerId: "df75faa4-ed4c-44ed-8db0-443cc3b426ed",
      providerKey: "workforce",
      revision: 1,
    }
    const withContext = { ...base, context: {} }
    const withUnexpected = { ...base, unexpected: { opaque: "untrusted-value" } }

    expect(() => createSecurityAudit({ securityAudit: { create } }, withContext)).toThrow()
    expect(() => createSecurityAudit({ securityAudit: { create } }, withUnexpected)).toThrow()
    expect(create).not.toHaveBeenCalled()
  })

  it("allows safe metadata only through typed audit fields", async () => {
    const create = vi.fn<(input: { data: Prisma.SecurityAuditCreateInput }) => Promise<unknown>>()
    create.mockResolvedValue(undefined)

    await createSecurityAudit(
      { securityAudit: { create } },
      {
        id: "5dd31031-6f1c-4c16-87c2-aee5342145cc",
        type: "external_identity_created",
        externalIdentityId: "e8714e71-52a7-45e8-a639-99ec37f2d85f",
        provider: "workforce",
        issuer: "https://id.example.test",
      },
    )

    expect(create).toHaveBeenCalledOnce()
    expect(create.mock.calls[0]?.[0].data.context).toEqual({
      issuer: "https://id.example.test",
      provider: "workforce",
    })
  })
})
