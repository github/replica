import type { IdentityProfile } from "#server/utils/identity-contracts/types"

import type { Prisma } from "../../../generated/prisma/client.ts"

export function saveProviderUser(database: Prisma.TransactionClient, profile: IdentityProfile) {
  const { provider, ...attributes } = profile
  return database.user.upsert({
    where: { provider_providerId: { provider, providerId: profile.providerId } },
    create: { ...attributes, provider },
    update: attributes,
  })
}
