import type { Prisma } from "../../../generated/prisma/client.ts"

export async function findGitHubRepositoryAccessDenial(
  database: Pick<Prisma.TransactionClient, "hubSession">,
  digest: string,
): Promise<{ login: string | null } | null> {
  const session = await database.hubSession.findUnique({
    where: { digest },
    select: {
      endReason: true,
      expiresAt: true,
      externalIdentityId: true,
      externalIdentity: { select: { provider: true } },
      membership: {
        select: {
          lifecycle: true,
          assignments: {
            where: { lifecycle: "ACTIVE", role: "ADMINISTRATOR" },
            select: { id: true },
            take: 1,
          },
          repositoryAccessGrants: { select: { id: true }, take: 1 },
          user: {
            select: {
              externalIdentities: {
                where: { provider: "github" },
                select: { id: true },
                take: 2,
              },
              profile: { select: { login: true, provider: true } },
            },
          },
        },
      },
    },
  })
  if (
    !session ||
    session.endReason !== "GITHUB_REPOSITORY_ACCESS_REVOKED" ||
    session.expiresAt <= new Date() ||
    session.externalIdentity?.provider !== "github" ||
    session.membership.lifecycle !== "ACTIVE" ||
    session.membership.assignments.length ||
    session.membership.repositoryAccessGrants.length
  ) {
    return null
  }
  const { externalIdentities, profile } = session.membership.user
  const login =
    externalIdentities.length === 1 &&
    externalIdentities[0]?.id === session.externalIdentityId &&
    profile?.provider === "github"
      ? profile.login
      : null
  return { login }
}
