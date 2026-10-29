import type { Prisma } from "../../../generated/prisma/client.ts"
import type { InstallationMembershipDetails, InstallationMembershipPage } from "../types.ts"

export async function getInstallationMemberships(
  database: Prisma.TransactionClient,
  cursor: string | null = null,
): Promise<InstallationMembershipPage> {
  const records = (await database.installationMembership.findMany({
    include: { user: { include: { externalIdentities: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    cursor: cursor ? { id: cursor } : undefined,
    skip: cursor ? 1 : undefined,
    take: 101,
  })) as InstallationMembershipDetails[]
  const hasMore = records.length > 100
  const memberships = hasMore ? records.slice(0, 100) : records
  return {
    memberships,
    nextCursor: hasMore ? (memberships.at(-1)?.id ?? null) : null,
  }
}
