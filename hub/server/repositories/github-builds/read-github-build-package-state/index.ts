import type { PrismaClient } from "../../../generated/prisma/client.ts"

/** Reads the immutable dist identity before storing a separate screenshot package. */
export function readGitHubBuildPackageState(database: PrismaClient, buildId: string) {
  return database.build.findUnique({
    where: { id: buildId },
    select: { state: true, distDigest: true },
  })
}
