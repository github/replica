import type { Prisma } from "../../../generated/prisma/client.ts"

export async function getDecisionModelConfiguration(
  database: Pick<Prisma.TransactionClient, "decisionModelConfiguration">,
  repositoryId: string,
) {
  return database.decisionModelConfiguration.findUnique({ where: { repositoryId } })
}
