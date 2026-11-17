import type { PrismaClient } from "../../../generated/prisma/client.ts"

export function findBuildArtifact(database: PrismaClient, buildId: string, path: string) {
  return database.buildArtifact.findFirst({
    where: { buildId, path, build: { state: "successful" } },
    select: { storageKey: true, byteLength: true },
  })
}
