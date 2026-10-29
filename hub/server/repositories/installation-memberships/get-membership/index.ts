import type { Prisma } from "../../../generated/prisma/client.ts"
import type { InstallationMembershipRecord } from "../types.ts"

export async function getInstallationMembership(
  database: Prisma.TransactionClient,
  userId: string,
): Promise<InstallationMembershipRecord | null> {
  return (await database.installationMembership.findUnique({
    where: { userId },
  })) as InstallationMembershipRecord | null
}
