import type { PrismaClient } from "../../../generated/prisma/client.ts"

export function readPrivatePreviewPackage(
  database: Pick<PrismaClient, "build">,
  buildId: string,
  publication: "pending" | null,
) {
  return database.build.findUnique({
    where: { id: buildId, state: "successful", privatePreviewState: publication },
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
