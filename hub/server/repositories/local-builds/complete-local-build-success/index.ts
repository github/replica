import type { PrismaClient } from "../../../generated/prisma/client.ts"

import type { StoredBuildArtifact } from "./types.ts"

export async function completeLocalBuildSuccess(
  database: PrismaClient,
  buildId: string,
  prototypeId: string,
  artifacts: StoredBuildArtifact[],
) {
  await database.$transaction(async (transaction) => {
    await transaction.buildArtifact.createMany({
      data: artifacts.map((artifact) => ({ ...artifact, buildId })),
      skipDuplicates: true,
    })
    await transaction.build.update({
      where: { id: buildId },
      data: { state: "successful", finishedAt: new Date(), failureSummary: null },
    })
    await transaction.prototype.update({
      where: { id: prototypeId },
      data: { currentBuildId: buildId },
    })
  })
}
