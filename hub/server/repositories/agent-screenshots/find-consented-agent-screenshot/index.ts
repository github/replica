import type { PrismaClient } from "../../../generated/prisma/client.ts"

/**
 * Finds a stored agent screenshot only while the repository's screenshot consent that
 * allowed it is still on. Withdrawn screenshots are deleted later, so they must stop being
 * shown first.
 */
export async function findConsentedAgentScreenshot(
  database: PrismaClient,
  input: { repositoryId: string; sha256: string },
) {
  const setting = await database.repositoryEvaluationSetting.findUnique({
    where: { repositoryId: input.repositoryId },
    select: { screenshotGrantId: true },
  })
  if (!setting?.screenshotGrantId) return null
  return database.agentScreenshot.findFirst({
    where: {
      repositoryId: input.repositoryId,
      grantId: setting.screenshotGrantId,
      sha256: input.sha256,
    },
    select: { storageKey: true },
  })
}
