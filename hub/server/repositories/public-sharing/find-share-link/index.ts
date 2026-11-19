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
          artifacts: { where: { path: "dist/index.html" }, select: { kind: true } },
          prototype: { include: { repository: true } },
        },
      },
    },
  })
}
