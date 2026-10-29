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

  it("rejects secret-bearing keys and values recursively before writing", () => {
    const create = vi.fn<(input: { data: Prisma.SecurityAuditCreateInput }) => Promise<unknown>>()

    expect(() =>
      createSecurityAudit(
        { securityAudit: { create } },
        {
          id: "5dd31031-6f1c-4c16-87c2-aee5342145cc",
          action: "identity.external.create_failed",
          outcome: SecurityAuditOutcome.FAILURE,
          targetType: "external_identity",
          context: { privateKey: "must-not-persist" },
        },
      ),
    ).toThrow("cannot contain secret-bearing fields")
    const secrets: Array<Record<string, string>> = [
      { databasePassword: "must-not-persist" },
      { clientSecret: "must-not-persist" },
      { accessToken: "must-not-persist" },
      { signingPrivateKey: "must-not-persist" },
    ]
    for (const secret of secrets) {
      expect(() =>
        createSecurityAudit(
          { securityAudit: { create } },
          {
            id: "5dd31031-6f1c-4c16-87c2-aee5342145cc",
            action: "identity.external.create_failed",
            outcome: SecurityAuditOutcome.FAILURE,
            targetType: "external_identity",
            context: { metadata: [secret] },
          },
        ),
      ).toThrow("cannot contain secret-bearing fields")
    }
    expect(() =>
      createSecurityAudit(
        { securityAudit: { create } },
        {
          id: "5dd31031-6f1c-4c16-87c2-aee5342145cc",
          action: "identity.external.create_failed",
          outcome: SecurityAuditOutcome.FAILURE,
          targetType: "external_identity",
          context: {
            certificate: [
              "-----BEGIN PRIVATE",
              " KEY-----\nmaterial\n-----END PRIVATE",
              " KEY-----",
            ].join(""),
          },
        },
      ),
    ).toThrow("cannot contain credential or key material")
    expect(create).not.toHaveBeenCalled()
  })

  it("allows non-secret key metadata and rejects context beyond the recursion bound", async () => {
    const create = vi.fn<(input: { data: Prisma.SecurityAuditCreateInput }) => Promise<unknown>>()
    create.mockResolvedValue(undefined)

    await createSecurityAudit(
      { securityAudit: { create } },
      {
        id: "5dd31031-6f1c-4c16-87c2-aee5342145cc",
        action: "identity.provider_revision.selected",
        outcome: SecurityAuditOutcome.SUCCESS,
        targetType: "authentication_provider",
        context: {
          tokenEndpoint: "https://id.example.test/token",
          keyId: "signing-key-1",
          publicKeyUrl: "https://id.example.test/keys",
        },
      },
    )
    expect(() =>
      createSecurityAudit(
        { securityAudit: { create } },
        {
          id: "5dd31031-6f1c-4c16-87c2-aee5342145cc",
          action: "identity.external.create_failed",
          outcome: SecurityAuditOutcome.FAILURE,
          targetType: "external_identity",
          context: { a: { b: { c: { d: { e: "too-deep" } } } } },
        },
      ),
    ).toThrow("cannot exceed 4 nested levels")
    expect(create).toHaveBeenCalledTimes(1)
  })
})
