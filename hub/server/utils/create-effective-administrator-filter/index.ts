import type { Prisma } from "../../generated/prisma/client.ts"

export function createEffectiveAdministratorFilter(): Prisma.MembershipWhereInput {
  return {
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
  }
}
