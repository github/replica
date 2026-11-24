import type { PrismaClient } from "../../../generated/prisma/client.ts"

export async function findPrivatePreviewDistFile(
  database: PrismaClient,
  buildId: string,
  path: string,
) {
  return database.buildArtifact.findFirst({
    where: { buildId, path, kind: "dist", build: { state: "successful" } },
    select: { storageKey: true, byteLength: true },
  })
}
