import type { PrismaClient, Prisma } from "../../../generated/prisma/client.ts"

export function getRepositoryEvaluationSetting(
  database: PrismaClient | Prisma.TransactionClient,
  repositoryId: string,
) {
  return database.repositoryEvaluationSetting.findUnique({
    where: { repositoryId },
    include: {
      screenshotsChangedByMembership: {
        select: { user: { select: { profile: { select: { login: true } } } } },
      },
    },
  })
}
