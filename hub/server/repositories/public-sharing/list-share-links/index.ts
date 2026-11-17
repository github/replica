import type { PrismaClient } from "../../../generated/prisma/client.ts"

export function listShareLinks(database: PrismaClient, prototypeId: string) {
  return database.shareLink.findMany({
    where: { prototypeId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: { build: { select: { number: true } } },
  })
}
