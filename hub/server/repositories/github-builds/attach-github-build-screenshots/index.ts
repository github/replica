import type { PrismaClient } from "../../../generated/prisma/client.ts"
import type { StoredGitHubBuildArtifact } from "../types.ts"

/**
 * Adds screenshots to a successful Build whose dist matches the digest the screenshots
 * were captured from. Existing artifact paths are kept, so retries are harmless.
 */
export async function attachGitHubBuildScreenshots(
  database: PrismaClient,
  input: { buildId: string; distDigest: string; artifacts: StoredGitHubBuildArtifact[] },
) {
  return database.$transaction(async (transaction) => {
    const build = await transaction.build.findUnique({
      where: { id: input.buildId },
      select: { state: true, distDigest: true },
    })
    if (build?.state !== "successful") return "not-ready" as const
    if (build.distDigest !== input.distDigest) return "digest-mismatch" as const
    await transaction.buildArtifact.createMany({
      data: input.artifacts.map((artifact) => ({ ...artifact, buildId: input.buildId })),
      skipDuplicates: true,
    })
    return "attached" as const
  })
}
