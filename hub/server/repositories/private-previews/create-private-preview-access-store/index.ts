import type { PrismaClient } from "../../../generated/prisma/client.ts"
import { sessionLifetime } from "../../../domains/private-preview/types.ts"

export function createPrivatePreviewAccessStore(database: PrismaClient) {
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
    async read(tokenDigest: string, readerOrigin: string, challengeDigest: string | null) {
      return database.privatePreviewAccess.findFirst({
        where: { tokenDigest, readerOrigin, challengeDigest, expiresAt: { gt: await clock() } },
        select: {
          tokenDigest: true,
          sessionDigest: true,
          buildId: true,
          readerOrigin: true,
          challengeDigest: true,
          expiresAt: true,
        },
      })
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
