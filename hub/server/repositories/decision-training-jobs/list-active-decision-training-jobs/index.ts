import type { Prisma } from "../../../generated/prisma/client.ts"

export async function listActiveDecisionTrainingJobs(
  database: Pick<Prisma.TransactionClient, "decisionTrainingJob">,
) {
  return database.decisionTrainingJob.findMany({
    where: { state: { in: ["QUEUED", "SUBMITTED", "RUNNING"] } },
    select: { id: true, repositoryId: true },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: 100,
  })
}
