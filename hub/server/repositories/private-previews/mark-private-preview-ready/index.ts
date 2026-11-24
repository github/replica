import type { PrismaClient } from "../../../generated/prisma/client.ts"

export async function markPrivatePreviewReady(
  database: PrismaClient,
  buildId: string,
  runId: bigint,
) {
  const updated = await database.build.updateMany({
    where: {
      id: buildId,
      githubWorkflowRunId: runId,
      state: "successful",
      privatePreviewState: "pending",
    },
    data: { privatePreviewState: "ready" },
  })
  return updated.count === 1
}
