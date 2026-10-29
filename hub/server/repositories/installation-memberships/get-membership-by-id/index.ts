import type { Prisma } from "../../../generated/prisma/client.ts"
import type { InstallationMembershipDetails } from "../types.ts"

export async function getInstallationMembershipById(
  database: Prisma.TransactionClient,
  id: string,
): Promise<InstallationMembershipDetails | null> {
  return (await database.installationMembership.findUnique({
    where: { id },
    include: { user: { include: { externalIdentities: true } } },
  })) as InstallationMembershipDetails | null
}
