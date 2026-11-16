import type { PrismaClient } from "../../../generated/prisma/client.ts"

function boundedFailureSummary(summary: string) {
  let value = summary.trim() || "The local Build failed."
  while (Buffer.byteLength(value) > 1000) value = value.slice(0, -1)
  return value
}

export async function completeLocalBuildFailure(
  database: PrismaClient,
  buildId: string,
  failureSummary: string,
) {
  return await database.build.update({
    where: { id: buildId },
    data: {
      state: "failed",
      finishedAt: new Date(),
      failureSummary: boundedFailureSummary(failureSummary),
    },
  })
}
