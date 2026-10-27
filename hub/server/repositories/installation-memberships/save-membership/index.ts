import type { InstallationMembershipInput } from "#server/repositories/installation-memberships/types"

import type { Prisma } from "../../../generated/prisma/client.ts"

export function saveInstallationMembership(
  database: Prisma.TransactionClient,
  input: InstallationMembershipInput,
) {
  const { userId, ...membership } = input
  return database.installationMembership.upsert({
    where: { userId },
    create: input,
    update: membership,
  })
}
