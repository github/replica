import type { PrismaClient, Prisma } from "../../../generated/prisma/client.ts"

export function findShareLink(
  database: PrismaClient | Prisma.TransactionClient,
  where: { id: string } | { publicId: string },
) {
  return database.shareLink.findUnique({
    where,
    include: {
      build: {
        include: {
          artifacts: { where: { path: "dist/index.html" }, select: { id: true } },
          prototype: { include: { repository: true } },
        },
      },
    },
  })
}
