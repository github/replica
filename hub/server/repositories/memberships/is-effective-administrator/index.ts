import type { Prisma } from "../../../generated/prisma/client.ts"

export async function isEffectiveAdministrator(
  database: Pick<Prisma.TransactionClient, "membership">,
  membershipId: string,
) {
  const membership = await database.membership.findFirst({
    where: {
      id: membershipId,
      lifecycle: "ACTIVE",
      assignments: {
        some: {
          lifecycle: "ACTIVE",
          role: "ADMINISTRATOR",
          OR: [
            { source: { in: ["BOOTSTRAP", "HUB_ADMINISTRATOR"] } },
            {
              source: "AUTHENTICATION_PROVIDER",
              providerRevision: { selectedBy: { is: { enabled: true } } },
            },
          ],
        },
      },
    },
    select: { id: true },
  })
  return membership !== null
}
