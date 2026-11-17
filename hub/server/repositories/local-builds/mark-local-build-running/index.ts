import type { PrismaClient } from "../../../generated/prisma/client.ts"
import { randomUUID } from "node:crypto"
import { localBuildStaleAfterMs } from "../../../domains/local-builds/constants.ts"

export async function markLocalBuildRunning(database: PrismaClient, buildId: string) {
  const leaseId = randomUUID()
  const startedAt = new Date()
  const claimed = await database.build.updateMany({
    where: { id: buildId, state: "queued" },
    data: {
      state: "running",
      startedAt,
      localLeaseId: leaseId,
      localLeaseExpiresAt: new Date(startedAt.getTime() + localBuildStaleAfterMs),
    },
  })
  return claimed.count === 1 ? leaseId : null
}
