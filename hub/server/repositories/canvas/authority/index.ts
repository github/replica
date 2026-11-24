import type { Prisma } from "../../../generated/prisma/client.ts"

export interface CanvasAuthorityReference {
  membershipId: string
  externalIdentityId: string
  providerRevisionId: string
  revocationRevision: number
}

export async function readCanvasAuthority(
  database: Prisma.TransactionClient,
  reference: CanvasAuthorityReference,
) {
  const { membershipId, externalIdentityId, providerRevisionId, revocationRevision } = reference
  const revocation = await database.sessionRevocationState.findUnique({
    where: { key: "global" },
    select: { revision: true },
  })
  if (revocation?.revision !== revocationRevision) return null
  const revision = await database.authenticationProviderRevision.findUnique({
    where: { id: providerRevisionId },
    select: { provider: { select: { enabled: true, key: true, selectedRevisionId: true } } },
  })
  const provider = revision?.provider
  if (!provider?.enabled || provider.selectedRevisionId !== providerRevisionId) return null
  const identity = await database.externalIdentity.findUnique({
    where: { id: externalIdentityId },
    select: {
      provider: true,
      issuer: true,
      subject: true,
      userId: true,
      user: { select: { canvasId: true, profile: { select: { login: true } } } },
    },
  })
  if (!identity || identity.provider !== provider.key) return null
  const membership = await database.membership.findFirst({
    where: { id: membershipId, lifecycle: "ACTIVE" },
    select: {
      userId: true,
      assignments: {
        where: {
          externalIdentityId,
          lifecycle: "ACTIVE",
          OR: [
            { source: "AUTHENTICATION_PROVIDER", providerRevisionId },
            { source: { in: ["BOOTSTRAP", "HUB_ADMINISTRATOR"] }, role: "ADMINISTRATOR" },
          ],
        },
        select: { role: true },
      },
    },
  })
  if (identity.userId !== membership?.userId || !membership.assignments.length) {
    return null
  }
  const login = identity.user.profile?.login
  if (!login || !/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/i.test(login)) return null
  const accessState =
    identity.provider === "github"
      ? await database.gitHubRepositoryAccessState.findUnique({
          where: { key: "global" },
          select: { revision: true },
        })
      : null
  return {
    ...reference,
    sessionProvider: identity.provider,
    issuer: identity.issuer,
    subject: identity.subject,
    userId: identity.userId,
    viewerId: identity.user.canvasId,
    login,
    githubAccessRevision: accessState?.revision ?? null,
    role: membership.assignments.some((assignment) => assignment.role === "ADMINISTRATOR")
      ? ("ADMINISTRATOR" as const)
      : ("MEMBER" as const),
  }
}

export function findCanvasBrowserSession(database: Prisma.TransactionClient, digest: string) {
  return database.hubSession.findFirst({
    where: { digest, endedAt: null, expiresAt: { gt: new Date() } },
    select: {
      id: true,
      membershipId: true,
      externalIdentityId: true,
      providerRevisionId: true,
      revocationRevision: true,
    },
  })
}

export function canvasAuthorityReference(session: {
  membershipId: string
  externalIdentityId: string | null
  providerRevisionId: string | null
  revocationRevision: number
}): CanvasAuthorityReference | null {
  if (!session.externalIdentityId || !session.providerRevisionId) return null
  const { membershipId, externalIdentityId, providerRevisionId, revocationRevision } = session
  return { membershipId, externalIdentityId, providerRevisionId, revocationRevision }
}
