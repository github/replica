import type { PrismaClient } from "../../../generated/prisma/client.ts"

/** Lists each repository and consent grant that still has stored agent screenshots. */
export async function listAgentScreenshotGrants(database: PrismaClient) {
  const rows = await database.agentScreenshot.findMany({
    distinct: ["repositoryId", "grantId"],
    select: {
      grantId: true,
      repositoryId: true,
      repository: { select: { evaluationSetting: { select: { screenshotGrantId: true } } } },
    },
  })
  return rows.map((row) => ({
    repositoryId: row.repositoryId,
    grantId: row.grantId,
    active: row.repository.evaluationSetting?.screenshotGrantId === row.grantId,
  }))
}
