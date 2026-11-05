import { randomUUID } from "node:crypto"
import pg from "pg"
import { describe, expect, it } from "vitest"

import { prisma } from "../../../integrations/prisma"
import { getDatabaseUrl } from "../../../../test/database/get-database-url"
import { checkAuthenticationRateLimit } from "."

function input(
  subjectDigest: string,
  options: { auditFirstDenial?: boolean; limit?: number } = {},
) {
  return {
    auditFirstDenial: options.auditFirstDenial ?? false,
    createId: randomUUID,
    limit: options.limit ?? 3,
    operation: "start" as const,
    subjectDigest,
    windowSeconds: 60,
  }
}

describe("checkAuthenticationRateLimit()", () => {
  it("completes another request while one request bucket is locked", async () => {
    const firstDigest = "0".repeat(64)
    const secondDigest = "1".repeat(64)
    const expired = new Date("2020-01-01T00:00:00Z")
    const created = new Date("2019-12-31T23:59:00Z")
    await prisma.authenticationRateLimit.createMany({
      data: [
        {
          id: "00000000-0000-0000-0000-000000000001",
          operation: "start",
          subjectDigest: firstDigest,
          count: 1,
          expiresAt: expired,
          createdAt: created,
          updatedAt: created,
        },
        {
          id: "00000000-0000-0000-0000-000000000002",
          operation: "start",
          subjectDigest: secondDigest,
          count: 1,
          expiresAt: expired,
          createdAt: created,
          updatedAt: created,
        },
      ],
    })
    const locker = new pg.Client({ connectionString: getDatabaseUrl() })
    await locker.connect()
    try {
      await locker.query("BEGIN")
      await locker.query(
        `SELECT id
         FROM authentication_rate_limits
         WHERE operation = 'start' AND subject_digest = $1
         FOR UPDATE`,
        [firstDigest],
      )

      const secondRequest = checkAuthenticationRateLimit(input(secondDigest), prisma)
      await expect(secondRequest).resolves.toEqual({ allowed: true, auditFailed: false })
      await expect(
        prisma.authenticationRateLimit.findUnique({
          where: {
            operation_subjectDigest: { operation: "start", subjectDigest: firstDigest },
          },
        }),
      ).resolves.not.toBeNull()

      await locker.query("COMMIT")
    } finally {
      await Promise.allSettled([locker.query("ROLLBACK")])
      await locker.end()
    }
  })

  it("reserves capacity atomically at the exact threshold", async () => {
    const subjectDigest = "a".repeat(64)

    const sharedResults = await Promise.all(
      Array.from({ length: 10 }, () =>
        checkAuthenticationRateLimit(input(subjectDigest, { limit: 5 }), prisma),
      ),
    )
    expect(sharedResults.filter(({ allowed }) => allowed)).toHaveLength(5)

    const shared = await prisma.authenticationRateLimit.findUniqueOrThrow({
      where: {
        operation_subjectDigest: { operation: "start", subjectDigest },
      },
    })
    expect(shared.count).toBe(10)
  })

  it("writes at most one denial audit per window under concurrency", async () => {
    const subjectDigest = "b".repeat(64)
    for (let count = 0; count < 3; count += 1) {
      await checkAuthenticationRateLimit(input(subjectDigest, { auditFirstDenial: true }), prisma)
    }

    const denied = await Promise.all(
      Array.from({ length: 10 }, () =>
        checkAuthenticationRateLimit(input(subjectDigest, { auditFirstDenial: true }), prisma),
      ),
    )
    expect(denied.every(({ allowed }) => !allowed)).toBe(true)
    expect(
      await prisma.securityAudit.count({
        where: { action: "admission.bootstrap.denied" },
      }),
    ).toBe(1)

    await prisma.authenticationRateLimit.update({
      where: {
        operation_subjectDigest: { operation: "start", subjectDigest },
      },
      data: {
        createdAt: new Date("2020-01-01T00:00:00Z"),
        expiresAt: new Date("2020-01-01T00:01:00Z"),
      },
    })
    for (let count = 0; count < 4; count += 1) {
      await checkAuthenticationRateLimit(input(subjectDigest, { auditFirstDenial: true }), prisma)
    }
    expect(
      await prisma.securityAudit.count({
        where: { action: "admission.bootstrap.denied" },
      }),
    ).toBe(2)
  })

  it("rolls back the denial marker and count when the first audit fails", async () => {
    const subjectDigest = "c".repeat(64)
    for (let count = 0; count < 3; count += 1) {
      await checkAuthenticationRateLimit(input(subjectDigest, { auditFirstDenial: true }), prisma)
    }
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION fail_rate_limit_audit()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF NEW.action = 'admission.bootstrap.denied' THEN
          RAISE EXCEPTION 'audit unavailable';
        END IF;
        RETURN NEW;
      END;
      $$
    `)
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER fail_rate_limit_audit
      BEFORE INSERT ON security_audits
      FOR EACH ROW EXECUTE FUNCTION fail_rate_limit_audit()
    `)
    try {
      await expect(
        checkAuthenticationRateLimit(input(subjectDigest, { auditFirstDenial: true }), prisma),
      ).resolves.toEqual({ allowed: false, auditFailed: true })
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER fail_rate_limit_audit ON security_audits`)
      await prisma.$executeRawUnsafe(`DROP FUNCTION fail_rate_limit_audit()`)
    }
    await expect(
      prisma.authenticationRateLimit.findUniqueOrThrow({
        where: {
          operation_subjectDigest: { operation: "start", subjectDigest },
        },
        select: { count: true, denialAuditedAt: true },
      }),
    ).resolves.toEqual({ count: 3, denialAuditedAt: null })

    await expect(
      checkAuthenticationRateLimit(input(subjectDigest, { auditFirstDenial: true }), prisma),
    ).resolves.toEqual({ allowed: false, auditFailed: false })
    expect(
      await prisma.securityAudit.count({
        where: { action: "admission.bootstrap.denied" },
      }),
    ).toBe(1)
  })

  it("deletes at most 100 expired rows per request and progresses on later calls", async () => {
    const createdAt = new Date("2020-01-01T00:00:00Z")
    await prisma.authenticationRateLimit.createMany({
      data: Array.from({ length: 205 }, (_, index) => ({
        id: randomUUID(),
        operation: "callback",
        subjectDigest: index.toString(16).padStart(64, "0"),
        count: 1,
        expiresAt: new Date("2020-01-01T00:01:00Z"),
        createdAt,
        updatedAt: createdAt,
      })),
    })

    for (const digest of ["d", "e", "f"]) {
      await checkAuthenticationRateLimit(input(digest.repeat(64)), prisma)
    }
    expect(
      await prisma.authenticationRateLimit.count({
        where: { expiresAt: { lt: new Date() } },
      }),
    ).toBe(0)
  })
})
