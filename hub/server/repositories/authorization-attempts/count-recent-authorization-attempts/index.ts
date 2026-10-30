import type { Prisma } from "../../../generated/prisma/client.ts"

export function countRecentAuthorizationAttempts(
  database: Pick<Prisma.TransactionClient, "authorizationAttempt">,
  input: { requestIpDigest: string; createdAfter: Date },
) {
  return database.authorizationAttempt.count({
    where: {
      requestIpDigest: input.requestIpDigest,
      createdAt: { gt: input.createdAfter },
    },
  })
}
