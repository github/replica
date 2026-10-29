import { describe, expect, it, vi } from "vitest"
import type { Mocked } from "vitest"

import { createAdministrationService } from "#server/domains/administration/create-service"
import type { IdentityRecords, IdentityStore } from "#server/domains/identity/create-store/types"
import { digestSecret } from "#server/utils/digest-secret"

const now = new Date("2026-10-27T18:00:00.000Z")
const administratorMembership = {
  id: "00000000-0000-4000-8000-000000000001",
  userId: "administrator",
  status: "active" as const,
  role: "administrator" as const,
  source: "manual",
  suspendedAt: null,
  removedAt: null,
}
const administratorSession = {
  id: "session",
  userId: "administrator",
  externalIdentityId: "identity",
  authenticationProviderRevisionId: "revision",
  tokenDigest: digestSecret("session-token"),
  signedInAt: now,
  freshAuthorizedAt: now,
  user: { id: "administrator", displayName: "Administrator", avatarUrl: null },
  externalIdentity: {
    id: "identity",
    userId: "administrator",
    provider: "github",
    issuer: "https://github.com",
    subject: "42",
    username: "administrator",
    displayName: "Administrator",
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

function records(overrides: Partial<Mocked<IdentityRecords>> = {}) {
  return Object.assign(
    {
      session: vi.fn().mockResolvedValue(administratorSession),
      sessionById: vi.fn().mockResolvedValue(administratorSession),
      membership: vi.fn().mockResolvedValue(administratorMembership),
      membershipById: vi.fn().mockResolvedValue(null),
      activeAdministratorCount: vi.fn().mockResolvedValue(2),
      revokeExpiredInvitations: vi.fn(),
      externalIdentity: vi.fn().mockResolvedValue(null),
      usableInvitation: vi.fn().mockResolvedValue(null),
      createInvitation: vi.fn(),
      revokeInvitation: vi.fn().mockResolvedValue(false),
      saveMembership: vi.fn(),
      deleteUserSessions: vi.fn(),
      audit: vi.fn(),
    },
    overrides,
  )
}

function service(identityRecords: ReturnType<typeof records>) {
  const typedRecords = identityRecords as unknown as IdentityRecords
  const store: IdentityStore = {
    read: typedRecords,
    lock: (operation) => operation(typedRecords),
  }
  return createAdministrationService({ store, now: () => now })
}

describe("createAdministrationService()", () => {
  it("rejects a future fresh authorization timestamp", async () => {
    const identityRecords = records({
      session: vi.fn().mockResolvedValue({
        ...administratorSession,
        freshAuthorizedAt: new Date(now.getTime() + 1),
      }),
    })

    await expect(
      service(identityRecords).invite("session-token", {
        provider: "github",
        issuer: "https://github.com",
        subject: "99",
        role: "member",
      }),
    ).rejects.toMatchObject({
      status: 403,
      code: "fresh_authorization_required",
      message: "Verify your identity again.",
    })
    expect(identityRecords.createInvitation).not.toHaveBeenCalled()
  })

  it("rejects a malformed invitation ID with the stable unavailable response", async () => {
    const identityRecords = records()

    await expect(
      service(identityRecords).revokeInvitation("session-token", "not-a-uuid"),
    ).rejects.toMatchObject({
      status: 409,
      code: "invitation_changed",
      message: "The invitation is no longer available.",
    })
    expect(identityRecords.revokeInvitation).not.toHaveBeenCalled()
  })

  it("rejects malformed and missing membership IDs with the stable not-found response", async () => {
    const identityRecords = records()
    const administration = service(identityRecords)

    await expect(
      administration.changeMembership("session-token", "not-a-uuid", {
        role: "member",
      }),
    ).rejects.toMatchObject({
      status: 404,
      code: "membership_not_found",
      message: "The membership was not found.",
    })
    expect(identityRecords.membershipById).not.toHaveBeenCalled()

    await expect(
      administration.changeMembership("session-token", "00000000-0000-4000-8000-000000000099", {
        role: "member",
      }),
    ).rejects.toMatchObject({
      status: 404,
      code: "membership_not_found",
      message: "The membership was not found.",
    })
    expect(identityRecords.membershipById).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000099",
    )
    expect(identityRecords.saveMembership).not.toHaveBeenCalled()
  })
})
