import { describe, expect, it, vi } from "vitest"

import type { Prisma } from "../../../generated/prisma/client"
import { SecurityAuditOutcome } from "../../../generated/prisma/enums"
import { createSecurityAudit } from "."

describe("createSecurityAudit()", () => {
  it("passes a bounded context to the database", async () => {
    const create = vi.fn<(input: { data: Prisma.SecurityAuditCreateInput }) => Promise<unknown>>()
    create.mockResolvedValue(undefined)

    const input = {
      id: "5dd31031-6f1c-4c16-87c2-aee5342145cc",
      action: "identity.external.created",
      outcome: SecurityAuditOutcome.SUCCESS,
      targetType: "external_identity",
      context: { provider: "workforce", revision: 1 },
    }
    await createSecurityAudit({ securityAudit: { create } }, input)

    expect(create).toHaveBeenCalledWith({ data: input })
  })

  it("rejects secret-bearing and oversized context before writing", () => {
    const create = vi.fn<(input: { data: Prisma.SecurityAuditCreateInput }) => Promise<unknown>>()

    expect(() =>
      createSecurityAudit(
        { securityAudit: { create } },
        {
          id: "5dd31031-6f1c-4c16-87c2-aee5342145cc",
          action: "identity.external.create_failed",
          outcome: SecurityAuditOutcome.FAILURE,
          targetType: "external_identity",
          context: { accessToken: "must-not-persist" },
        },
      ),
    ).toThrow("cannot contain secret-bearing fields")
    expect(() =>
      createSecurityAudit(
        { securityAudit: { create } },
        {
          id: "5dd31031-6f1c-4c16-87c2-aee5342145cc",
          action: "identity.external.create_failed",
          outcome: SecurityAuditOutcome.FAILURE,
          targetType: "external_identity",
          context: { detail: "x".repeat(501) },
        },
      ),
    ).toThrow("cannot exceed 500 characters")
    expect(create).not.toHaveBeenCalled()
  })
})
