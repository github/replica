import type { PrismaClient } from "../../../generated/prisma/client.ts"

export function readPendingPrivatePreviewPackage(database: PrismaClient, buildId: string) {
  return database.build.findUnique({
    where: { id: buildId, state: "successful", privatePreviewState: "pending" },
    select: {
      distDigest: true,
      artifacts: {
        where: { kind: { in: ["dist", "manifest"] } },
        orderBy: { path: "asc" },
        select: { kind: true, path: true, storageKey: true, byteLength: true },
      },
    },
  })
}
