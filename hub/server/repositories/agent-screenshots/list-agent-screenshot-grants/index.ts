import type { PrismaClient } from "../../../generated/prisma/client.ts"

/** Lists each repository and consent grant that still has stored agent screenshots. */
export async function listAgentScreenshotGrants(database: PrismaClient) {
  const groups = await database.agentScreenshot.groupBy({ by: ["repositoryId", "grantId"] })
  const settings = await database.repositoryEvaluationSetting.findMany({
    where: { repositoryId: { in: [...new Set(groups.map((group) => group.repositoryId))] } },
    select: { repositoryId: true, screenshotGrantId: true },
  })
  const activeGrants = new Map(
    settings.map((setting) => [setting.repositoryId, setting.screenshotGrantId]),
  )
  return groups.map((group) => ({
    repositoryId: group.repositoryId,
    grantId: group.grantId,
    active: activeGrants.get(group.repositoryId) === group.grantId,
  }))
}
