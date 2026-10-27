import type {
  InstallationMembershipInput,
  InstallationMembershipRecord,
} from "#server/repositories/installation-memberships/types"

import type { Prisma } from "../../../generated/prisma/client.ts"

export async function saveInstallationMembership(
  database: Prisma.TransactionClient,
  input: InstallationMembershipInput,
): Promise<InstallationMembershipRecord> {
  const { userId, ...membership } = input
  return (await database.installationMembership.upsert({
    where: { userId },
    create: input,
    update: membership,
  })) as InstallationMembershipRecord
}
