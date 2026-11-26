import type { PrismaClient } from "../../../generated/prisma/client.ts"

export function listGrantAgentScreenshots(
  database: PrismaClient,
  input: { repositoryId: string; grantId: string },
) {
  return database.agentScreenshot.findMany({
    where: input,
    select: { id: true, storageKey: true },
    orderBy: { id: "asc" },
    take: 100,
  })
}
