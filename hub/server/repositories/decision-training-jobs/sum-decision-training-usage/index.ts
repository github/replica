import type { Prisma } from "../../../generated/prisma/client.ts"

export async function sumDecisionTrainingUsage(
  database: Pick<Prisma.TransactionClient, "decisionTrainingJob">,
  repositoryId: string,
  since: Date,
) {
  const result = await database.decisionTrainingJob.aggregate({
    where: { repositoryId, createdAt: { gte: since }, usageUnit: "credits" },
    _sum: { usageQuantity: true },
  })
  return result._sum.usageQuantity?.toString() ?? "0"
}
