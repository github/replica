import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"

import { prisma } from "../../integrations/prisma"
import { countEffectiveAdministrators } from "./count-effective-administrators"
import { designateHubAdministrators } from "./designate-hub-administrators"
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
  }
}

function auditContext(value: unknown) {
  return value as { actorMembershipId?: string; targetMembershipId?: string }
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
    const staleActorAssignmentId = await createAssignment({
      externalIdentityId: staleActor.externalIdentityId!,
      membershipId: staleActor.membershipId,
      source: "HUB_ADMINISTRATOR",
    })
    await prisma.membershipAssignment.update({
      data: { lifecycle: "REVOKED" },
      where: { id: staleActorAssignmentId },
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

  it("rolls back a designation when its success audit fails", async () => {
    const actor = await createMembership({})
    const target = await createMembership({})
    await createAssignment({
      externalIdentityId: actor.externalIdentityId!,
      membershipId: actor.membershipId,
      source: "BOOTSTRAP",
    })

    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION fail_administrator_management_audit()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'administrator management audit unavailable';
      END;
      $$ LANGUAGE plpgsql
    `)
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER fail_administrator_management_audit
      BEFORE INSERT ON security_audits
      FOR EACH ROW EXECUTE FUNCTION fail_administrator_management_audit()
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
      ).rejects.toBeInstanceOf(Error)
    } finally {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER fail_administrator_management_audit ON security_audits`,
      )
      await prisma.$executeRawUnsafe(`DROP FUNCTION fail_administrator_management_audit()`)
    }

    await expect(
      prisma.membershipAssignment.count({
        where: {
          membershipId: target.membershipId,
          source: "HUB_ADMINISTRATOR" as never,
        },
      }),
    ).resolves.toBe(0)
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
})
