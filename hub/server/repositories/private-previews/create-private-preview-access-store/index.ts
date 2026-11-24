import type { PrismaClient } from "../../../generated/prisma/client.ts"

export function createPrivatePreviewAccessStore(database: PrismaClient) {
  return {
    async issue(input: {
      tokenDigest: string
      sessionDigest: string
      buildId: string
      readerOrigin: string
      challengeDigest: string
      expiresAt: Date
    }) {
      await database.privatePreviewAccess.deleteMany({ where: { expiresAt: { lte: new Date() } } })
      await database.privatePreviewAccess.create({ data: input })
    },
    async read(tokenDigest: string, readerOrigin: string, challengeDigest: string | null) {
      return database.privatePreviewAccess.findFirst({
        where: { tokenDigest, readerOrigin, challengeDigest, expiresAt: { gt: new Date() } },
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
      grantExpiresAt: Date
      expiresAt: Date
    }) {
      return database.$transaction(async (transaction) => {
        const now = new Date()
        const exchanged = await transaction.privatePreviewAccess.updateMany({
          where: {
            tokenDigest: input.grantDigest,
            readerOrigin: input.readerOrigin,
            challengeDigest: input.challengeDigest,
            expiresAt: { gt: now },
          },
          data: {
            tokenDigest: input.tokenDigest,
            challengeDigest: null,
            expiresAt: input.expiresAt,
          },
        })
        if (exchanged.count !== 1) return false
        // Expiration can pass while a concurrent request holds the row lock.
        if (Date.now() < input.grantExpiresAt.getTime()) return true
        await transaction.privatePreviewAccess.delete({ where: { tokenDigest: input.tokenDigest } })
        return false
      })
    },
  }
}
