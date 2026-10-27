import type { Prisma } from "../../../generated/prisma/client.ts"
import type { InstallationMembershipDetails } from "../types.ts"

export async function getInstallationMemberships(
  database: Prisma.TransactionClient,
): Promise<InstallationMembershipDetails[]> {
  return (await database.installationMembership.findMany({
    include: { user: { include: { externalIdentities: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 100,
  })) as InstallationMembershipDetails[]
}
