import type { Prisma } from "../../../generated/prisma/client.ts"

export async function getDecisionModelOverview(
  database: Pick<
    Prisma.TransactionClient,
    | "decisionCandidate"
    | "decisionModelConfiguration"
    | "decisionModelPromotion"
    | "decisionTrainingJob"
    | "decisionBuildEvaluation"
    | "decisionRuntimeDeletion"
    | "build"
  >,
  repositoryId: string,
) {
  const [configuration, jobs, candidates, promotions, evaluations, deletions, evaluationBuilds] =
    await Promise.all([
      database.decisionModelConfiguration.findUnique({ where: { repositoryId } }),
      database.decisionTrainingJob.findMany({
        where: { repositoryId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 20,
      }),
      database.decisionCandidate.findMany({
        where: { repositoryId },
        include: { trainingJob: true },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 20,
      }),
      database.decisionModelPromotion.findMany({
        where: { repositoryId },
        include: { candidate: true, previousCandidate: true },
        orderBy: [{ runtimeGeneration: "desc" }, { id: "desc" }],
        take: 20,
      }),
      database.decisionBuildEvaluation.findMany({
        where: { repositoryId },
        include: {
          candidate: true,
          build: { select: { number: true, prototypeId: true } },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 50,
      }),
      database.decisionRuntimeDeletion.findMany({
        where: { repositoryId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 50,
      }),
      database.build.findMany({
        where: {
          state: "successful",
          finishedAt: { not: null },
          artifacts: { some: { kind: "screenshot" } },
          prototype: {
            repositoryId,
            branchDeletedAt: null,
            registeredAt: { not: null },
            repository: { removedAt: null },
          },
        },
        select: {
          id: true,
          number: true,
          prototype: { select: { id: true, name: true, branchName: true } },
        },
        orderBy: [{ finishedAt: "desc" }, { number: "desc" }, { id: "desc" }],
        take: 50,
      }),
    ])
  return {
    configuration,
    jobs,
    candidates,
    promotions,
    promotion: promotions[0] ?? null,
    evaluations,
    deletions,
    evaluationBuilds,
  }
}
