import type { PrismaClient } from "../../../generated/prisma/client.ts"

/**
 * Finds stored agent screenshots only under the repository's active screenshot consent.
 * Withdrawn screenshots are deleted later, so they must stop being shown first. The
 * grant is returned so callers can check it is still active right before showing them.
 */
export async function findConsentedAgentScreenshots(
  database: PrismaClient,
  input: { repositoryId: string; sha256s: string[] },
) {
  const setting = await database.repositoryEvaluationSetting.findUnique({
    where: { repositoryId: input.repositoryId },
    select: { screenshotGrantId: true },
  })
  const grantId = setting?.screenshotGrantId
  if (!grantId) return null
  const screenshots = await database.agentScreenshot.findMany({
    where: { repositoryId: input.repositoryId, grantId, sha256: { in: input.sha256s } },
    select: { sha256: true, storageKey: true },
  })
  return {
    grantId,
    storageKeys: new Map(
      screenshots.map((screenshot) => [screenshot.sha256, screenshot.storageKey]),
    ),
  }
}
