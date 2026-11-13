import type { Prisma } from "../../../generated/prisma/client.ts"

export async function finishCopilotAuthorizationCheck(
  database: Pick<Prisma.TransactionClient, "sensitiveAuthorization">,
  id: string,
): Promise<boolean> {
  const result = await database.sensitiveAuthorization.updateMany({
    data: { checkFinishedAt: new Date() },
    where: {
      checkFinishedAt: null,
      checkStartedAt: { not: null },
      id,
    },
  })
  return result.count === 1
}
