import type { Prisma } from "../../../generated/prisma/client.ts"

export function getLearningRun(
  database: Pick<Prisma.TransactionClient, "learningRun">,
  runId: string,
) {
  return database.learningRun.findUnique({
    where: { id: runId },
    include: {
      repository: true,
      requestedBy: { include: { profile: true } },
      requestedByMembership: true,
    },
  })
}
