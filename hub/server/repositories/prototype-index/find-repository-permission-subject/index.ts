import type { Prisma } from "../../../generated/prisma/client.ts"

export async function findRepositoryPermissionSubject(
  database: Pick<Prisma.TransactionClient, "externalIdentity">,
  identityId: string,
  membershipId: string,
) {
  const result = await database.externalIdentity.findFirst({
    where: {
      id: identityId,
      provider: "github",
      issuer: "https://github.com",
      user: { membership: { is: { id: membershipId, lifecycle: "ACTIVE" } } },
    },
    select: {
      subject: true,
      user: { select: { profile: { select: { login: true, provider: true } } } },
    },
  })
  const profile = result?.user.profile
  return result && profile?.provider === "github"
    ? { subject: result.subject, login: profile.login }
    : null
}
