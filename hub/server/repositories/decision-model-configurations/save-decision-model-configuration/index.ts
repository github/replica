import type { Prisma } from "../../../generated/prisma/client.ts"

export async function saveDecisionModelConfiguration(
  database: Pick<Prisma.TransactionClient, "decisionModelConfiguration">,
  input: {
    repositoryId: string
    enabled: boolean
    backend: string
    maxUpdates: number
    maxSeconds: number
    monthlyBudgetCredits: string
  },
) {
  const data = {
    enabled: input.enabled,
    backend: input.backend,
    maxUpdates: input.maxUpdates,
    maxSeconds: input.maxSeconds,
    monthlyBudgetCredits: input.monthlyBudgetCredits,
  }
  return database.decisionModelConfiguration.upsert({
    where: { repositoryId: input.repositoryId },
    create: { repositoryId: input.repositoryId, ...data },
    update: { ...data, generation: { increment: 1 } },
  })
}
