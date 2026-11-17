import type { PrismaClient } from "../../../generated/prisma/client.ts"

import type { StoredBuildArtifact } from "./types.ts"

export async function completeLocalBuildSuccess(
  database: PrismaClient,
  buildId: string,
  leaseId: string,
  artifacts: StoredBuildArtifact[],
) {
  return database.$transaction(async (transaction) => {
    const active = await transaction.build.findFirst({
      where: { id: buildId, state: "running", localLeaseId: leaseId },
      select: { id: true },
    })
    if (!active) return false
    await transaction.buildArtifact.createMany({
      data: artifacts.map((artifact) => ({ ...artifact, buildId })),
      skipDuplicates: true,
    })
    await transaction.build.update({
      where: { id: buildId, state: "running", localLeaseId: leaseId },
      data: {
        state: "successful",
        finishedAt: new Date(),
        failureSummary: null,
        localLeaseId: null,
        localLeaseExpiresAt: null,
      },
    })
    return true
  })
}
