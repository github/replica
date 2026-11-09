import type { Prisma } from "../../../generated/prisma/client.ts"

export async function countEffectiveAdministrators(
  database: Pick<Prisma.TransactionClient, "membership">,
) {
  return database.membership.count({
    where: {
      lifecycle: "ACTIVE",
      assignments: {
        some: {
          lifecycle: "ACTIVE",
          role: "ADMINISTRATOR",
          OR: [
            { source: { in: ["BOOTSTRAP", "HUB_ADMINISTRATOR"] } },
            {
              source: "AUTHENTICATION_PROVIDER",
              providerRevision: {
                selectedBy: { is: { enabled: true } },
              },
            },
          ],
        },
      },
    },
  })
}
