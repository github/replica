import type { Prisma } from "../../../generated/prisma/client.ts"

export function getGitHubUser(database: Prisma.TransactionClient, providerId: string) {
  return database.user.findUnique({
    where: { provider_providerId: { provider: "github", providerId } },
  })
}
