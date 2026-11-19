import type { PrismaClient } from "../../../generated/prisma/client.ts"

export function findHostedSharingIdentity(
  database: PrismaClient,
  input: { externalIdentityId: string; userId: string },
) {
  return database.externalIdentity.findFirst({
    where: {
      id: input.externalIdentityId,
      userId: input.userId,
      provider: "github",
      issuer: "https://github.com",
    },
    select: { id: true, issuer: true, subject: true },
  })
}
