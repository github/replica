import type { Prisma, PrismaClient } from "../../../generated/prisma/client.ts"

export function listShareLinks(
  database: PrismaClient | Prisma.TransactionClient,
  prototypeId: string,
  hosted = false,
) {
  return database.shareLink.findMany({
    where: {
      prototypeId,
      ...(hosted
        ? {
            createdByExternalIdentityId: { not: null },
            expiresAt: { gt: new Date() },
            revokedAt: null,
          }
        : { createdByExternalIdentityId: null }),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: { build: { select: { number: true } } },
  })
}
