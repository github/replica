import type { PrismaClient, Prisma } from "../../../generated/prisma/client.ts"

export function findShareableBuild(
  database: PrismaClient | Prisma.TransactionClient,
  input: { repositoryId: string; prototypeId: string; buildNumber: number },
) {
  return database.build.findFirst({
    where: {
      number: input.buildNumber,
      prototypeId: input.prototypeId,
      state: "successful",
      artifacts: { some: { path: "dist/index.html" } },
      prototype: {
        repositoryId: input.repositoryId,
        replica: false,
        branchDeletedAt: null,
        branchName: { not: "replica/install-workflow" },
        repository: {
          localPath: { not: null },
          removedAt: null,
        },
      },
    },
    select: {
      id: true,
      prototype: {
        select: {
          branchName: true,
          startPage: true,
          repository: { select: { defaultBranch: true } },
        },
      },
    },
  })
}
