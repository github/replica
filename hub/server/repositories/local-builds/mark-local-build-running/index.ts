import type { PrismaClient } from "../../../generated/prisma/client.ts"
import { randomUUID } from "node:crypto"

export async function markLocalBuildRunning(
  database: PrismaClient,
  buildId: string,
  leaseExpiresAt: Date,
) {
  const leaseId = randomUUID()
  const startedAt = new Date()
  const claimed = await database.build.updateMany({
    where: { id: buildId, state: "queued" },
    data: {
      state: "running",
      startedAt,
      localLeaseId: leaseId,
      localLeaseExpiresAt: leaseExpiresAt,
    },
  })
  return claimed.count === 1 ? leaseId : null
}
