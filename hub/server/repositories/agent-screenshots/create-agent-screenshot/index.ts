import type { PrismaClient } from "../../../generated/prisma/client.ts"

/**
 * Records a screenshot Hub is about to store, or returns the record a retry already made,
 * so the same image under the same grant is stored once.
 */
export function createAgentScreenshot(
  database: PrismaClient,
  input: { repositoryId: string; grantId: string; sha256: string; storageKey: string },
) {
  const { repositoryId, grantId, sha256 } = input
  return database.agentScreenshot.upsert({
    where: { repositoryId_grantId_sha256: { repositoryId, grantId, sha256 } },
    create: input,
    update: {},
  })
}
