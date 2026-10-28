import { describe, expect, it, vi } from "vitest"

import { createAuthenticationService } from "#server/domains/authentication/create-service"
import type { IdentityRecords, IdentityStore } from "#server/domains/identity/create-store/types"
import { digestSecret } from "#server/utils/digest-secret"

const session = {
  id: "session",
  userId: "user",
  externalIdentityId: "identity",
  authenticationProviderRevisionId: "revision",
  tokenDigest: digestSecret("session-token"),
  signedInAt: new Date("2026-10-27T18:00:00.000Z"),
  freshAuthorizedAt: new Date("2026-10-27T18:00:00.000Z"),
  user: { id: "user", displayName: "Member", avatarUrl: null },
  externalIdentity: {
    id: "identity",
    userId: "user",
    provider: "github",
    issuer: "https://github.com",
    subject: "42",
    username: "member",
    displayName: "Member",
    avatarUrl: null,
  },
  authenticationProviderRevision: {
    id: "revision",
    authenticationProviderId: "provider",
    revision: 1,
    issuer: "https://github.com",
    configuration: {},
    authenticationProvider: {
      id: "provider",
      key: "github",
      type: "github",
      enabled: true,
    },
  },
}

describe("createAuthenticationService() membership enforcement", () => {
  it.each(["suspended", "removed"] as const)(
    "fails closed when a valid session belongs to a %s membership",
    async (status) => {
      const records = {
        session: vi.fn().mockResolvedValue(session),
        membership: vi.fn().mockResolvedValue({
          id: "membership",
          userId: session.userId,
          status,
          role: "member",
          source: "invitation",
          suspendedAt: status === "suspended" ? new Date() : null,
          removedAt: status === "removed" ? new Date() : null,
        }),
      } as unknown as IdentityRecords
      const store: IdentityStore = {
        read: records,
        lock: (operation) => operation(records, {} as never),
      }
      const service = createAuthenticationService({
        store,
        github: null,
        configuration: null,
        providerRevisionId: null,
        admissionPolicy: {
          name: "hub-managed",
          admit: () => Promise.resolve(false),
        },
      })

      await expect(service.current("session-token")).rejects.toMatchObject({
        status: 401,
        code: "membership_inactive",
      })
    },
  )
})
