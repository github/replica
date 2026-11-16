import type { Prisma } from "../../../generated/prisma/client.ts"

export async function findCurrentSessionProfile(
  database: Pick<Prisma.TransactionClient, "externalIdentity" | "userProfile">,
  input: { externalIdentityId: string | null; userId: string },
) {
  if (!input.externalIdentityId) {
    const profile = await database.userProfile.findUnique({
      where: { userId: input.userId },
      select: { provider: true, login: true, name: true },
    })
    return profile ? { ...profile, sessionProvider: null } : null
  }
  const identity = await database.externalIdentity.findUnique({
    where: { id: input.externalIdentityId },
    select: {
      provider: true,
      subject: true,
      userId: true,
      user: { select: { profile: { select: { provider: true, login: true, name: true } } } },
    },
  })
  if (!identity || identity.userId !== input.userId) return null
  return {
    provider: identity.user.profile?.provider ?? identity.provider,
    login: identity.user.profile?.login ?? identity.subject,
    name: identity.user.profile?.name ?? null,
    sessionProvider: identity.provider,
  }
}
