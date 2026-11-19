import type { Prisma, PrismaClient } from "../../../generated/prisma/client.ts"

export function findHostedSharingPrototype(
  database: PrismaClient | Prisma.TransactionClient,
  input: { repositoryId: string; prototypeId: string },
  author?: { issuer: string; subject: string },
) {
  return database.prototype.findFirst({
    where: {
      id: input.prototypeId,
      repositoryId: input.repositoryId,
      replica: false,
      branchDeletedAt: null,
      branchName: { not: "replica/install-workflow" },
      repository: { githubRepositoryId: { not: null }, localPath: null, removedAt: null },
      ...(author
        ? {
            builds: {
              some: {
                state: "successful",
                authorProvider: "github",
                authorIssuer: author.issuer,
                authorProviderUserId: author.subject,
              },
            },
          }
        : {}),
    },
    select: { branchName: true, repository: { select: { defaultBranch: true } } },
  })
}
