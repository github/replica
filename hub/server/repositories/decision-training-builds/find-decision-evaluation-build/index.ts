import type { PrismaClient } from "../../../generated/prisma/client.ts"

export function findDecisionEvaluationBuild(
  database: PrismaClient,
  repositoryId: string,
  buildId: string,
) {
  return database.build.findFirst({
    where: {
      id: buildId,
      state: "successful",
      finishedAt: { not: null },
      prototype: {
        repositoryId,
        repository: { removedAt: null },
        branchDeletedAt: null,
        registeredAt: { not: null },
      },
    },
    select: {
      id: true,
      number: true,
      createdAt: true,
      workflowCreatedAt: true,
      finishedAt: true,
      prototypeId: true,
      artifacts: {
        where: { kind: { in: ["manifest", "screenshot"] } },
        orderBy: [{ path: "asc" }, { id: "asc" }],
        select: {
          kind: true,
          path: true,
          storageKey: true,
          byteLength: true,
        },
      },
    },
  })
}
