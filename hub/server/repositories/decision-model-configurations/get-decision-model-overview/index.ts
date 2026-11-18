import type { Prisma } from "../../../generated/prisma/client.ts"

export async function getDecisionModelOverview(
  database: Pick<
    Prisma.TransactionClient,
    | "decisionCandidate"
    | "decisionModelConfiguration"
    | "decisionModelPromotion"
    | "decisionTrainingJob"
  >,
  repositoryId: string,
) {
  const [configuration, jobs, candidates, promotion] = await Promise.all([
    database.decisionModelConfiguration.findUnique({ where: { repositoryId } }),
    database.decisionTrainingJob.findMany({
      where: { repositoryId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 20,
    }),
    database.decisionCandidate.findMany({
      where: { repositoryId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 20,
    }),
    database.decisionModelPromotion.findFirst({
      where: { repositoryId },
      include: { candidate: true },
      orderBy: [{ runtimeGeneration: "desc" }, { id: "desc" }],
    }),
  ])
  return { configuration, jobs, candidates, promotion }
}
