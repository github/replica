import type { PrismaClient, PrivatePreviewAccess } from "../../../generated/prisma/client.ts"

type AccessRow = Pick<
  PrivatePreviewAccess,
  "tokenDigest" | "sessionDigest" | "buildId" | "readerOrigin" | "challengeDigest" | "expiresAt"
>

export function createPrivatePreviewAccessStore(database: PrismaClient, sessionLifetime: number) {
  async function clock() {
    const [row] = await database.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`
    if (!row) throw new Error("Private preview could not read database time.")
    return row.now
  }

  return {
    clock,
    async issue(input: {
      id: string
      tokenDigest: string
      sessionDigest: string
      buildId: string
      readerOrigin: string
      challengeDigest: string
      expiresAt: Date
    }) {
      const now = await clock()
      if (input.expiresAt <= now) return false
      await database.privatePreviewAccess.deleteMany({ where: { expiresAt: { lte: now } } })
      // The row keeps the launch ID across exchange, so one launch issues at most one handoff.
      const result = await database.privatePreviewAccess.createMany({
        data: input,
        skipDuplicates: true,
      })
      return result.count === 1 && input.expiresAt > (await clock())
    },
    /** Reads unexpired access and the database time used to judge it, in one round trip. */
    async read(tokenDigest: string, readerOrigin: string, challengeDigest: string | null) {
      const [row] = await database.$queryRaw<(AccessRow & { now: Date })[]>`
        WITH tick AS MATERIALIZED (SELECT clock_timestamp() AS now)
        SELECT token_digest AS "tokenDigest", session_digest AS "sessionDigest",
               build_id AS "buildId", reader_origin AS "readerOrigin",
               challenge_digest AS "challengeDigest", expires_at AS "expiresAt", tick.now AS "now"
        FROM private_preview_accesses, tick
        WHERE token_digest = ${tokenDigest}
          AND reader_origin = ${readerOrigin}
          AND challenge_digest IS NOT DISTINCT FROM ${challengeDigest}
          AND expires_at > tick.now
      `
      return row ?? null
    },
    async exchange(input: {
      grantDigest: string
      tokenDigest: string
      readerOrigin: string
      challengeDigest: string
    }) {
      // Read the database clock after the row lock, in the statement that rotates the grant.
      const updated = await database.$executeRaw`
        WITH locked AS MATERIALIZED (
          SELECT id
          FROM private_preview_accesses
          WHERE token_digest = ${input.grantDigest}
            AND reader_origin = ${input.readerOrigin}
            AND challenge_digest = ${input.challengeDigest}
          FOR UPDATE
        ), tick AS MATERIALIZED (
          SELECT id, clock_timestamp() AS now FROM locked
        )
        UPDATE private_preview_accesses AS access
        SET token_digest = ${input.tokenDigest},
            challenge_digest = NULL,
            expires_at = GREATEST(access.expires_at, tick.now + make_interval(secs => ${sessionLifetime / 1000})),
            updated_at = tick.now
        FROM tick
        WHERE access.id = tick.id AND access.expires_at > tick.now
      `
      return updated === 1
    },
  }
}
