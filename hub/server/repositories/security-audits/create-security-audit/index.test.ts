import { describe, expect, it, vi } from "vitest"

import type { Prisma } from "../../../generated/prisma/client"
import { createSecurityAudit } from "."

describe("createSecurityAudit()", () => {
  it("maps each kernel event to its allowlisted audit record", async () => {
    const create = vi.fn<(input: { data: Prisma.SecurityAuditCreateInput }) => Promise<unknown>>()
    create.mockResolvedValue(undefined)
    const database = { securityAudit: { create } }
    const id = "5dd31031-6f1c-4c16-87c2-aee5342145cc"

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
