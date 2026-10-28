import type { HubSession } from "#server/repositories/sessions/types"

import type { Prisma } from "../../../generated/prisma/client.ts"

export async function createSession(
  database: Prisma.TransactionClient,
  data: Omit<HubSession, "id">,
) {
  const [identity, providerRevision] = await Promise.all([
    database.externalIdentity.findUnique({
      where: { id: data.externalIdentityId },
      select: { userId: true, provider: true, issuer: true },
    }),
    database.authenticationProviderRevision.findUnique({
      where: { id: data.authenticationProviderRevisionId },
      select: { issuer: true, authenticationProvider: { select: { type: true } } },
    }),
  ])
  if (identity?.userId !== data.userId) {
    throw new Error("Session external identity must belong to the Hub user.")
  }
  if (!providerRevision) {
    throw new Error("Session authentication provider revision does not exist.")
  }
  if (identity.provider !== providerRevision.authenticationProvider.type) {
    throw new Error("Session external identity provider must match the authentication provider.")
  }
  if (identity.issuer !== providerRevision.issuer) {
    throw new Error("Session external identity issuer must match the provider revision.")
  }
  return database.session.create({ data })
}
