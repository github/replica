import { randomUUID } from "node:crypto"
import pg from "pg"
import { describe, expect, it } from "vitest"

import { prisma } from "../../integrations/prisma"
import { createSecurityAudit } from "../../repositories/security-audits/create-security-audit"
import { getDatabaseUrl } from "../../../test/database/get-database-url"
import { waitForDatabaseLock } from "../../../test/database/wait-for-database-lock"
import { withFailingSecurityAudit } from "../../../test/database/with-failing-security-audit"
import { countEffectiveAdministrators } from "./count-effective-administrators"
import { designateHubAdministrators } from "./designate-hub-administrators"
import { AdministratorManagementPersistenceError } from "./errors"
import { listEffectiveAdministrators } from "./list-effective-administrators"
import { revokeHubAdministrator } from "./revoke-hub-administrator"
import { runAdministratorManagementTransaction } from "./run-administrator-management-transaction"
import type { AdministratorManagementDependencies } from "./types"

type AssignmentSource = "BOOTSTRAP" | "AUTHENTICATION_PROVIDER" | "HUB_ADMINISTRATOR"

async function createMembership(input: {
  lifecycle?: "ACTIVE" | "SUSPENDED" | "REMOVED"
  withExternalIdentity?: boolean
}) {
  const userId = randomUUID()
  const membershipId = randomUUID()
  const externalIdentityId = input.withExternalIdentity === false ? undefined : randomUUID()
  await prisma.user.create({ data: { id: userId } })
  if (externalIdentityId) {
    await prisma.externalIdentity.create({
      data: {
        id: externalIdentityId,
        issuer: "https://github.com",
        provider: "github",
        subject: randomUUID(),
        userId,
      },
    })
  }
  await prisma.membership.create({
    data: {
      id: membershipId,
      lifecycle: input.lifecycle ?? "ACTIVE",
      userId,
    },
  })
  return { externalIdentityId, membershipId, userId }
}

async function createAssignment(input: {
  externalIdentityId: string
  lifecycle?: "ACTIVE" | "REVOKED" | "SUPERSEDED"
  membershipId: string
  providerRevisionId?: string
  role?: "ADMINISTRATOR" | "MEMBER"
  source: AssignmentSource
}) {
  const id = randomUUID()
  await prisma.membershipAssignment.create({
    data: {
      externalIdentityId: input.externalIdentityId,
      id,
      lifecycle: input.lifecycle ?? "ACTIVE",
      membershipId: input.membershipId,
      providerAssignmentSubject:
        input.source === "AUTHENTICATION_PROVIDER" ? randomUUID() : undefined,
      providerRevisionId: input.providerRevisionId,
      role: input.role ?? "ADMINISTRATOR",
      source: input.source as never,
    },
  })
  return id
}

async function createProvider(input: { enabled: boolean; selectedAssignmentRevision: boolean }) {
  const providerId = randomUUID()
  const assignmentRevisionId = randomUUID()
  const selectedRevisionId = input.selectedAssignmentRevision ? assignmentRevisionId : randomUUID()
  await prisma.authenticationProvider.create({
    data: { enabled: false, id: providerId, key: randomUUID() },
  })
  await prisma.authenticationProviderRevision.createMany({
    data: [
      {
        configurationDigest: "a".repeat(64),
        id: assignmentRevisionId,
        providerId,
        revision: 1,
      },
      ...(input.selectedAssignmentRevision
        ? []
        : [
            {
              configurationDigest: "b".repeat(64),
              id: selectedRevisionId,
              providerId,
              revision: 2,
            },
          ]),
    ],
  })
  await prisma.authenticationProvider.update({
    data: { enabled: true, selectedRevisionId },
    where: { id: providerId },
  })
  if (!input.enabled) {
    await prisma.authenticationProvider.update({
      data: { enabled: false, selectedRevisionId: null },
      where: { id: providerId },
    })
  }
  return assignmentRevisionId
}

function dependencies(): AdministratorManagementDependencies {
  return {
    createId: () => randomUUID(),
    runTransaction: (operation) => runAdministratorManagementTransaction(prisma, operation),
    writeAudit: (event) => createSecurityAudit(prisma, event),
  }
}

function auditContext(value: unknown) {
  return value as {
    actorMembershipId?: string | null
    operation?: string
    reason?: string
    targetMembershipId?: string
  }
}

async function administratorAuditTargets(actorMembershipId: string) {
  const audits = await prisma.securityAudit.findMany({
    select: { context: true, outcome: true },
  })
  return audits
    .filter(
      ({ context, outcome }) =>
        outcome === "SUCCESS" && auditContext(context).actorMembershipId === actorMembershipId,
    )
    .map(({ context }) => auditContext(context).targetMembershipId)
}

describe("administrator management", () => {
  it("lists each effective active administrator once and ignores inactive provider authority", async () => {
    const duplicate = await createMembership({})
    const providerAdministrator = await createMembership({})
    const staleProviderAdministrator = await createMembership({})
    const disabledProviderAdministrator = await createMembership({})
    const inactiveMembership = await createMembership({ lifecycle: "SUSPENDED" })
    const selectedRevisionId = await createProvider({
      enabled: true,
      selectedAssignmentRevision: true,
    })
    const staleRevisionId = await createProvider({
      enabled: true,
      selectedAssignmentRevision: false,
    })
    const disabledRevisionId = await createProvider({
      enabled: false,
      selectedAssignmentRevision: true,
    })

    await Promise.all([
      createAssignment({
        externalIdentityId: duplicate.externalIdentityId!,
        membershipId: duplicate.membershipId,
        source: "BOOTSTRAP",
      }),
      createAssignment({
        externalIdentityId: duplicate.externalIdentityId!,
        membershipId: duplicate.membershipId,
        source: "HUB_ADMINISTRATOR",
      }),
      createAssignment({
        externalIdentityId: providerAdministrator.externalIdentityId!,
        membershipId: providerAdministrator.membershipId,
        providerRevisionId: selectedRevisionId,
        source: "AUTHENTICATION_PROVIDER",
      }),
      createAssignment({
        externalIdentityId: staleProviderAdministrator.externalIdentityId!,
        membershipId: staleProviderAdministrator.membershipId,
        providerRevisionId: staleRevisionId,
        source: "AUTHENTICATION_PROVIDER",
      }),
      createAssignment({
        externalIdentityId: disabledProviderAdministrator.externalIdentityId!,
        membershipId: disabledProviderAdministrator.membershipId,
        providerRevisionId: disabledRevisionId,
        source: "AUTHENTICATION_PROVIDER",
      }),
      createAssignment({
        externalIdentityId: inactiveMembership.externalIdentityId!,
        membershipId: inactiveMembership.membershipId,
        source: "BOOTSTRAP",
      }),
    ])

    const { administrators } = await listEffectiveAdministrators(prisma)

    expect(administrators.map(({ membershipId }) => membershipId).sort()).toEqual(
      [duplicate.membershipId, providerAdministrator.membershipId].sort(),
    )
    await expect(countEffectiveAdministrators(prisma)).resolves.toBe(2)
  })

  it("paginates effective administrators without duplicates or a trailing cursor", async () => {
    const memberships = await Promise.all([
      createMembership({}),
      createMembership({}),
      createMembership({}),
    ])
    await Promise.all(
      memberships.map((membership) =>
        createAssignment({
          externalIdentityId: membership.externalIdentityId!,
          membershipId: membership.membershipId,
          source: "HUB_ADMINISTRATOR",
        }),
      ),
    )

    const firstPage = await listEffectiveAdministrators(prisma, { limit: 2 })
    expect(firstPage.administrators).toHaveLength(2)
    expect(firstPage.nextCursor).not.toBeNull()
    const secondPage = await listEffectiveAdministrators(prisma, {
      before: firstPage.nextCursor!,
      limit: 2,
    })

    expect(secondPage.administrators).toHaveLength(1)
    expect(secondPage.nextCursor).toBeNull()
    const listedIds = [...firstPage.administrators, ...secondPage.administrators].map(
      ({ membershipId }) => membershipId,
    )
    expect(new Set(listedIds).size).toBe(3)
    expect(listedIds.sort()).toEqual(memberships.map(({ membershipId }) => membershipId).sort())
  })

  it("designates a valid bulk selection atomically with one assignment and audit per target", async () => {
    const actor = await createMembership({})
    const firstTarget = await createMembership({})
    const secondTarget = await createMembership({})
    await createAssignment({
      externalIdentityId: actor.externalIdentityId!,
      membershipId: actor.membershipId,
      source: "BOOTSTRAP",
    })

    await designateHubAdministrators(
      {
        actorMembershipId: actor.membershipId,
        targetMembershipIds: [firstTarget.membershipId, secondTarget.membershipId],
      },
      dependencies(),
    )

    const assignments = await prisma.membershipAssignment.findMany({
      orderBy: { membershipId: "asc" },
      select: { lifecycle: true, membershipId: true, role: true, source: true },
      where: { source: "HUB_ADMINISTRATOR" as never },
    })
    expect(assignments).toEqual(
      [firstTarget.membershipId, secondTarget.membershipId].sort().map((membershipId) => ({
        lifecycle: "ACTIVE",
        membershipId,
        role: "ADMINISTRATOR",
        source: "HUB_ADMINISTRATOR",
      })),
    )
    expect((await administratorAuditTargets(actor.membershipId)).sort()).toEqual(
      [firstTarget.membershipId, secondTarget.membershipId].sort(),
    )
    await expect(
      designateHubAdministrators(
        {
          actorMembershipId: actor.membershipId,
          targetMembershipIds: [firstTarget.membershipId],
        },
        dependencies(),
      ),
    ).rejects.toMatchObject({ reason: "role_changed" })
  })

  it.each([
    ["is suspended", { lifecycle: "SUSPENDED" as const }],
    ["has no external identity", { withExternalIdentity: false }],
  ])("rolls back the full designation when one target %s", async (_case, invalidInput) => {
    const actor = await createMembership({})
    const validTarget = await createMembership({})
    const invalidTarget = await createMembership(invalidInput)
    await createAssignment({
      externalIdentityId: actor.externalIdentityId!,
      membershipId: actor.membershipId,
      source: "BOOTSTRAP",
    })

    await expect(
      designateHubAdministrators(
        {
          actorMembershipId: actor.membershipId,
          targetMembershipIds: [validTarget.membershipId, invalidTarget.membershipId],
        },
        dependencies(),
      ),
    ).rejects.toMatchObject({ reason: "invalid_target" })

    await expect(
      prisma.membershipAssignment.count({
        where: { source: "HUB_ADMINISTRATOR" as never },
      }),
    ).resolves.toBe(0)
    await expect(administratorAuditTargets(actor.membershipId)).resolves.toEqual([])
  })

  it("revokes only administrator-managed provenance and rejects a repeated revocation", async () => {
    const actor = await createMembership({})
    const target = await createMembership({})
    const providerRevisionId = await createProvider({
      enabled: true,
      selectedAssignmentRevision: true,
    })
    await createAssignment({
      externalIdentityId: actor.externalIdentityId!,
      membershipId: actor.membershipId,
      source: "BOOTSTRAP",
    })
    const bootstrapAssignmentId = await createAssignment({
      externalIdentityId: target.externalIdentityId!,
      membershipId: target.membershipId,
      source: "BOOTSTRAP",
    })
    const providerAssignmentId = await createAssignment({
      externalIdentityId: target.externalIdentityId!,
      membershipId: target.membershipId,
      providerRevisionId,
      source: "AUTHENTICATION_PROVIDER",
    })
    const managedAssignmentId = await createAssignment({
      externalIdentityId: target.externalIdentityId!,
      membershipId: target.membershipId,
      source: "HUB_ADMINISTRATOR",
    })

    await revokeHubAdministrator(
      {
        actorMembershipId: actor.membershipId,
        targetMembershipId: target.membershipId,
      },
      dependencies(),
    )

    await expect(
      prisma.membershipAssignment.findMany({
        orderBy: { id: "asc" },
        select: { id: true, lifecycle: true },
        where: {
          id: { in: [bootstrapAssignmentId, providerAssignmentId, managedAssignmentId] },
        },
      }),
    ).resolves.toEqual(
      [
        { id: bootstrapAssignmentId, lifecycle: "ACTIVE" },
        { id: providerAssignmentId, lifecycle: "ACTIVE" },
        { id: managedAssignmentId, lifecycle: "REVOKED" },
      ].sort((left, right) => left.id.localeCompare(right.id)),
    )
    expect(
      (await listEffectiveAdministrators(prisma)).administrators.map(
        ({ membershipId }) => membershipId,
      ),
    ).toContain(target.membershipId)
    await expect(
      revokeHubAdministrator(
        {
          actorMembershipId: actor.membershipId,
          targetMembershipId: target.membershipId,
        },
        dependencies(),
      ),
    ).rejects.toMatchObject({ reason: "role_changed" })
    await expect(administratorAuditTargets(actor.membershipId)).resolves.toEqual([
      target.membershipId,
    ])
  })

  it("rereads live actor authority before designation", async () => {
    const staleActor = await createMembership({})
    const target = await createMembership({})
    await createAssignment({
      externalIdentityId: staleActor.externalIdentityId!,
      lifecycle: "REVOKED",
      membershipId: staleActor.membershipId,
      source: "HUB_ADMINISTRATOR",
    })

    await expect(
      designateHubAdministrators(
        {
          actorMembershipId: staleActor.membershipId,
          targetMembershipIds: [target.membershipId],
        },
        dependencies(),
      ),
    ).rejects.toMatchObject({ reason: "not_authorized" })
    await expect(
      prisma.membershipAssignment.count({
        where: {
          membershipId: target.membershipId,
          source: "HUB_ADMINISTRATOR" as never,
        },
      }),
    ).resolves.toBe(0)
  })

  it("denies revocation by a revoked actor with one terminal denial audit", async () => {
    const staleActor = await createMembership({})
    const target = await createMembership({})
    const remainingAdministrator = await createMembership({})
    await createAssignment({
      externalIdentityId: staleActor.externalIdentityId!,
      lifecycle: "REVOKED",
      membershipId: staleActor.membershipId,
      source: "HUB_ADMINISTRATOR",
    })
    const targetAssignmentId = await createAssignment({
      externalIdentityId: target.externalIdentityId!,
      membershipId: target.membershipId,
      source: "HUB_ADMINISTRATOR",
    })
    await createAssignment({
      externalIdentityId: remainingAdministrator.externalIdentityId!,
      membershipId: remainingAdministrator.membershipId,
      source: "BOOTSTRAP",
    })

    await expect(
      revokeHubAdministrator(
        {
          actorMembershipId: staleActor.membershipId,
          targetMembershipId: target.membershipId,
        },
        dependencies(),
      ),
    ).rejects.toMatchObject({ reason: "not_authorized" })
    await expect(
      prisma.membershipAssignment.findUniqueOrThrow({
        select: { lifecycle: true },
        where: { id: targetAssignmentId },
      }),
    ).resolves.toEqual({ lifecycle: "ACTIVE" })
    await expect(administratorAuditTargets(staleActor.membershipId)).resolves.toEqual([])
    await expect(
      prisma.securityAudit.findMany({
        select: { action: true, context: true, outcome: true },
        where: { outcome: "DENIED" },
      }),
    ).resolves.toEqual([
      {
        action: "membership.administrator_management.denied",
        context: {
          actorMembershipId: staleActor.membershipId,
          operation: "revoke",
          reason: "not_authorized",
        },
        outcome: "DENIED",
      },
    ])
  })

  it("rolls back a designation when its success audit fails", async () => {
    const actor = await createMembership({})
    const target = await createMembership({})
    await createAssignment({
      externalIdentityId: actor.externalIdentityId!,
      membershipId: actor.membershipId,
      source: "BOOTSTRAP",
    })

    await withFailingSecurityAudit("membership.assignment.administrator_created", () =>
      expect(
        designateHubAdministrators(
          {
            actorMembershipId: actor.membershipId,
            targetMembershipIds: [target.membershipId],
          },
          dependencies(),
        ),
      ).rejects.toBeInstanceOf(AdministratorManagementPersistenceError),
    )

    await expect(
      prisma.membershipAssignment.count({
        where: {
          membershipId: target.membershipId,
          source: "HUB_ADMINISTRATOR" as never,
        },
      }),
    ).resolves.toBe(0)
  })

  it.each(["designation", "revocation"] as const)(
    "ends target sessions and audits them during %s",
    async (operation) => {
      const actor = await createMembership({})
      const target = await createMembership({})
      await createAssignment({
        externalIdentityId: actor.externalIdentityId!,
        membershipId: actor.membershipId,
        source: "BOOTSTRAP",
      })
      if (operation === "revocation") {
        await createAssignment({
          externalIdentityId: target.externalIdentityId!,
          membershipId: target.membershipId,
          source: "HUB_ADMINISTRATOR",
        })
      }
      const sessionId = randomUUID()
      await prisma.hubSession.create({
        data: {
          digest: operation === "designation" ? "a".repeat(64) : "b".repeat(64),
          expiresAt: new Date("2099-01-01T00:00:00Z"),
          id: sessionId,
          membershipId: target.membershipId,
          revocationRevision: 0,
        },
      })

      if (operation === "designation") {
        await designateHubAdministrators(
          {
            actorMembershipId: actor.membershipId,
            targetMembershipIds: [target.membershipId],
          },
          dependencies(),
        )
      } else {
        await revokeHubAdministrator(
          {
            actorMembershipId: actor.membershipId,
            targetMembershipId: target.membershipId,
          },
          dependencies(),
        )
      }

      const session = await prisma.hubSession.findUniqueOrThrow({
        select: { endedAt: true },
        where: { id: sessionId },
      })
      expect(session.endedAt).toBeInstanceOf(Date)
      await expect(
        prisma.securityAudit.count({
          where: { action: "session.ended", targetId: sessionId },
        }),
      ).resolves.toBe(1)
    },
  )

  it("rolls back designation and session termination when a session-ended audit fails", async () => {
    const actor = await createMembership({})
    const target = await createMembership({})
    await createAssignment({
      externalIdentityId: actor.externalIdentityId!,
      membershipId: actor.membershipId,
      source: "BOOTSTRAP",
    })
    const sessionId = randomUUID()
    await prisma.hubSession.create({
      data: {
        digest: "c".repeat(64),
        expiresAt: new Date("2099-01-01T00:00:00Z"),
        id: sessionId,
        membershipId: target.membershipId,
        revocationRevision: 0,
      },
    })
    await withFailingSecurityAudit("session.ended", () =>
      expect(
        designateHubAdministrators(
          {
            actorMembershipId: actor.membershipId,
            targetMembershipIds: [target.membershipId],
          },
          dependencies(),
        ),
      ).rejects.toBeInstanceOf(AdministratorManagementPersistenceError),
    )

    await expect(
      prisma.hubSession.findUniqueOrThrow({
        select: { endedAt: true },
        where: { id: sessionId },
      }),
    ).resolves.toEqual({ endedAt: null })
    await expect(
      prisma.membershipAssignment.count({
        where: {
          membershipId: target.membershipId,
          source: "HUB_ADMINISTRATOR" as never,
        },
      }),
    ).resolves.toBe(0)
  })

  it("writes a terminal denial audit after invalid-target rollback", async () => {
    const actor = await createMembership({})
    const target = await createMembership({ lifecycle: "SUSPENDED" })
    await createAssignment({
      externalIdentityId: actor.externalIdentityId!,
      membershipId: actor.membershipId,
      source: "BOOTSTRAP",
    })

    await expect(
      designateHubAdministrators(
        {
          actorMembershipId: actor.membershipId,
          targetMembershipIds: [target.membershipId],
        },
        dependencies(),
      ),
    ).rejects.toMatchObject({ reason: "invalid_target" })

    const audits = await prisma.securityAudit.findMany({
      select: { context: true, outcome: true },
      where: { outcome: "DENIED" },
    })
    expect(audits).toHaveLength(1)
    expect(audits[0]?.outcome).toBe("DENIED")
    expect(auditContext(audits[0]?.context).reason).toBe("invalid_target")
  })

  it("writes a terminal failure audit after assignment persistence rollback", async () => {
    const actor = await createMembership({})
    const target = await createMembership({})
    await createAssignment({
      externalIdentityId: actor.externalIdentityId!,
      membershipId: actor.membershipId,
      source: "BOOTSTRAP",
    })
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION fail_hub_administrator_assignment()
      RETURNS trigger AS $$
      BEGIN
        IF NEW.source = 'HUB_ADMINISTRATOR' THEN
          RAISE EXCEPTION 'administrator assignment unavailable';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `)
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER fail_hub_administrator_assignment
      BEFORE INSERT ON membership_assignments
      FOR EACH ROW EXECUTE FUNCTION fail_hub_administrator_assignment()
    `)
    try {
      await expect(
        designateHubAdministrators(
          {
            actorMembershipId: actor.membershipId,
            targetMembershipIds: [target.membershipId],
          },
          dependencies(),
        ),
      ).rejects.toBeInstanceOf(AdministratorManagementPersistenceError)
    } finally {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER fail_hub_administrator_assignment ON membership_assignments`,
      )
      await prisma.$executeRawUnsafe(`DROP FUNCTION fail_hub_administrator_assignment()`)
    }

    const audits = await prisma.securityAudit.findMany({
      select: { context: true, outcome: true },
      where: { outcome: "FAILURE" },
    })
    expect(audits).toHaveLength(1)
    expect(audits[0]?.outcome).toBe("FAILURE")
    expect(auditContext(audits[0]?.context).reason).toBe("transaction_error")
  })

  it("allows exactly one concurrent self-removal when two effective administrators remain", async () => {
    const first = await createMembership({})
    const second = await createMembership({})
    await Promise.all([
      createAssignment({
        externalIdentityId: first.externalIdentityId!,
        membershipId: first.membershipId,
        source: "HUB_ADMINISTRATOR",
      }),
      createAssignment({
        externalIdentityId: second.externalIdentityId!,
        membershipId: second.membershipId,
        source: "HUB_ADMINISTRATOR",
      }),
    ])

    const results = await Promise.allSettled([
      revokeHubAdministrator(
        {
          actorMembershipId: first.membershipId,
          targetMembershipId: first.membershipId,
        },
        dependencies(),
      ),
      revokeHubAdministrator(
        {
          actorMembershipId: second.membershipId,
          targetMembershipId: second.membershipId,
        },
        dependencies(),
      ),
    ])

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1)
    const denial = results.find(({ status }) => status === "rejected")
    expect(denial?.status).toBe("rejected")
    const denialReason: unknown = denial?.status === "rejected" ? denial.reason : undefined
    expect(denialReason).toMatchObject({ reason: "last_administrator" })
    await expect(countEffectiveAdministrators(prisma)).resolves.toBe(1)
  })

  it("waits for provider authority changes and denies a stale provider administrator", async () => {
    const providerId = randomUUID()
    const providerRevisionId = randomUUID()
    const actor = await createMembership({})
    const target = await createMembership({})
    await prisma.authenticationProvider.create({
      data: { enabled: false, id: providerId, key: randomUUID() },
    })
    await prisma.authenticationProviderRevision.create({
      data: {
        configurationDigest: "d".repeat(64),
        id: providerRevisionId,
        providerId,
        revision: 1,
      },
    })
    await prisma.authenticationProvider.update({
      data: { enabled: true, selectedRevisionId: providerRevisionId },
      where: { id: providerId },
    })
    await createAssignment({
      externalIdentityId: actor.externalIdentityId!,
      membershipId: actor.membershipId,
      providerRevisionId,
      source: "AUTHENTICATION_PROVIDER",
    })
    const databaseUrl = getDatabaseUrl()
    const locker = new pg.Client({ connectionString: databaseUrl })
    await locker.connect()
    try {
      await locker.query("BEGIN")
      await locker.query(
        `UPDATE authentication_providers
         SET enabled = false, selected_revision_id = NULL
         WHERE id = $1`,
        [providerId],
      )
      const designation = designateHubAdministrators(
        {
          actorMembershipId: actor.membershipId,
          targetMembershipIds: [target.membershipId],
        },
        dependencies(),
      )
      await waitForDatabaseLock(databaseUrl)

      await locker.query("COMMIT")
      await expect(designation).rejects.toMatchObject({ reason: "not_authorized" })
    } finally {
      await Promise.allSettled([locker.query("ROLLBACK")])
      await locker.end()
    }
    await expect(
      prisma.membershipAssignment.count({
        where: {
          membershipId: target.membershipId,
          source: "HUB_ADMINISTRATOR",
        },
      }),
    ).resolves.toBe(0)
  })

  it("does not authorize an assignment revoked while designation waits for its lock", async () => {
    const actor = await createMembership({})
    const target = await createMembership({})
    const actorAssignmentId = await createAssignment({
      externalIdentityId: actor.externalIdentityId!,
      membershipId: actor.membershipId,
      source: "HUB_ADMINISTRATOR",
    })
    const databaseUrl = getDatabaseUrl()
    const locker = new pg.Client({ connectionString: databaseUrl })
    await locker.connect()
    try {
      await locker.query("BEGIN")
      await locker.query(
        `UPDATE membership_assignments
         SET lifecycle = 'REVOKED', updated_at = clock_timestamp()
         WHERE id = $1`,
        [actorAssignmentId],
      )
      const designation = designateHubAdministrators(
        {
          actorMembershipId: actor.membershipId,
          targetMembershipIds: [target.membershipId],
        },
        dependencies(),
      )
      await waitForDatabaseLock(databaseUrl)

      await locker.query("COMMIT")
      await expect(designation).rejects.toMatchObject({ reason: "not_authorized" })
    } finally {
      await Promise.allSettled([locker.query("ROLLBACK")])
      await locker.end()
    }

    await expect(
      prisma.membershipAssignment.count({
        where: {
          lifecycle: "ACTIVE",
          membershipId: target.membershipId,
          source: "HUB_ADMINISTRATOR",
        },
      }),
    ).resolves.toBe(0)
    await expect(countEffectiveAdministrators(prisma)).resolves.toBe(0)
  })
})
