import type { Prisma } from "../../../generated/prisma/client.ts"

export function listGitHubMembershipIdentities(
  database: Pick<Prisma.TransactionClient, "membership">,
  membershipIds: string[],
) {
  return database.membership.findMany({
    orderBy: { id: "asc" },
    select: {
      id: true,
      lifecycle: true,
      user: {
        select: {
          externalIdentities: {
            orderBy: { id: "asc" },
            select: { id: true, userId: true },
            where: { provider: "github" },
          },
        },
      },
    },
    where: { id: { in: membershipIds } },
  })
}
