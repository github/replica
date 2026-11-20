import type { PrismaClient } from "../../../generated/prisma/client.ts"

export function listDecisionTrainingBuilds(
  database: PrismaClient,
  repositoryId: string,
  limits: { prototypes: number; buildsPerPrototype: number },
) {
  return database.repository.findFirst({
    where: { id: repositoryId, removedAt: null },
    select: {
      id: true,
      prototypes: {
        where: {
          branchDeletedAt: null,
          registeredAt: { not: null },
          reviewThreads: { some: {} },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: limits.prototypes + 1,
        select: {
          id: true,
          builds: {
            where: {
              state: "successful",
              finishedAt: { not: null },
              artifacts: { some: { kind: "screenshot" } },
            },
            orderBy: [{ workflowCreatedAt: "asc" }, { number: "asc" }, { id: "asc" }],
            take: limits.buildsPerPrototype + 1,
            select: {
              id: true,
              number: true,
              createdAt: true,
              workflowCreatedAt: true,
              finishedAt: true,
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
          },
        },
      },
    },
  })
}
