import type { PrismaClient } from "../../../generated/prisma/client.ts"

export async function markPrivatePreviewPending(
  database: Pick<PrismaClient, "build">,
  buildId: string,
  runId: bigint,
  distDigest: string,
) {
  const updated = await database.build.updateMany({
    where: {
      id: buildId,
      githubWorkflowRunId: runId,
      state: "successful",
      distDigest,
      privatePreviewState: null,
    },
    data: { privatePreviewState: "pending" },
  })
  return updated.count === 1
}
