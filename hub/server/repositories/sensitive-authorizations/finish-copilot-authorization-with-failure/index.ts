import type { Prisma } from "../../../generated/prisma/client.ts"

export async function finishCopilotAuthorizationWithFailure(
  database: Pick<Prisma.TransactionClient, "sensitiveAuthorization">,
  id: string,
): Promise<boolean> {
  const finishedAt = new Date()
  const result = await database.sensitiveAuthorization.updateMany({
    data: {
      checkFinishedAt: finishedAt,
      continuedAt: finishedAt,
    },
    where: {
      checkFinishedAt: null,
      checkStartedAt: { not: null },
      continuedAt: null,
      id,
    },
  })
  return result.count === 1
}
