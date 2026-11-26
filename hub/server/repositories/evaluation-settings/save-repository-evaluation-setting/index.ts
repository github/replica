import type { Prisma } from "../../../generated/prisma/client.ts"

export function saveRepositoryEvaluationSetting(
  database: Prisma.TransactionClient,
  repositoryId: string,
  data:
    | { enabled: boolean; evaluationGrantId: string | null }
    | {
        screenshotGrantId: string | null
        screenshotsChangedAt: Date
        screenshotsChangedByMembershipId: string
      },
) {
  return database.repositoryEvaluationSetting.upsert({
    where: { repositoryId },
    create: { repositoryId, ...data },
    update: data,
  })
}
