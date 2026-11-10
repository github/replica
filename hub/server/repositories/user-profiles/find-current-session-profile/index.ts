import type { Prisma } from "../../../generated/prisma/client.ts"

export async function findCurrentSessionProfile(
  database: Pick<Prisma.TransactionClient, "externalIdentity" | "userProfile">,
  input: { externalIdentityId: string | null; userId: string },
) {
  const profile = await database.userProfile.findUnique({
    where: { userId: input.userId },
    select: { provider: true, login: true, name: true },
  })
  if (profile || !input.externalIdentityId) return profile
  const identity = await database.externalIdentity.findUnique({
    where: { id: input.externalIdentityId },
    select: { provider: true, subject: true },
  })
  return identity ? { provider: identity.provider, login: identity.subject, name: null } : null
}
