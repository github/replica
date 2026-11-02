import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"

import { prisma } from "../../../integrations/prisma"
import { changeBootstrapAssignmentLifecycle } from "."

async function createAssignment() {
  const userId = randomUUID()
  const identityId = randomUUID()
  const membershipId = randomUUID()
  const assignmentId = randomUUID()
  await prisma.user.create({ data: { id: userId } })
  await prisma.externalIdentity.create({
    data: {
      id: identityId,
      userId,
      provider: "github",
      issuer: "https://github.com",
      subject: randomUUID(),
    },
  })
  await prisma.membership.create({ data: { id: membershipId, userId } })
  await prisma.membershipAssignment.create({
    data: {
      id: assignmentId,
      membershipId,
      externalIdentityId: identityId,
      source: "BOOTSTRAP",
      role: "ADMINISTRATOR",
    },
  })
  return { assignmentId, membershipId }
}

describe("changeBootstrapAssignmentLifecycle()", () => {
  it("audits revoke and restore while unchanged requests stay idempotent", async () => {
    const { assignmentId, membershipId } = await createAssignment()

    await expect(
      changeBootstrapAssignmentLifecycle({ id: assignmentId, lifecycle: "REVOKED" }, prisma),
    ).resolves.toMatchObject({ transition: "changed" })
    await expect(
      changeBootstrapAssignmentLifecycle({ id: assignmentId, lifecycle: "REVOKED" }, prisma),
    ).resolves.toMatchObject({ transition: "unchanged" })
    await expect(
      changeBootstrapAssignmentLifecycle({ id: assignmentId, lifecycle: "ACTIVE" }, prisma),
    ).resolves.toMatchObject({ transition: "changed" })

    expect(
      await prisma.securityAudit.findMany({
        where: { targetId: membershipId },
        orderBy: { createdAt: "asc" },
        select: { action: true },
      }),
    ).toEqual([
      { action: "membership.assignment.revoked" },
      { action: "membership.assignment.restored" },
    ])
  })

  it("rolls back lifecycle when the final audit fails", async () => {
    const { assignmentId } = await createAssignment()
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION fail_assignment_lifecycle_audit()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF NEW.action = 'membership.assignment.revoked' THEN
          RAISE EXCEPTION 'audit unavailable';
        END IF;
        RETURN NEW;
      END;
      $$
    `)
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER fail_assignment_lifecycle_audit
      BEFORE INSERT ON security_audits
      FOR EACH ROW EXECUTE FUNCTION fail_assignment_lifecycle_audit()
    `)
    try {
      await expect(
        changeBootstrapAssignmentLifecycle({ id: assignmentId, lifecycle: "REVOKED" }, prisma),
      ).rejects.toThrow()
    } finally {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER fail_assignment_lifecycle_audit ON security_audits`,
      )
      await prisma.$executeRawUnsafe(`DROP FUNCTION fail_assignment_lifecycle_audit()`)
    }

    await expect(
      prisma.membershipAssignment.findUniqueOrThrow({
        where: { id: assignmentId },
        select: { lifecycle: true },
      }),
    ).resolves.toEqual({ lifecycle: "ACTIVE" })
  })

  it("serializes concurrent revoke and restore to a matching final audit state", async () => {
    const { assignmentId, membershipId } = await createAssignment()

    await Promise.all([
      changeBootstrapAssignmentLifecycle({ id: assignmentId, lifecycle: "REVOKED" }, prisma),
      changeBootstrapAssignmentLifecycle({ id: assignmentId, lifecycle: "ACTIVE" }, prisma),
    ])

    const assignment = await prisma.membershipAssignment.findUniqueOrThrow({
      where: { id: assignmentId },
      select: { lifecycle: true },
    })
    const audits = await prisma.securityAudit.findMany({
      where: { targetId: membershipId },
      orderBy: { createdAt: "asc" },
      select: { action: true },
    })
    const lastAction = audits.at(-1)?.action
    expect(assignment.lifecycle).toBe(
      lastAction === "membership.assignment.restored" ? "ACTIVE" : "REVOKED",
    )
    expect(audits.length).toBeGreaterThanOrEqual(1)
  })
})
