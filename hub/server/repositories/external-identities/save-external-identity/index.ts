import type { ExternalIdentityInput } from "#server/repositories/external-identities/types"

import type { Prisma } from "../../../generated/prisma/client.ts"

export function saveExternalIdentity(
  database: Prisma.TransactionClient,
  identity: ExternalIdentityInput,
) {
  const { provider, issuer, subject } = identity
  return database.externalIdentity.upsert({
    where: { provider_issuer_subject: { provider, issuer, subject } },
    create: identity,
    update: {
      username: identity.username,
      displayName: identity.displayName,
      avatarUrl: identity.avatarUrl,
    },
    include: { user: true },
  })
}
