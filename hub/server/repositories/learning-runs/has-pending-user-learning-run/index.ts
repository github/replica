import type { Prisma } from "../../../generated/prisma/client.ts"

export async function hasPendingUserLearningRun(
  database: Pick<Prisma.TransactionClient, "learningRun">,
) {
  return (
    (await database.learningRun.count({
      where: { scheduled: false, state: { in: ["QUEUED", "RUNNING"] } },
    })) > 0
  )
}
