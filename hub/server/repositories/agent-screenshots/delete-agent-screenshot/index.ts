import type { PrismaClient } from "../../../generated/prisma/client.ts"

export function deleteAgentScreenshot(database: PrismaClient, id: string) {
  return database.agentScreenshot.deleteMany({ where: { id } })
}
